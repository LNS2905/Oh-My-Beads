#!/usr/bin/env node

/**
 * oh-my-beads keyword detector — UserPromptSubmit hook.
 *
 * Detects "oh-my-beads" / "omb" keywords in user prompts and routes
 * directly to the appropriate skill (master, fast-scout, or executor).
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
  // Setup pattern (before invoke patterns to avoid omb catching it)
  { pattern: /\b(?:setup\s+omb|omb\s+setup|setup\s+oh-my-beads)\b/i, action: "setup" },
  // Doctor pattern (before invoke patterns to avoid omb catching it)
  { pattern: /\b(?:doctor\s+omb|omb\s+doctor|doctor\s+oh-my-beads)\b/i, action: "doctor" },
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

function writeSessionState(phase, mode = "mr.beads", intent = undefined) {
  ensureStateDirs();
  const state = {
    current_phase: phase,
    active: true,
    mode,
    started_at: new Date().toISOString(),
    reinforcement_count: 0,
    awaiting_confirmation: true,
  };
  if (intent) state.intent = intent;
  const content = JSON.stringify(state, null, 2);
  writeFileSync(join(getStateDir(), "session.json"), content);
}

// --- Mr.Fast Intent Classification ---

// Turbo: explicit file+line reference AND/OR explicit approach targeting a specific file
const TURBO_PATTERNS = [
  // file.ext:linenum — explicit file with line number
  /[\w./\\-]+\.\w{1,5}\s*:\s*\d+/i,
  // line N of/in file.ext — line number referencing a file
  /\bline\s+\d+\s+(?:of|in)\s+[\w./\\-]+\.\w{1,5}\b/i,
  // on line N of/in file.ext
  /\bon\s+line\s+\d+\s+(?:of|in)\s+[\w./\\-]+\.\w{1,5}\b/i,
  // fix/change/update X in file.ext — specific action targeting a specific file
  /\b(?:fix|change|replace|update|remove|add|rename)\b.{0,60}\b(?:in|at|on)\s+[\w./\\-]+\.\w{1,5}\b/i,
];

// Complex: large-scope work → suggest Mr.Beads instead
const COMPLEX_PATTERNS = [
  /\brefactor\s+(?:the\s+)?entire\b/i,
  /\bredesign\b/i,
  /\brebuild\b/i,
  /\bnew\s+system\b/i,
  /\bmultiple\s+modules\b/i,
  /\brewrite\s+(?:the\s+)?(?:entire|all|whole)\b/i,
  /\boverhaul\b/i,
  /\bfrom\s+scratch\b/i,
];

/**
 * Classify the user's Mr.Fast prompt into an intent tier.
 * @param {string} rawPrompt - The raw user prompt (before sanitization)
 * @returns {"turbo"|"standard"|"complex"}
 */
function classifyFastIntent(rawPrompt) {
  // Check complex first — complex overrides turbo
  for (const pattern of COMPLEX_PATTERNS) {
    if (pattern.test(rawPrompt)) return "complex";
  }

  // Check turbo patterns (explicit file + approach)
  for (const pattern of TURBO_PATTERNS) {
    if (pattern.test(rawPrompt)) return "turbo";
  }

  // Default to standard (safest path for ambiguous prompts)
  return "standard";
}

function readCurrentSession() {
  const sessionFile = join(getStateDir(), "session.json");
  if (!existsSync(sessionFile)) return null;
  try {
    return JSON.parse(readFileSync(sessionFile, "utf8"));
  } catch {
    return null;
  }
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
    if (kw.action === "setup" && (isInformational(clean, "setup omb") || isInformational(clean, "omb setup"))) continue;
    if (kw.action === "doctor" && (isInformational(clean, "doctor omb") || isInformational(clean, "omb doctor"))) continue;

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

    if (kw.action === "setup") {
      hookOutput(
        `[MAGIC KEYWORD: setup-omb]\n\nYou MUST invoke the skill using the Skill tool:\n\nSkill: oh-my-beads:setup\n\nUser request:\n${raw}\n\nIMPORTANT: Invoke the skill IMMEDIATELY. Do not proceed without loading the skill instructions.`
      );
      return;
    }

    if (kw.action === "doctor") {
      hookOutput(
        `[MAGIC KEYWORD: doctor-omb]\n\nYou MUST invoke the skill using the Skill tool:\n\nSkill: oh-my-beads:doctor\n\nUser request:\n${raw}\n\nIMPORTANT: Invoke the skill IMMEDIATELY. Do not proceed without loading the skill instructions.`
      );
      return;
    }

    if (kw.action === "invoke-fast") {
      // Mode conflict: block Mr.Fast if Mr.Beads is active
      const currentSession = readCurrentSession();
      if (currentSession?.active && currentSession.mode === "mr.beads") {
        const phase = currentSession.current_phase || "unknown";
        hookOutput(
          `[MODE CONFLICT] Cannot start Mr.Fast — an active Mr.Beads session is in progress ` +
          `(phase: ${phase}). Cancel the current session first with "cancel omb", ` +
          `or wait for it to complete.`
        );
        return;
      }

      const intent = classifyFastIntent(raw);

      if (intent === "complex") {
        // Complex intent: do NOT activate session, suggest Mr.Beads instead
        ensureStateDirs();
        const state = {
          current_phase: "fast_bootstrap",
          active: false,
          mode: "mr.fast",
          intent: "complex",
          started_at: new Date().toISOString(),
          reinforcement_count: 0,
        };
        writeFileSync(join(getStateDir(), "session.json"), JSON.stringify(state, null, 2));
        hookOutput(
          `[MAGIC KEYWORD: mr-fast]\n\nThe request appears too complex for Mr.Fast (detected: large-scope work). ` +
          `Consider using Mr.Beads instead for full planning and multi-agent execution:\n\n` +
          `  omb ${raw.replace(/\b(?:mr\.?\s*fast|mrfast)\b/gi, "").trim()}\n\n` +
          `If you still want Mr.Fast, rephrase with a narrower scope.`
        );
        return;
      }

      const phase = intent === "turbo" ? "fast_turbo" : "fast_scout";
      writeSessionState(phase, "mr.fast", intent);
      const { augmented } = upgradePrompt(raw, { mode: "mr.fast" });

      // Route directly to the appropriate skill based on intent:
      // - turbo → executor (skip fast-scout entirely)
      // - standard → fast-scout (then executor)
      const skill = intent === "turbo" ? "oh-my-beads:executor" : "oh-my-beads:fast-scout";
      hookOutput(
        `[MAGIC KEYWORD: mr-fast]\n\nYou MUST invoke the skill using the Skill tool:\n\nSkill: ${skill}\n\nIntent: ${intent}\n\nUser request:\n${augmented}\n\nIMPORTANT: Invoke the skill IMMEDIATELY. Do not proceed without loading the skill instructions.`
      );
      return;
    }

    // Activate Mr.Beads (default mode)
    // Mode conflict: block Mr.Beads if Mr.Fast is active
    {
      const currentSession = readCurrentSession();
      if (currentSession?.active && currentSession.mode === "mr.fast") {
        const phase = currentSession.current_phase || "unknown";
        hookOutput(
          `[MODE CONFLICT] Cannot start Mr.Beads — an active Mr.Fast session is in progress ` +
          `(phase: ${phase}). Cancel the current session first with "cancel mrfast", ` +
          `or wait for it to complete.`
        );
        return;
      }
    }
    writeSessionState("bootstrap", "mr.beads");
    const { augmented } = upgradePrompt(raw, { mode: "mr.beads" });
    hookOutput(
      `[MAGIC KEYWORD: oh-my-beads]\n\nYou MUST invoke the skill using the Skill tool:\n\nSkill: oh-my-beads:master\n\nUser request:\n${augmented}\n\nIMPORTANT: Invoke the skill IMMEDIATELY. Do not proceed without loading the skill instructions.`
    );
    return;
  }

  // No keyword matched — pass through
  hookOutput(null);
});
