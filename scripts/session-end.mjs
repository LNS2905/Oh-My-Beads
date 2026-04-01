#!/usr/bin/env node

/**
 * oh-my-beads SessionEnd hook.
 *
 * Runs when the Claude Code session ends. Responsibilities:
 * 1. Write final session summary to state
 * 2. Mark stale active sessions as "session_ended"
 * 3. Clean up dangling state (but NOT source files)
 *
 * Safety:
 * - Never modifies source code
 * - Atomic writes to prevent corruption
 * - Graceful: failures never block Claude Code shutdown
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { join, dirname } from "path";
import { resolveStateDir } from "./state-tools/resolve-state-dir.mjs";
import { readJson, writeJsonAtomic, hookOutput as _hookOutput } from "./helpers.mjs";

// --- Helpers ---
const hookOutput = (additionalContext) => {
  _hookOutput("SessionEnd", additionalContext);
};

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
  const sessionFile = join(stateDir, "session.json");

  // Read session state
  const session = readJson(sessionFile);

  // No session or already inactive — nothing to clean up
  if (!session || !session.active) {
    hookOutput(null);
    return;
  }

  const now = new Date().toISOString();

  // Mark session as ended (preserve phase for resume detection)
  session.session_ended_at = now;
  session.last_checked_at = now;

  // Only deactivate if in a non-critical phase
  // Critical phases (execution, review) should remain resumable
  const criticalPhases = new Set([
    "phase_6_execution", "phase_7_review", "fast_execution",
  ]);

  if (!criticalPhases.has(session.current_phase)) {
    session.active = false;
    session.deactivated_reason = "session_ended";
  }

  // Write updated state
  writeJsonAtomic(sessionFile, session);

  // Clean up last-tool-error.json (transient, no value across sessions)
  const errorFile = join(stateDir, "last-tool-error.json");
  if (existsSync(errorFile)) {
    try {
      writeJsonAtomic(errorFile, { cleared_at: now, reason: "session_end" });
    } catch { /* best effort */ }
  }

  hookOutput(null);
});
