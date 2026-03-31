#!/usr/bin/env node

/**
 * oh-my-beads session start hook.
 *
 * On SessionStart:
 * 1. Checks if beads_village MCP is available (via tool list heuristic)
 * 2. Loads .oh-my-beads/state/session.json for resume context
 * 3. Emits bootstrap context with AGENTS.md reference
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

const STATE_FILE = join(process.cwd(), ".oh-my-beads", "state", "session.json");
const AGENTS_FILE = join(process.cwd(), "AGENTS.md");

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

// --- Main ---
const parts = [];

// Plugin presence banner
parts.push("oh-my-beads plugin loaded. Use /oh-my-beads:using-oh-my-beads or keyword 'omb' to start.");

// Check for active session to resume
if (existsSync(STATE_FILE)) {
  try {
    const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    if (state.active) {
      parts.push(
        `\nACTIVE SESSION DETECTED — Phase: ${state.phase || "unknown"}, started: ${state.startedAt || "unknown"}.` +
        `\nResume by saying "omb" or start fresh with "cancel omb" first.`
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
