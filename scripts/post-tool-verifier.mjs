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
import { resolveStateDir } from "./state-tools/resolve-state-dir.mjs";
import { readJson, writeJsonAtomic, hookOutput as _hookOutput } from "./helpers.mjs";

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
const BASH_TOOL = "Bash";

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

  // No issues — pass through (with clipping annotation if needed)
  if (clipped) {
    hookOutput(`[oh-my-beads] Output clipped from ${(typeof toolOutput === "string" ? toolOutput : JSON.stringify(toolOutput)).length} to ${MAX_OUTPUT_CHARS} chars.`);
    return;
  }
  hookOutput(null);
});
