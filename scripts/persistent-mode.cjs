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
 * Claude Code Stop hook input schema:
 *   - hook_event_name: 'Stop'
 *   - stop_hook_active: boolean
 *   - last_assistant_message?: string
 *   - session_id, transcript_path, cwd (base fields)
 *
 * NOTE: Claude Code does NOT send stop_reason, user_requested, or
 * context_limit fields. Context limits and user aborts are handled
 * by the engine BEFORE the Stop hook fires. The Stop hook only fires
 * when the model decides to stop on its own.
 *
 * Safety:
 * - Max 50 reinforcements before allowing stop (circuit breaker)
 * - 2-hour staleness timeout (prevents blocking new sessions)
 * - Respects cancel signals from keyword-detector
 * - Pre-compact checkpoint writing for session recovery
 */

const { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } = require("fs");
const { join, dirname } = require("path");
const { createHash } = require("crypto");
const { homedir } = require("os");
const { readJson, writeJsonAtomic: writeJson } = require("./helpers.cjs");

// --- Constants ---
const MAX_REINFORCEMENTS = 50;
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

// --- Inline system-level state dir resolution (CJS cannot import ESM) ---
function getSystemRoot() {
  return process.env.OMB_HOME || join(homedir(), ".oh-my-beads");
}

function pHash(cwd) {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 8);
}

function resolveStateDirCjs(directory, data) {
  const sessionId = data?.session_id ?? data?.sessionId ?? process.env.CLAUDE_SESSION_ID ?? null;
  const projectRoot = join(getSystemRoot(), "projects", pHash(directory));
  if (sessionId) return join(projectRoot, "sessions", sessionId);
  return projectRoot;
}

// Legacy path for migration fallback reads
function resolveLegacyStateDirCjs(directory, data) {
  const sessionId = data?.session_id ?? data?.sessionId ?? process.env.CLAUDE_SESSION_ID ?? null;
  if (sessionId) return join(directory, ".oh-my-beads", "state", "sessions", sessionId);
  return join(directory, ".oh-my-beads", "state");
}

const TERMINAL_PHASES = new Set([
  "complete", "completed", "failed", "cancelled", "canceled",
  "fast_complete",
]);

const PHASE_CONTINUATIONS = {
  // Mr.Beads phases (8-step workflow)
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
  // Mr.Fast phases (lightweight workflow)
  "fast_bootstrap":           "Continue Mr.Fast: Spawn Fast Scout for rapid analysis.",
  "fast_scout":               "Continue Mr.Fast: Scout is analyzing the issue. Wait for analysis summary.",
  "fast_execution":           "Continue Mr.Fast: Executor is implementing the fix. Wait for completion.",
};

// --- Helpers ---
// readJson and writeJson (alias for writeJsonAtomic) imported from helpers.cjs

function isStale(state) {
  if (!state) return true;
  const lastChecked = state.last_checked_at ? new Date(state.last_checked_at).getTime() : 0;
  const startedAt = state.started_at ? new Date(state.started_at).getTime() : 0;
  const mostRecent = Math.max(lastChecked, startedAt);
  if (mostRecent === 0) return true;
  return (Date.now() - mostRecent) > STALE_THRESHOLD_MS;
}

function allowStop() {
  process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }));
}

function blockStop(reason) {
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}

function writeCheckpoint(stateDir, directory, state, reason) {
  if (!state) return;
  try {
    const handoffsDir = join(getSystemRoot(), "projects", pHash(directory), "handoffs");
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
  const stateDir = resolveStateDirCjs(directory, data);
  const stateFile = join(stateDir, "session.json");
  const legacyStateDir = resolveLegacyStateDirCjs(directory, data);
  const legacyStateFile = join(legacyStateDir, "session.json");

  // Read session state — prefer system-level; legacy is migration fallback.
  // If both exist, use the newer one. Always write to system-level only.
  const sysState = readJson(stateFile);
  const legacyState = readJson(legacyStateFile);
  let state;
  if (!sysState && !legacyState) {
    state = null;
  } else if (!sysState) {
    state = legacyState;
  } else if (!legacyState) {
    state = sysState;
  } else {
    // Both exist — pick the one with the most recent started_at
    const sysTime = sysState.started_at ? new Date(sysState.started_at).getTime() : 0;
    const legTime = legacyState.started_at ? new Date(legacyState.started_at).getTime() : 0;
    state = legTime > sysTime ? legacyState : sysState;
  }
  // Always write to system-level path (no legacy writes)
  const effectiveStateFile = stateFile;

  // No active session → allow stop
  if (!state || !state.active) { allowStop(); return; }

  // Stale state (>2 hours) → allow stop
  if (isStale(state)) { allowStop(); return; }

  // Terminal phase → allow stop
  const phase = state.current_phase || "unknown";
  if (TERMINAL_PHASES.has(phase)) { allowStop(); return; }

  // Cancel signal (set by keyword-detector) → allow stop
  if (state.cancel_requested) { allowStop(); return; }

  // Cancel signal file with TTL → allow stop (prevents TOCTOU race)
  // Check both system-level and legacy dirs
  const cancelSignal = readJson(join(stateDir, "cancel-signal.json"))
    ?? readJson(join(legacyStateDir, "cancel-signal.json"));
  if (cancelSignal && cancelSignal.expires_at) {
    const expiresAt = new Date(cancelSignal.expires_at).getTime();
    if (Date.now() < expiresAt) { allowStop(); return; }
  }

  // Awaiting confirmation (skill not yet initialized) → allow stop
  if (state.awaiting_confirmation) { allowStop(); return; }

  // Circuit breaker: max reinforcements reached → allow stop + deactivate
  const count = (state.reinforcement_count || 0) + 1;
  if (count > MAX_REINFORCEMENTS) {
    state.active = false;
    state.deactivated_reason = "max_reinforcements_reached";
    state.last_checked_at = new Date().toISOString();
    writeJson(effectiveStateFile, state);
    allowStop();
    return;
  }

  // BLOCK THE STOP — session is active, phase is not terminal
  state.reinforcement_count = count;
  state.last_checked_at = new Date().toISOString();
  writeJson(effectiveStateFile, state);

  const continuation = PHASE_CONTINUATIONS[phase] || `Continue working on phase: ${phase}.`;
  const feature = state.feature_slug ? ` Feature: ${state.feature_slug}.` : "";
  const mode = state.mode || "mr.beads";
  const modeLabel = mode === "mr.fast" ? "Mr.Fast" : "Oh-My-Beads (Mr.Beads)";
  const workflowDesc = mode === "mr.fast" ? "The Mr.Fast workflow is active." : "The 8-step workflow is active.";

  blockStop(
    `[${modeLabel.toUpperCase()} — Phase: ${phase} | Reinforcement ${count}/${MAX_REINFORCEMENTS}] ` +
    `${workflowDesc}${feature} ${continuation} ` +
    `Do NOT stop until all phases complete. ` +
    `When finished, set session.json active=false or say "cancel omb".`
  );
}

main().catch(() => allowStop());
