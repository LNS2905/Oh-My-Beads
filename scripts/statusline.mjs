#!/usr/bin/env node

/**
 * oh-my-beads status line — outputs a one-line session status for Claude Code's statusLine.
 *
 * Reads .oh-my-beads/state/session.json from cwd and prints a compact status string.
 *
 * Output format:
 *   Active Mr.Beads: OMB [Mr.Beads] Phase 6: Execution | R:3 F:0
 *   Active Mr.Fast:  OMB [Mr.Fast] Analyzing | F:0
 *   Idle/missing:    OMB idle
 *
 * Usage:
 *   node scripts/statusline.mjs              (uses cwd)
 *   node scripts/statusline.mjs /path/to/project
 *
 * Zero dependencies. Never writes to stderr. Always exits 0.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

// --- Phase display mapping ---

const PHASE_DISPLAY = {
  bootstrap:              "Bootstrapping",
  phase_1_exploration:    "Phase 1: Exploration",
  phase_2_planning:       "Phase 2: Planning",
  phase_3_persistence:    "Phase 3: Persistence",
  phase_4_decomposition:  "Phase 4: Decomposition",
  phase_5_validation:     "Phase 5: Validation",
  phase_6_execution:      "Phase 6: Execution",
  phase_7_review:         "Phase 7: Review",
  phase_8_summary:        "Phase 8: Summary",
  gate_1_pending:         "Gate 1: Awaiting User",
  gate_2_pending:         "Gate 2: Awaiting User",
  gate_3_pending:         "Gate 3: Awaiting User",
  fast_bootstrap:         "Bootstrapping",
  fast_scout:             "Analyzing",
  fast_execution:         "Implementing",
};

// --- Helpers ---

function readSession(directory) {
  const statePath = join(directory, ".oh-my-beads", "state", "session.json");
  try {
    if (!existsSync(statePath)) return null;
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return null;
  }
}

function formatMode(mode) {
  if (mode === "mr.fast") return "Mr.Fast";
  return "Mr.Beads";
}

function formatPhase(phase) {
  if (!phase) return "Unknown";
  return PHASE_DISPLAY[phase] || phase;
}

function buildStatus(session) {
  if (!session || !session.active) return "OMB idle";

  const mode = formatMode(session.mode);
  const phase = formatPhase(session.current_phase);
  const f = session.failure_count || 0;

  if (session.mode === "mr.fast") {
    return `OMB [${mode}] ${phase} | F:${f}`;
  }

  // Mr.Beads includes reinforcement count
  const r = session.reinforcement_count || 0;
  return `OMB [${mode}] ${phase} | R:${r} F:${f}`;
}

// --- Main ---

const directory = process.argv[2] || process.cwd();
const session = readSession(directory);
process.stdout.write(buildStatus(session) + "\n");
