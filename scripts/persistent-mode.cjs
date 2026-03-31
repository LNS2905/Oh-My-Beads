#!/usr/bin/env node

/**
 * oh-my-beads persistent mode — Stop hook.
 *
 * The core autonomy engine. When Claude tries to stop mid-workflow,
 * this hook checks .oh-my-beads/state/session.json. If the session
 * is active and not complete, it BLOCKS the stop and tells Claude
 * to continue to the next phase.
 *
 * This is what makes the 8-step workflow autonomous.
 *
 * Safety:
 * - Max 50 reinforcements before allowing stop (circuit breaker)
 * - 2-hour staleness timeout (prevents blocking new sessions)
 * - Respects context limits (allows compaction)
 * - Respects user abort (Ctrl+C)
 * - Respects cancel signals
 */

const { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } = require("fs");
const { join, dirname } = require("path");

// --- Constants ---
const MAX_REINFORCEMENTS = 50;
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

const TERMINAL_PHASES = new Set([
  "complete", "completed", "failed", "cancelled", "canceled"
]);

const PHASE_CONTINUATIONS = {
  "bootstrap":                "Continue to Phase 1: Spawn Scout for requirements exploration.",
  "phase_1_exploration":      "Continue Phase 1: Scout is clarifying requirements. Wait for CONTEXT.md.",
  "gate_1_pending":           "HITL Gate 1: Present locked decisions to user for approval.",
  "phase_2_planning":         "Continue Phase 2: Architect is drafting the implementation plan.",
  "gate_2_pending":           "HITL Gate 2: Present plan to user for approval or feedback.",
  "phase_3_persistence":      "Continue Phase 3: Write approved plan to .oh-my-beads/plans/plan.md.",
  "phase_4_decomposition":    "Continue Phase 4: Architect is decomposing plan into beads.",
  "phase_5_validation":       "Continue Phase 5: Reviewer is validating bead descriptions.",
  "gate_3_pending":           "HITL Gate 3: Ask user to choose Sequential or Parallel execution.",
  "phase_6_execution":        "Continue Phase 6: Workers are implementing beads. Check ls(status='ready') for next bead.",
  "phase_7_review":           "Continue Phase 7: Reviewer is verifying bead implementation.",
  "phase_8_summary":          "Continue Phase 8: Generate final summary, write WRAP-UP.md, update learnings.",
};

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

function isStale(state) {
  if (!state) return true;
  const lastChecked = state.last_checked_at ? new Date(state.last_checked_at).getTime() : 0;
  const startedAt = state.started_at ? new Date(state.started_at).getTime() : 0;
  const mostRecent = Math.max(lastChecked, startedAt);
  if (mostRecent === 0) return true;
  return (Date.now() - mostRecent) > STALE_THRESHOLD_MS;
}

function isContextLimitStop(data) {
  const reasons = [data.stop_reason, data.stopReason, data.reason]
    .filter(v => typeof v === "string")
    .map(v => v.toLowerCase().replace(/[\s-]+/g, "_"));
  const patterns = ["context_limit", "context_window", "context_full", "max_tokens", "token_limit"];
  return reasons.some(r => patterns.some(p => r.includes(p)));
}

function isUserAbort(data) {
  if (data.user_requested || data.userRequested) return true;
  const reason = (data.stop_reason || data.stopReason || "").toLowerCase();
  return ["aborted", "abort", "cancel", "interrupt"].includes(reason) ||
    ["user_cancel", "user_interrupt", "ctrl_c", "manual_stop"].some(p => reason.includes(p));
}

function allowStop() {
  process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }));
}

function blockStop(reason) {
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}

function writeCheckpoint(directory, state, reason) {
  if (!state) return;
  try {
    const stateDir = join(directory, ".oh-my-beads", "state");
    const handoffsDir = join(directory, ".oh-my-beads", "handoffs");
    const now = new Date().toISOString();

    // Write checkpoint JSON
    if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
    const checkpoint = {
      checkpointed_at: now,
      reason,
      phase: state.current_phase || "unknown",
      feature: state.feature_slug || "unknown",
      reinforcement_count: state.reinforcement_count || 0,
      failure_count: state.failure_count || 0,
    };
    writeJson(join(stateDir, "checkpoint.json"), checkpoint);

    // Write handoff markdown
    if (!existsSync(handoffsDir)) mkdirSync(handoffsDir, { recursive: true });
    const handoff =
      `## Handoff: ${reason} checkpoint\n\n` +
      `**Phase:** ${checkpoint.phase}\n` +
      `**Feature:** ${checkpoint.feature}\n` +
      `**Time:** ${now}\n` +
      `**Reinforcements:** ${checkpoint.reinforcement_count}\n\n` +
      `### Resume\n` +
      `1. Read .oh-my-beads/state/session.json for current phase\n` +
      `2. Check beads_village ls(status="ready") for next work\n`;
    writeFileSync(join(handoffsDir, `checkpoint-${Date.now()}.md`), handoff);
  } catch { /* best effort */ }
}

// --- Main ---
async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  let data = {};
  try { data = JSON.parse(input); } catch {}

  const directory = data.cwd || data.directory || process.cwd();
  const stateFile = join(directory, ".oh-my-beads", "state", "session.json");

  // Read session state early (needed for checkpoint on context_limit)
  const state = readJson(stateFile);

  // Safety: never block context-limit stops (prevents compaction deadlock)
  // But DO write a checkpoint before allowing
  if (isContextLimitStop(data)) {
    writeCheckpoint(directory, state, "context_limit");
    allowStop();
    return;
  }

  // Safety: respect user abort (Ctrl+C)
  if (isUserAbort(data)) { allowStop(); return; }

  // No active session → allow stop
  if (!state || !state.active) { allowStop(); return; }

  // Stale state (>2 hours) → allow stop
  if (isStale(state)) { allowStop(); return; }

  // Terminal phase → allow stop
  const phase = state.current_phase || "unknown";
  if (TERMINAL_PHASES.has(phase)) { allowStop(); return; }

  // Cancel signal → allow stop
  if (state.cancel_requested) { allowStop(); return; }

  // Circuit breaker: max reinforcements reached → allow stop
  const count = (state.reinforcement_count || 0) + 1;
  if (count > MAX_REINFORCEMENTS) {
    state.active = false;
    state.deactivated_reason = "max_reinforcements_reached";
    state.last_checked_at = new Date().toISOString();
    writeJson(stateFile, state);
    allowStop();
    return;
  }

  // BLOCK THE STOP — session is active, phase is not terminal
  state.reinforcement_count = count;
  state.last_checked_at = new Date().toISOString();
  writeJson(stateFile, state);

  const continuation = PHASE_CONTINUATIONS[phase] || `Continue working on phase: ${phase}.`;
  const feature = state.feature_slug ? ` Feature: ${state.feature_slug}.` : "";

  blockStop(
    `[OH-MY-BEADS — Phase: ${phase} | Reinforcement ${count}/${MAX_REINFORCEMENTS}] ` +
    `The 8-step workflow is active.${feature} ${continuation} ` +
    `Do NOT stop until all 8 phases complete. ` +
    `When finished, set session.json active=false or say "cancel omb".`
  );
}

main().catch(() => allowStop());
