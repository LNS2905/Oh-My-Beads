#!/usr/bin/env node

/**
 * oh-my-beads PostToolUseFailure hook.
 *
 * Fires when a tool call fails at the engine level (distinct from PostToolUse which
 * fires on success). Tracks retry counts per tool within a 60s window and escalates
 * after 5 consecutive failures of the same tool.
 *
 * Writes .oh-my-beads/state/last-tool-error.json atomically.
 *
 * Safety:
 * - Atomic writes (tmp + rename) to prevent corruption
 * - Path containment guard (no path traversal)
 * - Graceful: failures in this hook never block Claude
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { join, dirname, resolve, relative } from "path";
import { resolveStateDir, getSystemRoot } from "./state-tools/resolve-state-dir.mjs";
import { readJson, writeJsonAtomic, hookOutput as _hookOutput } from "./helpers.mjs";

// --- Constants ---
const RETRY_WINDOW_MS = 60_000; // 60 seconds
const ESCALATION_THRESHOLD = 5;
const BV_ESCALATION_THRESHOLD = 2; // beads_village tools escalate faster

// --- Path safety ---
function isPathContained(base, target) {
  const resolvedBase = resolve(base);
  const resolvedTarget = resolve(target);
  return resolvedTarget.startsWith(resolvedBase);
}

// --- Helpers ---
const hookOutput = (additionalContext) => {
  _hookOutput("PostToolUseFailure", additionalContext);
};

/**
 * Check if a tool name belongs to beads_village MCP tools.
 * Claude Code tool names use format: mcp__beads-village__<command>
 * or could include beads_village in other formats.
 * @param {string} toolName
 * @returns {boolean}
 */
function isBeadsVillageTool(toolName) {
  if (!toolName) return false;
  const lower = toolName.toLowerCase();
  return lower.includes("beads-village") || lower.includes("beads_village");
}

function calculateRetryCount(existingState, toolName, now) {
  if (!existingState) return 1;

  // Reset if different tool or window expired
  const lastTime = existingState.last_failure_at
    ? new Date(existingState.last_failure_at).getTime()
    : 0;
  const elapsed = now - lastTime;

  if (existingState.tool_name !== toolName || elapsed > RETRY_WINDOW_MS) {
    return 1;
  }

  return (existingState.retry_count || 0) + 1;
}

// --- Main ---
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let data;
  try {
    data = JSON.parse(input.trim());
  } catch {
    hookOutput(null);
    return;
  }

  const directory = data.cwd || data.directory || process.cwd();
  const { stateDir } = resolveStateDir(directory, data);
  const errorFile = join(stateDir, "last-tool-error.json");

  // Path containment guard — stateDir may be under system root or project dir
  const systemRoot = getSystemRoot();
  if (!isPathContained(directory, stateDir) && !isPathContained(systemRoot, stateDir)) {
    hookOutput(null);
    return;
  }

  const toolName = data.tool_name ?? data.toolName ?? "unknown";
  const toolError = data.tool_error ?? data.error ?? data.tool_output ?? "";
  const errorStr = typeof toolError === "string" ? toolError : JSON.stringify(toolError);
  const now = Date.now();

  // Determine escalation threshold (beads_village tools escalate faster)
  const isBvTool = isBeadsVillageTool(toolName);
  const threshold = isBvTool ? BV_ESCALATION_THRESHOLD : ESCALATION_THRESHOLD;

  // Load existing error state
  const existingState = readJson(errorFile);
  const retryCount = calculateRetryCount(existingState, toolName, now);

  // Build new error state
  const errorState = {
    tool_name: toolName,
    retry_count: retryCount,
    last_failure_at: new Date(now).toISOString(),
    error_snippet: errorStr.substring(0, 500),
    escalated: retryCount >= threshold,
  };

  // Write atomically
  writeJsonAtomic(errorFile, errorState);

  // beads_village-specific escalation: write flag so persistent-mode allows stops
  if (isBvTool && retryCount >= BV_ESCALATION_THRESHOLD) {
    try {
      const sessionFile = join(stateDir, "session.json");
      const session = readJson(sessionFile);
      if (session) {
        session.bv_server_down = true;
        writeJsonAtomic(sessionFile, session);
      }
    } catch { /* best effort */ }
  }

  // Generate guidance
  if (isBvTool && retryCount >= BV_ESCALATION_THRESHOLD) {
    hookOutput(
      `[oh-my-beads] beads_village tool "${toolName}" has failed ${retryCount} times in ${RETRY_WINDOW_MS / 1000}s.\n` +
      `beads_village MCP server may be down. Run 'doctor omb' to diagnose.\n` +
      `Consider:\n` +
      `1. Check if beads-village MCP server is running\n` +
      `2. Restart the MCP server\n` +
      `3. Ask the user for help if blocked\n` +
      `Error: ${errorStr.substring(0, 200)}`
    );
  } else if (retryCount >= threshold) {
    hookOutput(
      `[oh-my-beads] Tool "${toolName}" has failed ${retryCount} times in ${RETRY_WINDOW_MS / 1000}s.\n` +
      `This suggests a systemic issue. Consider:\n` +
      `1. Check if the tool's prerequisites are met\n` +
      `2. Try a different approach or tool\n` +
      `3. Ask the user for help if blocked\n` +
      `Error: ${errorStr.substring(0, 200)}`
    );
  } else if (retryCount >= 3) {
    hookOutput(
      `[oh-my-beads] Tool "${toolName}" failed (attempt ${retryCount}/${threshold}).\n` +
      `Investigate the root cause before retrying.\n` +
      `Error: ${errorStr.substring(0, 200)}`
    );
  } else {
    hookOutput(
      `[oh-my-beads] Tool "${toolName}" failed (attempt ${retryCount}/${threshold}).\n` +
      `Error: ${errorStr.substring(0, 200)}`
    );
  }
});
