#!/usr/bin/env node

/**
 * oh-my-beads post-tool verifier — PostToolUse hook.
 *
 * Runs after every tool call. Responsibilities:
 * 1. Track Worker file modifications (Write/Edit) against reserved scope
 * 2. Detect tool failures (Bash exit codes, compile/test errors)
 * 3. Update session state with progress and failure counters
 * 4. Flag out-of-scope file modifications
 *
 * Safety:
 * - Read-only: never modifies source code
 * - Lightweight: fast JSON checks, no subprocess spawning
 * - Graceful: failures in this hook never block Claude
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { join, dirname } from "path";
import { resolveStateDir, getProjectStateRoot } from "./state-tools/resolve-state-dir.mjs";
import { readJson, writeJsonAtomic, hookOutput as _hookOutput, getQuietLevel } from "./helpers.mjs";
import { loadMemory, saveMemory, addHotPath } from "./project-memory.mjs";

// --- Constants ---
const MAX_OUTPUT_CHARS = parseInt(process.env.OMB_MAX_OUTPUT_CHARS || "12000", 10);

const FAILURE_KEYWORDS = [
  /\berror TS\d+\b/i,           // TypeScript errors
  /\bSyntaxError\b/,            // JS/TS syntax errors
  /\bFAIL\b/,                   // Test runner FAIL
  /\bnpm ERR!/,                 // npm errors
  /\bBuild failed\b/i,          // Generic build failure
  /\bCannot find module\b/i,    // Module resolution
  /\bENOENT\b/,                 // File not found
  /\bSegmentation fault\b/i,    // Crash
  /\bexit code [1-9]\b/i,       // Non-zero exit
  /\bcommand failed\b/i,        // Generic command failure
];

const CODE_TOOLS = new Set(["Write", "Edit"]);
const HOT_PATH_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit"]);
const BASH_TOOL = "Bash";
const MEMORY_SAVE_INTERVAL = 10; // Save project memory every N tool calls

// --- Helpers ---
const hookOutput = (additionalContext) => {
  _hookOutput("PostToolUse", additionalContext);
};

const writeJson = (path, data) => writeJsonAtomic(path, data);

function detectFailure(output) {
  if (!output || typeof output !== "string") return null;
  for (const pattern of FAILURE_KEYWORDS) {
    const match = output.match(pattern);
    if (match) return match[0];
  }
  return null;
}

function extractFilePath(data) {
  // Write/Edit tools pass file_path
  return data.tool_input?.file_path
    ?? data.toolInput?.file_path
    ?? data.tool_input?.filePath
    ?? data.toolInput?.filePath
    ?? null;
}

// --- Main ---
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", async () => {
  let data;
  try {
    data = JSON.parse(input.trim());
  } catch {
    hookOutput(null);
    return;
  }

  const directory = data.cwd || data.directory || process.cwd();
  const { stateDir } = resolveStateDir(directory, data);
  const sessionFile = join(stateDir, "session.json");
  const trackingFile = join(stateDir, "tool-tracking.json");

  // Only active sessions need monitoring
  const session = readJson(sessionFile);
  if (!session || !session.active) {
    hookOutput(null);
    return;
  }

  const toolName = data.tool_name ?? data.toolName ?? "";
  const toolOutput = data.tool_output ?? data.toolOutput ?? data.output ?? "";
  let toolResult = typeof toolOutput === "string" ? toolOutput : JSON.stringify(toolOutput);

  // Clip oversized output to reduce analysis surface
  let clipped = false;
  if (toolResult.length > MAX_OUTPUT_CHARS) {
    toolResult = toolResult.substring(0, MAX_OUTPUT_CHARS) + "\n[TRUNCATED — output exceeded " + MAX_OUTPUT_CHARS + " chars]";
    clipped = true;
  }

  // Load or create tracking state
  let tracking = readJson(trackingFile) || {
    files_modified: [],
    failures: [],
    last_tool: null,
    tool_count: 0,
  };

  tracking.tool_count = (tracking.tool_count || 0) + 1;
  tracking.last_tool = toolName;
  tracking.last_tool_at = new Date().toISOString();

  // Track file modifications from Write/Edit tools
  if (CODE_TOOLS.has(toolName)) {
    const filePath = extractFilePath(data);
    if (filePath && !tracking.files_modified.includes(filePath)) {
      tracking.files_modified.push(filePath);
    }
  }

  // Detect failures in Bash output
  let failureDetected = null;
  if (toolName === BASH_TOOL) {
    failureDetected = detectFailure(toolResult);
    if (failureDetected) {
      const failure = {
        tool: toolName,
        error: failureDetected,
        timestamp: new Date().toISOString(),
        snippet: toolResult.substring(0, 500),
      };
      tracking.failures = tracking.failures || [];
      tracking.failures.push(failure);

      // Update session failure counter
      session.failure_count = (session.failure_count || 0) + 1;
      session.last_failure = failure;
      session.last_checked_at = new Date().toISOString();

      try {
        mkdirSync(stateDir, { recursive: true });
        writeJsonAtomic(sessionFile, session);
      } catch { /* best effort */ }
    }
  }

  // Persist tracking state
  try {
    mkdirSync(stateDir, { recursive: true });
    writeJsonAtomic(trackingFile, tracking);
  } catch { /* best effort */ }

  // --- Project Memory: hot path tracking + command learning ---
  // Throttled: only save to disk every MEMORY_SAVE_INTERVAL tool calls
  try {
    const projectStateRoot = getProjectStateRoot(directory);
    let memory = loadMemory(projectStateRoot);
    let memoryDirty = false;

    // Track hot paths for file-access tools (Read/Edit/Write/MultiEdit)
    if (HOT_PATH_TOOLS.has(toolName)) {
      const filePath = extractFilePath(data);
      if (filePath) {
        addHotPath(memory, filePath, "file");
        memoryDirty = true;
      }
    }

    // Learn build/test commands from Bash output
    if (toolName === BASH_TOOL && toolResult) {
      const bashInput = data.tool_input?.command ?? data.toolInput?.command ?? "";
      if (!memory.build) memory.build = { test: "", build: "", lint: "", dev: "", scripts: {} };
      // Detect common build/test command patterns running successfully (no failure detected)
      if (bashInput && !failureDetected) {
        const cmdLearners = [
          { pattern: /\b(?:npm\s+test|yarn\s+test|pnpm\s+test|jest|vitest|pytest|cargo\s+test|go\s+test|mocha)\b/i, field: "test" },
          { pattern: /\b(?:npm\s+run\s+build|yarn\s+build|pnpm\s+build|cargo\s+build|go\s+build|tsc)\b/i, field: "build" },
          { pattern: /\b(?:npm\s+run\s+lint|yarn\s+lint|pnpm\s+lint|eslint|cargo\s+clippy|golangci-lint)\b/i, field: "lint" },
        ];
        for (const { pattern, field } of cmdLearners) {
          if (pattern.test(bashInput) && !memory.build[field]) {
            memory.build[field] = bashInput.trim();
            memoryDirty = true;
          }
        }
      }
    }

    // Save memory (throttled to max once per MEMORY_SAVE_INTERVAL tool calls)
    if (memoryDirty && tracking.tool_count % MEMORY_SAVE_INTERVAL === 0) {
      saveMemory(projectStateRoot, memory);
    }
  } catch { /* best effort — don't block tool use */ }

  // --- <remember> tag processing ---
  // When tool output contains <remember priority>content</remember>,
  // write content to .oh-my-beads/priority-context.md (replacing existing).
  // When output contains <remember>content</remember>,
  // append to .oh-my-beads/history/working-memory.md with timestamp.
  try {
    const rawOutput = typeof toolOutput === "string" ? toolOutput : JSON.stringify(toolOutput);
    // Match <remember priority>...</remember> (priority context — replaces file)
    const priorityMatch = rawOutput.match(/<remember\s+priority>([\s\S]*?)<\/remember>/);
    if (priorityMatch) {
      const content = priorityMatch[1].trim().substring(0, 500); // Max 500 chars
      if (content.length > 0) {
        const artifactsDir = join(directory, ".oh-my-beads");
        mkdirSync(artifactsDir, { recursive: true });
        writeFileSync(join(artifactsDir, "priority-context.md"), content);
      }
    }
    // Match <remember>...</remember> (working memory — appends)
    const workingMatches = rawOutput.matchAll(/<remember>(?![\s]*priority)([\s\S]*?)<\/remember>/g);
    for (const match of workingMatches) {
      const content = match[1].trim();
      if (content.length > 0) {
        const historyDir = join(directory, ".oh-my-beads", "history");
        mkdirSync(historyDir, { recursive: true });
        const wmPath = join(historyDir, "working-memory.md");
        const timestamp = new Date().toISOString();
        const entry = `\n---\n**${timestamp}**\n${content}\n`;
        // Append to file (create if it doesn't exist)
        try {
          const existing = existsSync(wmPath) ? readFileSync(wmPath, "utf8") : "";
          writeFileSync(wmPath, existing + entry);
        } catch { /* best effort */ }
      }
    }
  } catch { /* best effort — don't block tool use */ }

  // Generate advisory context if failure detected
  // Failure messages are warnings — suppressed at quiet level 2
  const quiet = getQuietLevel();
  if (failureDetected) {
    if (quiet < 2) {
      hookOutput(
        `[oh-my-beads] Tool failure detected: ${failureDetected}\n` +
        `Phase: ${session.current_phase || session.phase || "unknown"}\n` +
        `Total failures this session: ${session.failure_count}\n` +
        `Review the error and fix before proceeding.`
      );
    } else {
      hookOutput(null);
    }
    return;
  }

  // No issues — pass through (with clipping annotation if needed)
  // Clipping messages are informational — suppressed at quiet level 1+
  if (clipped) {
    if (quiet < 1) {
      hookOutput(`[oh-my-beads] Output clipped from ${(typeof toolOutput === "string" ? toolOutput : JSON.stringify(toolOutput)).length} to ${MAX_OUTPUT_CHARS} chars.`);
    } else {
      hookOutput(null);
    }
    return;
  }
  hookOutput(null);
});
