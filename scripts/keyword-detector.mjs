#!/usr/bin/env node

/**
 * oh-my-beads keyword detector — UserPromptSubmit hook.
 *
 * Detects "oh-my-beads" / "omb" keywords in user prompts and signals the
 * skill-loader to invoke the using-oh-my-beads bootstrap skill.
 * Also handles "cancel omb" / "stop omb" to clear active sessions.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { upgradePrompt } from "./prompt-leverage.mjs";
import { getProjectStateRoot, ensureDir } from "./state-tools/resolve-state-dir.mjs";
import { hookOutput as _hookOutput, getQuietLevel } from "./helpers.mjs";

// --- Config ---
const KEYWORDS = [
  // Cancel patterns (check first — order matters)
  { pattern: /\b(?:cancel\s*mr\.?fast|stop\s*mr\.?fast)\b/i, action: "cancel" },
  { pattern: /\b(?:cancel\s*mr\.?beads|stop\s*mr\.?beads)\b/i, action: "cancel" },
  { pattern: /\b(?:cancel\s*omb|stop\s*omb|cancel\s*oh-my-beads)\b/i, action: "cancel" },
  // Update pattern (before invoke patterns to avoid omb catching it)
  { pattern: /\b(?:update\s*omb|omb\s*update|update\s*oh-my-beads|upgrade\s*omb|omb\s*upgrade)\b/i, action: "update" },
  // Invoke patterns (mr.fast before omb to avoid omb catching everything)
  { pattern: /\b(?:mr\.?\s*fast|mrfast)\b/i, action: "invoke-fast" },
  { pattern: /\b(?:mr\.?\s*beads|mrbeads)\b/i, action: "invoke" },
  { pattern: /\b(?:oh-my-beads|omb)\b/i, action: "invoke" },
];

function getStateDir() {
  return getProjectStateRoot(process.cwd());
}

// --- Helpers ---
function extractPrompt(input) {
  try {
    const data = JSON.parse(input);
    // Claude Code sends `prompt` field for UserPromptSubmit hook.
    // `query` and `message` are legacy fallbacks for test compatibility.
    return data.prompt ?? data.query ?? data.message ?? (typeof data === "string" ? data : "");
  } catch {
    return input; // plain text
  }
}

function sanitize(text) {
  return text
    .replace(/<[^>]+>/g, "")       // strip XML/HTML tags
    .replace(/`[^`]+`/g, "")       // strip inline code
    .replace(/```[\s\S]*?```/g, "") // strip fenced code blocks
    .replace(/https?:\/\/\S+/g, "") // strip URLs
    .replace(/[\/\\][\w.\-\/\\]+/g, ""); // strip file paths
}

function isInformational(text, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const kwRegex = new RegExp(escaped, "gi");
  let match;
  while ((match = kwRegex.exec(text)) !== null) {
    // Check ±80 char context window around the match
    const start = Math.max(0, match.index - 80);
    const end = Math.min(text.length, match.index + match[0].length + 80);
    const window = text.slice(start, end).toLowerCase();
    // English inquiry patterns
    if (/(?:what|how|why|explain|describe|tell\s+me\s+about|does|can|is\s+there|when\s+to\s+use|where|who)\s+(?:is|does|are|do|should|would|could|can)?/.test(window)) return true;
    // Trailing question mark within window
    if (/\?\s*$/.test(window.trim())) return true;
  }
  return false;
}

const hookOutput = (additionalContext) => {
  const quiet = getQuietLevel();
  // At quiet level 2, suppress non-critical keyword output (informational parts).
  // MAGIC KEYWORD routing and cancel signals are always critical.
  if (quiet >= 2 && additionalContext && !additionalContext.includes("MAGIC KEYWORD") && !additionalContext.includes("cancel-omb")) {
    _hookOutput("UserPromptSubmit", null);
    return;
  }
  _hookOutput("UserPromptSubmit", additionalContext);
};

function ensureStateDirs() {
  ensureDir(getStateDir());
}

function writeSessionState(phase, mode = "mr.beads") {
  ensureStateDirs();
  const state = {
    current_phase: phase,
    active: true,
    mode,
    started_at: new Date().toISOString(),
    reinforcement_count: 0,
    awaiting_confirmation: true,
  };
  const content = JSON.stringify(state, null, 2);
  writeFileSync(join(getStateDir(), "session.json"), content);
}

function clearSessionState() {
  const stateDir = getStateDir();
  const sessionFile = join(stateDir, "session.json");
  // Write cancel signal file with 30s TTL to prevent TOCTOU race
  try {
    ensureStateDirs();
    const signal = {
      cancelled_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30_000).toISOString(),
    };
    const signalContent = JSON.stringify(signal, null, 2);
    writeFileSync(join(stateDir, "cancel-signal.json"), signalContent);
  } catch { /* best effort */ }
  // Deactivate session state (system-level only)
  if (existsSync(sessionFile)) {
    try {
      const state = JSON.parse(readFileSync(sessionFile, "utf8"));
      state.active = false;
      state.current_phase = "cancelled";
      state.cancelled_at = new Date().toISOString();
      writeFileSync(sessionFile, JSON.stringify(state, null, 2));
    } catch {
      rmSync(sessionFile, { force: true });
    }
  }
}

// --- Main ---
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  // Guard: skip keyword matching for subagent workers (prevents infinite spawn loops)
  if (process.env.OMB_AGENT_ROLE || process.env.OMB_TEAM_WORKER) {
    hookOutput(null);
    return;
  }

  const raw = extractPrompt(input.trim());
  const clean = sanitize(raw);

  for (const kw of KEYWORDS) {
    if (!kw.pattern.test(clean)) continue;

    // Skip informational context ("what is omb?", "what is mr.fast?")
    if (kw.action === "invoke" && (isInformational(clean, "omb") || isInformational(clean, "oh-my-beads") || isInformational(clean, "mr.beads") || isInformational(clean, "mrbeads"))) continue;
    if (kw.action === "invoke-fast" && (isInformational(clean, "mr.fast") || isInformational(clean, "mrfast"))) continue;
    if (kw.action === "update" && (isInformational(clean, "update omb") || isInformational(clean, "omb update"))) continue;

    if (kw.action === "cancel") {
      clearSessionState();
      hookOutput("[MAGIC KEYWORD: cancel-omb]\n\nYou MUST cancel the active oh-my-beads session. Clear state and report.");
      return;
    }

    if (kw.action === "update") {
      hookOutput(
        `[MAGIC KEYWORD: update-omb]\n\nYou MUST invoke the skill using the Skill tool:\n\nSkill: oh-my-beads:update-plugin\n\nUser request:\n${raw}\n\nIMPORTANT: Invoke the skill IMMEDIATELY. Do not proceed without loading the skill instructions.`
      );
      return;
    }

    if (kw.action === "invoke-fast") {
      writeSessionState("fast_bootstrap", "mr.fast");
      const { augmented } = upgradePrompt(raw, { mode: "mr.fast" });
      hookOutput(
        `[MAGIC KEYWORD: mr-fast]\n\nYou MUST invoke the skill using the Skill tool:\n\nSkill: oh-my-beads:mr-fast\n\nUser request:\n${augmented}\n\nIMPORTANT: Invoke the skill IMMEDIATELY. Do not proceed without loading the skill instructions.`
      );
      return;
    }

    // Activate Mr.Beads (default mode)
    writeSessionState("bootstrap", "mr.beads");
    const { augmented } = upgradePrompt(raw, { mode: "mr.beads" });
    hookOutput(
      `[MAGIC KEYWORD: oh-my-beads]\n\nYou MUST invoke the skill using the Skill tool:\n\nSkill: oh-my-beads:using-oh-my-beads\n\nUser request:\n${augmented}\n\nIMPORTANT: Invoke the skill IMMEDIATELY. Do not proceed without loading the skill instructions.`
    );
    return;
  }

  // No keyword matched — pass through
  hookOutput(null);
});
