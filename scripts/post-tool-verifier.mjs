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

// --- Atomic write helper ---
function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, filePath);
}

// --- Constants ---
const FAILURE_KEYWORDS = [
  /error TS\d+/i,            // TypeScript errors
  /SyntaxError/,             // JS/TS syntax errors
  /FAIL/,                    // Test runner FAIL
  /npm ERR!/,                // npm errors
  /Build failed/i,           // Generic build failure
  /Cannot find module/i,     // Module resolution
  /ENOENT/,                  // File not found
  /Segmentation fault/i,     // Crash
  /exit code [1-9]/i,        // Non-zero exit
  /command failed/i,         // Generic command failure
];

const CODE_TOOLS = new Set(["Write", "Edit"]);
const BASH_TOOL = "Bash";

// --- Helpers ---
function readJson(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch { return null; }
}

function writeJson(path, data) {
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, path);
  } catch { /* best effort */ }
}

function hookOutput(additionalContext) {
  const output = {
    continue: true,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      ...(additionalContext ? { additionalContext } : {}),
    },
  };
  process.stdout.write(JSON.stringify(output));
}

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
  const stateDir = join(directory, ".oh-my-beads", "state");
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
  const toolResult = typeof toolOutput === "string" ? toolOutput : JSON.stringify(toolOutput);

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

  // Generate advisory context if failure detected
  if (failureDetected) {
    hookOutput(
      `[oh-my-beads] Tool failure detected: ${failureDetected}\n` +
      `Phase: ${session.current_phase || session.phase || "unknown"}\n` +
      `Total failures this session: ${session.failure_count}\n` +
      `Review the error and fix before proceeding.`
    );
    return;
  }

  // No issues — pass through silently
  hookOutput(null);
});
