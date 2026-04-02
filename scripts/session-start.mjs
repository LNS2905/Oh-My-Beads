#!/usr/bin/env node

/**
 * oh-my-beads session start hook.
 *
 * On SessionStart:
 * 1. Shows compact plugin banner with version, keywords, elapsed time
 * 2. Checks `source` field for auto-resume after compaction
 * 3. Loads .oh-my-beads/state/session.json for resume context
 * 4. For Mr.Fast sessions: offers Resume / Restart / Cancel options
 * 5. Loads checkpoint.json + latest handoff when resuming from compaction
 * 6. Emits bootstrap context with AGENTS.md reference
 *
 * Claude Code SessionStart input fields:
 *   - source: 'startup' | 'resume' | 'clear' | 'compact'
 *   - model, agent_type (optional)
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import { getSystemRoot, getProjectStateRoot, resolveHandoffsDir, ensureRuntimeDirs, readJsonSafe } from "./state-tools/resolve-state-dir.mjs";
import { readJson, hookOutput as _hookOutput } from "./helpers.mjs";
import { loadMemory, needsRescan, rescan, saveMemory, formatSummary } from "./project-memory.mjs";

const PLUGIN_VERSION = "v1.2.0";

const hookOutput = (additionalContext) => {
  _hookOutput("SessionStart", additionalContext);
};

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

function formatElapsed(startedAt) {
  try {
    const start = new Date(startedAt);
    const now = new Date();
    const diffMs = now - start;
    if (diffMs < 0 || isNaN(diffMs)) return null;
    const mins = Math.floor(diffMs / 60000);
    const hours = Math.floor(mins / 60);
    const remainMins = mins % 60;
    if (hours > 0) return `${hours}h ${remainMins}m`;
    return `${mins}m`;
  } catch { return null; }
}

function getPluginVersion(cwd) {
  try {
    const pluginJson = readJson(join(cwd, ".claude-plugin", "plugin.json"));
    if (pluginJson && pluginJson.version) return `v${pluginJson.version}`;
  } catch { /* ignore */ }
  return PLUGIN_VERSION;
}

/**
 * Check Node.js version — warn if below 18.
 * Returns a warning string or null.
 */
function checkNodeVersion() {
  const major = parseInt(process.versions.node.split(".")[0], 10);
  if (major < 18) {
    return `[WARNING] Node.js ${process.versions.node} detected. oh-my-beads requires Node.js 18+. Some features may not work.`;
  }
  return null;
}

/**
 * Check if beads-village MCP server is available.
 * Returns a warning string or null.
 */
function checkBeadsVillage() {
  try {
    execFileSync("which", ["beads-village"], { stdio: "ignore", timeout: 2000 });
    return null;
  } catch {
    // Try npx as fallback
    try {
      execFileSync("npx", ["beads-village", "--version"], { stdio: "ignore", timeout: 2000 });
      return null;
    } catch {
      return `[WARNING] beads-village MCP not found in PATH. Task tracking (beads_village tools) will be unavailable. Install: npm install -g beads-village`;
    }
  }
}

/**
 * Check setup completion state for first-run / update detection.
 * Returns a banner string or null.
 */
function checkSetupState(pluginVersion) {
  try {
    const setupPath = join(getSystemRoot(), "setup.json");
    const setup = readJsonSafe(setupPath);
    if (!setup || !setup.setupCompleted) {
      return `[FIRST RUN] Oh-My-Beads is installed but not configured. Run 'setup omb' to complete installation.`;
    }
    // Compare setupVersion with current plugin version (strip 'v' prefix)
    const currentVer = pluginVersion.replace(/^v/, "");
    const setupVer = (setup.setupVersion || "0.0.0").replace(/^v/, "");
    if (setupVer !== currentVer) {
      return `[UPDATE] Oh-My-Beads updated from v${setupVer} to ${pluginVersion}. Run 'setup omb' to refresh configuration.`;
    }
    return null;
  } catch {
    return null;
  }
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
  const sessionId = data.session_id || data.sessionId || process.env.CLAUDE_SESSION_ID || null;

  // Auto-initialize runtime directories (system-level)
  try { ensureRuntimeDirs(cwd, sessionId); } catch { /* best effort */ }

  // Resolve state paths (system-level)
  const projectStateRoot = getProjectStateRoot(cwd);
  const stateDir = sessionId ? join(projectStateRoot, "sessions", sessionId) : projectStateRoot;
  const STATE_FILE = join(stateDir, "session.json");
  const CHECKPOINT_FILE = join(stateDir, "checkpoint.json");
  const HANDOFFS_DIR = resolveHandoffsDir(cwd);
  const AGENTS_FILE = join(cwd, "AGENTS.md");

  // Legacy fallback: check project-level state if system-level doesn't exist
  const LEGACY_STATE_FILE = join(cwd, ".oh-my-beads", "state", "session.json");

  const parts = [];
  const version = getPluginVersion(cwd);

  // Prerequisite checks (only on startup/resume, not on compact)
  if (source !== "compact") {
    const nodeWarn = checkNodeVersion();
    if (nodeWarn) parts.push(nodeWarn);
    const beadsWarn = checkBeadsVillage();
    if (beadsWarn) parts.push(beadsWarn);
    const setupWarn = checkSetupState(version);
    if (setupWarn) parts.push(setupWarn);
  }

  // Load project memory, rescan if stale (>24h) or missing, inject summary
  try {
    let memory = loadMemory(projectStateRoot);
    if (needsRescan(memory)) {
      memory = rescan(cwd, memory);
      saveMemory(projectStateRoot, memory);
    }
    const memorySummary = formatSummary(memory, 650);
    if (memorySummary) {
      parts.unshift(`[Project Memory]\n${memorySummary}`);
    }
  } catch { /* best effort — don't block session start */ }

  // Enhanced plugin banner (compact, max 5 lines)
  let bannerLine = `oh-my-beads ${version} loaded.`;

  // Check for active session state (system-level first, then legacy fallback)
  let activeState = readJson(STATE_FILE);
  if (!activeState?.active) {
    activeState = readJson(LEGACY_STATE_FILE);
  }
  if (activeState && !activeState.active) activeState = null;

  if (activeState) {
    const mode = activeState.mode || "mr.beads";
    const modeLabel = mode === "mr.fast" ? "Mr.Fast" : "Mr.Beads";
    const elapsed = formatElapsed(activeState.started_at || activeState.startedAt);
    const elapsedStr = elapsed ? ` (${elapsed} elapsed)` : "";
    bannerLine += ` Active: ${modeLabel} [${activeState.current_phase || "unknown"}]${elapsedStr}`;
  }

  parts.push(bannerLine);
  parts.push(`Modes: Mr.Beads ('omb') | Mr.Fast ('mr.fast') | Cancel: 'cancel omb'`);

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

  // Check for active session (startup or resume) — mode-specific handling
  if (source !== "compact" && activeState) {
    const mode = activeState.mode || "mr.beads";
    const modeLabel = mode === "mr.fast" ? "Mr.Fast" : "Mr.Beads";
    const phase = activeState.current_phase || activeState.phase || "unknown";

    if (mode === "mr.fast") {
      // Mr.Fast resume path: offer 3 options
      const elapsed = formatElapsed(activeState.started_at || activeState.startedAt);
      const elapsedStr = elapsed ? ` (${elapsed} ago)` : "";

      let resumeInfo = `\nACTIVE Mr.Fast SESSION — Phase: ${phase}${elapsedStr}`;

      // Include executor progress if available
      if (activeState.failure_count > 0) {
        resumeInfo += ` | Retries: ${activeState.failure_count}`;
      }
      if (activeState.feature_slug) {
        resumeInfo += ` | Task: ${activeState.feature_slug}`;
      }

      resumeInfo += `\nOptions:`;
      resumeInfo += `\n  1. Resume — say "mr.fast" to continue from ${phase}`;
      resumeInfo += `\n  2. Restart — say "mr.fast restart" to clear state and start fresh`;
      resumeInfo += `\n  3. Cancel — say "cancel omb" to deactivate session`;

      parts.push(resumeInfo);
    } else {
      // Mr.Beads resume path (existing behavior)
      parts.push(
        `\nACTIVE SESSION DETECTED — Mode: ${modeLabel}, Phase: ${phase}, started: ${activeState.started_at || activeState.startedAt || "unknown"}.` +
        `\nResume by saying "omb" or start fresh with "cancel omb" first.`
      );
    }
  }

  // Reference AGENTS.md for orchestration rules
  if (existsSync(AGENTS_FILE)) {
    parts.push("\nOrchestration rules: see AGENTS.md in project root.");
  }

  hookOutput(parts.join("\n"));
});
