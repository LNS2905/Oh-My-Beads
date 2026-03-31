#!/usr/bin/env node

/**
 * oh-my-beads session start hook.
 *
 * On SessionStart:
 * 1. Checks `source` field for auto-resume after compaction
 * 2. Loads .oh-my-beads/state/session.json for resume context
 * 3. Loads checkpoint.json + latest handoff when resuming from compaction
 * 4. Emits bootstrap context with AGENTS.md reference
 *
 * Claude Code SessionStart input fields:
 *   - source: 'startup' | 'resume' | 'clear' | 'compact'
 *   - model, agent_type (optional)
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

function hookOutput(additionalContext) {
  const output = {
    continue: true,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      ...(additionalContext ? { additionalContext } : {}),
    },
  };
  process.stdout.write(JSON.stringify(output));
}

function readJson(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch { return null; }
}

function getLatestHandoff(handoffsDir) {
  try {
    if (!existsSync(handoffsDir)) return null;
    const files = readdirSync(handoffsDir)
      .filter(f => f.endsWith(".md"))
      .sort()
      .reverse();
    if (files.length === 0) return null;
    return readFileSync(join(handoffsDir, files[0]), "utf8");
  } catch { return null; }
}

// --- Main ---
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let data = {};
  try {
    data = JSON.parse(input.trim());
  } catch {
    // No input or invalid JSON — use defaults
  }

  const cwd = data.cwd || data.directory || process.cwd();
  const source = data.source || "startup";
  const STATE_FILE = join(cwd, ".oh-my-beads", "state", "session.json");
  const CHECKPOINT_FILE = join(cwd, ".oh-my-beads", "state", "checkpoint.json");
  const HANDOFFS_DIR = join(cwd, ".oh-my-beads", "handoffs");
  const AGENTS_FILE = join(cwd, "AGENTS.md");

  const parts = [];

  // Plugin presence banner
  parts.push("oh-my-beads plugin loaded. Modes: Mr.Beads ('omb') for full workflow, Mr.Fast ('mr.fast') for quick fixes.");

  // Post-compaction auto-resume: load checkpoint + handoff
  if (source === "compact") {
    const checkpoint = readJson(CHECKPOINT_FILE);
    const handoff = getLatestHandoff(HANDOFFS_DIR);

    if (checkpoint) {
      const phase = checkpoint.phase || checkpoint.session?.current_phase || "unknown";
      const feature = checkpoint.feature || checkpoint.session?.feature_slug || "unknown";
      parts.push(
        `\n[oh-my-beads] POST-COMPACTION RESUME` +
        `\nPhase: ${phase} | Feature: ${feature}` +
        `\nCheckpointed at: ${checkpoint.checkpointed_at || "unknown"}` +
        `\nReinforcements: ${checkpoint.reinforcement_count || checkpoint.session?.reinforcement_count || 0}`
      );

      if (checkpoint.active_subagents?.length > 0) {
        parts.push(`Active subagents that may need re-spawning: ${checkpoint.active_subagents.map(a => `${a.role}(${a.id})`).join(", ")}`);
      }
    }

    if (handoff) {
      // Include handoff (truncated to avoid context bloat)
      const truncated = handoff.length > 1500 ? handoff.substring(0, 1500) + "\n...(truncated)" : handoff;
      parts.push(`\n### Last Handoff\n${truncated}`);
    }

    if (checkpoint || handoff) {
      parts.push(
        `\nRESUME STEPS:` +
        `\n1. Read .oh-my-beads/state/session.json for current phase` +
        `\n2. Read AGENTS.md for workflow rules` +
        `\n3. Check beads_village ls(status="ready") for next work` +
        `\n4. Continue from the phase indicated above`
      );
    }
  }

  // Check for active session (startup or resume)
  if (source !== "compact" && existsSync(STATE_FILE)) {
    try {
      const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
      if (state.active) {
        const mode = state.mode || "mr.beads";
        const modeLabel = mode === "mr.fast" ? "Mr.Fast" : "Mr.Beads";
        parts.push(
          `\nACTIVE SESSION DETECTED — Mode: ${modeLabel}, Phase: ${state.current_phase || state.phase || "unknown"}, started: ${state.started_at || state.startedAt || "unknown"}.` +
          `\nResume by saying "${mode === "mr.fast" ? "mr.fast" : "omb"}" or start fresh with "cancel omb" first.`
        );
      }
    } catch {
      // Corrupted state — ignore
    }
  }

  // Reference AGENTS.md for orchestration rules
  if (existsSync(AGENTS_FILE)) {
    parts.push("\nOrchestration rules: see AGENTS.md in project root.");
  }

  hookOutput(parts.join("\n"));
});
