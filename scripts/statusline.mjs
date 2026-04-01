#!/usr/bin/env node

/**
 * oh-my-beads HUD — OMC-style statusline for Claude Code.
 *
 * Reads stdin JSON from Claude Code (context_window, model, cwd, transcript_path)
 * plus .oh-my-beads/state/ files to render a rich multi-element status line.
 *
 * Output examples:
 *   [OMB#1.1.0] Mr.Beads | Phase 6: Execution | ctx:67% | session:12m | beads:3/8 | R:3 F:0
 *   [OMB#1.1.0] Mr.Fast | Implementing | ctx:42% | session:2m | F:0
 *   [OMB#1.1.0] idle
 *
 * Reads from stdin (Claude Code statusline JSON) and .oh-my-beads/state/.
 * Zero dependencies. Never writes to stderr. Always exits 0.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getProjectStateRoot } from "./state-tools/resolve-state-dir.mjs";

// --- ANSI Colors ---
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";

// --- Version ---
const VERSION = (() => {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pluginPath = join(__dirname, "..", ".claude-plugin", "plugin.json");
    if (existsSync(pluginPath)) {
      return JSON.parse(readFileSync(pluginPath, "utf8")).version || "1.1.0";
    }
  } catch {}
  return "1.1.0";
})();

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
  fast_turbo:             "Turbo ⚡",
  fast_execution:         "Implementing",
  fast_complete:          "Complete",
  complete:               "Complete",
  completed:              "Completed",
  cancelled:              "Cancelled",
  failed:                 "Failed",
};

// --- Context thresholds ---
const CTX_WARNING = 70;
const CTX_COMPACT = 80;
const CTX_CRITICAL = 85;

// --- Helpers ---

function readJSON(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readSession(directory) {
  // System-level first, then legacy fallback
  const systemPath = join(getProjectStateRoot(directory), "session.json");
  const result = readJSON(systemPath);
  if (result) return result;
  return readJSON(join(directory, ".oh-my-beads", "state", "session.json"));
}

function readSubagentTracking(directory) {
  const systemPath = join(getProjectStateRoot(directory), "subagent-tracking.json");
  const result = readJSON(systemPath);
  if (result) return result;
  return readJSON(join(directory, ".oh-my-beads", "state", "subagent-tracking.json"));
}

function readToolTracking(directory) {
  const systemPath = join(getProjectStateRoot(directory), "tool-tracking.json");
  const result = readJSON(systemPath);
  if (result) return result;
  return readJSON(join(directory, ".oh-my-beads", "state", "tool-tracking.json"));
}

function formatMode(mode) {
  if (mode === "mr.fast") return `${CYAN}Mr.Fast${RESET}`;
  return `${MAGENTA}Mr.Beads${RESET}`;
}

function formatPhase(phase) {
  if (!phase) return "Unknown";
  return PHASE_DISPLAY[phase] || phase;
}

function getPhaseColor(phase) {
  if (!phase) return DIM;
  if (phase.startsWith("gate_")) return YELLOW;
  if (phase === "complete" || phase === "completed" || phase === "fast_complete") return GREEN;
  if (phase === "cancelled" || phase === "failed") return RED;
  if (phase === "phase_6_execution" || phase === "fast_execution" || phase === "fast_turbo") return CYAN;
  if (phase === "phase_7_review" || phase === "phase_5_validation") return MAGENTA;
  return "";
}

// --- Context Element ---

function renderContext(percent) {
  if (percent == null || percent < 0) return null;
  const safePercent = Math.min(100, Math.max(0, Math.round(percent)));

  let color, suffix;
  if (safePercent >= CTX_CRITICAL) {
    color = RED; suffix = " CRITICAL";
  } else if (safePercent >= CTX_COMPACT) {
    color = YELLOW; suffix = " COMPRESS?";
  } else if (safePercent >= CTX_WARNING) {
    color = YELLOW; suffix = "";
  } else {
    color = GREEN; suffix = "";
  }

  return `ctx:${color}${safePercent}%${suffix}${RESET}`;
}

function renderContextWithBar(percent) {
  if (percent == null || percent < 0) return null;
  const safePercent = Math.min(100, Math.max(0, Math.round(percent)));
  const barWidth = 10;
  const filled = Math.round((safePercent / 100) * barWidth);
  const empty = barWidth - filled;

  let color, suffix;
  if (safePercent >= CTX_CRITICAL) {
    color = RED; suffix = " CRITICAL";
  } else if (safePercent >= CTX_COMPACT) {
    color = YELLOW; suffix = " COMPRESS?";
  } else if (safePercent >= CTX_WARNING) {
    color = YELLOW; suffix = "";
  } else {
    color = GREEN; suffix = "";
  }

  const bar = `${color}${"█".repeat(filled)}${DIM}${"░".repeat(empty)}${RESET}`;
  return `ctx:[${bar}]${color}${safePercent}%${suffix}${RESET}`;
}

// --- Session Duration Element ---

function renderSessionDuration(startedAt) {
  if (!startedAt) return null;
  try {
    const start = new Date(startedAt);
    const durationMs = Date.now() - start.getTime();
    const minutes = Math.floor(durationMs / 60_000);

    let color;
    if (minutes > 120) color = RED;
    else if (minutes > 60) color = YELLOW;
    else color = GREEN;

    if (minutes < 1) return `session:${color}<1m${RESET}`;
    if (minutes < 60) return `session:${color}${minutes}m${RESET}`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `session:${color}${hours}h${mins}m${RESET}`;
  } catch {
    return null;
  }
}

// --- Agents Element ---

const AGENT_CODES = {
  master: "M", scout: "S", "fast-scout": "F", architect: "A",
  worker: "W", reviewer: "R", explorer: "e", executor: "x",
  verifier: "V", "code-reviewer": "CR", "security-reviewer": "K",
  "test-engineer": "T",
};

function getAgentCode(role) {
  return AGENT_CODES[role] || role.charAt(0).toUpperCase();
}

function getModelColor(model) {
  if (!model) return CYAN;
  const m = (model || "").toLowerCase();
  if (m.includes("opus")) return MAGENTA;
  if (m.includes("sonnet")) return YELLOW;
  if (m.includes("haiku")) return GREEN;
  return CYAN;
}

function renderAgents(tracking) {
  if (!tracking || !tracking.agents) return null;
  const running = tracking.agents.filter(a => a.status === "running");
  if (running.length === 0) return null;

  const codes = running.map(a => {
    const code = getAgentCode(a.role || "unknown");
    const color = getModelColor(a.model);
    return `${color}${code}${RESET}`;
  });

  return `agents:${codes.join("")}`;
}

// --- Beads Progress Element ---

function renderBeads(session) {
  const created = session.beads_created || 0;
  const closed = session.beads_closed || 0;
  if (created === 0) return null;

  let color;
  if (closed >= created) color = GREEN;
  else if (closed > 0) color = YELLOW;
  else color = DIM;

  return `beads:${color}${closed}/${created}${RESET}`;
}

// --- Files Modified Element ---

function renderFilesModified(toolTracking) {
  if (!toolTracking || !toolTracking.files_modified) return null;
  const count = toolTracking.files_modified.length;
  if (count === 0) return null;
  return `${DIM}files:${count}${RESET}`;
}

// --- Counters Element ---

function renderCounters(session) {
  const parts = [];
  if (session.mode !== "mr.fast") {
    const r = session.reinforcement_count || 0;
    parts.push(`reinforcements:${r > 10 ? RED : r > 5 ? YELLOW : GREEN}${r}${RESET}`);
  }
  const f = session.failure_count || 0;
  parts.push(`failures:${f > 3 ? RED : f > 0 ? YELLOW : GREEN}${f}${RESET}`);
  return parts.join(" ");
}

// --- Main Statusline Builder ---

function buildStatus(session, stdin, directory) {
  const elements = [];
  const sep = `${DIM} | ${RESET}`;

  // [OMB#1.1.0] label
  elements.push(`${BOLD}[OMB#${VERSION}]${RESET}`);

  if (!session || !session.active) {
    elements.push(`${DIM}idle${RESET}`);
    // Even when idle, show context if available
    const ctxPercent = stdin?.context_window?.used_percentage;
    const ctx = renderContext(ctxPercent);
    if (ctx) elements.push(ctx);
    return elements.join(sep);
  }

  // Mode
  elements.push(formatMode(session.mode));

  // Phase
  const phase = formatPhase(session.current_phase);
  const phaseColor = getPhaseColor(session.current_phase);
  elements.push(`${phaseColor}${phase}${RESET}`);

  // Context window (from stdin)
  const ctxPercent = stdin?.context_window?.used_percentage;
  if (ctxPercent != null) {
    const ctx = renderContextWithBar(ctxPercent);
    if (ctx) elements.push(ctx);
  }

  // Session duration
  const sessionEl = renderSessionDuration(session.started_at);
  if (sessionEl) elements.push(sessionEl);

  // Active agents
  const tracking = readSubagentTracking(directory);
  const agentsEl = renderAgents(tracking);
  if (agentsEl) elements.push(agentsEl);

  // Beads progress (Mr.Beads only)
  if (session.mode !== "mr.fast") {
    const beadsEl = renderBeads(session);
    if (beadsEl) elements.push(beadsEl);
  }

  // Files modified
  const toolTracking = readToolTracking(directory);
  const filesEl = renderFilesModified(toolTracking);
  if (filesEl) elements.push(filesEl);

  // R/F counters
  elements.push(renderCounters(session));

  return elements.join(sep);
}

// --- Stdin Reading ---

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve(null);
      return;
    }
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => {
      const trimmed = data.trim();
      if (!trimmed) { resolve(null); return; }
      try { resolve(JSON.parse(trimmed)); } catch { resolve(null); }
    });
    process.stdin.on("error", () => resolve(null));
    // Safety timeout — never hang
    setTimeout(() => resolve(null), 3000);
  });
}

// --- Main ---

async function main() {
  // Support both stdin (Claude Code statusline) and argv (manual invocation)
  const stdin = await readStdin();
  let directory = process.cwd();

  if (stdin?.cwd) {
    directory = stdin.cwd;
  } else if (process.argv[2]) {
    directory = process.argv[2];
  }

  const session = readSession(directory);
  const output = buildStatus(session, stdin, directory);

  // Replace spaces with non-breaking spaces for terminal alignment (OMC pattern)
  const formatted = output.replace(/ /g, "\u00A0");
  process.stdout.write(formatted + "\n");
}

main();
