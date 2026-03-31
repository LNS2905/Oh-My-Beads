#!/usr/bin/env node

/**
 * oh-my-beads keyword detector — UserPromptSubmit hook.
 *
 * Detects "oh-my-beads" / "omb" keywords in user prompts and signals the
 * skill-loader to invoke the using-oh-my-beads bootstrap skill.
 * Also handles "cancel omb" / "stop omb" to clear active sessions.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

// --- Config ---
const KEYWORDS = [
  // Cancel patterns (check first — order matters)
  { pattern: /\b(?:cancel\s*mr\.?fast|stop\s*mr\.?fast)\b/i, action: "cancel" },
  { pattern: /\b(?:cancel\s*mr\.?beads|stop\s*mr\.?beads)\b/i, action: "cancel" },
  { pattern: /\b(?:cancel\s*omb|stop\s*omb|cancel\s*oh-my-beads)\b/i, action: "cancel" },
  // Invoke patterns (mr.fast before omb to avoid omb catching everything)
  { pattern: /\b(?:mr\.?\s*fast|mrfast)\b/i, action: "invoke-fast" },
  { pattern: /\b(?:mr\.?\s*beads|mrbeads)\b/i, action: "invoke" },
  { pattern: /\b(?:oh-my-beads|omb)\b/i, action: "invoke" },
];

const STATE_DIR = join(process.cwd(), ".oh-my-beads", "state");

// --- Helpers ---
function extractPrompt(input) {
  try {
    const data = JSON.parse(input);
    // Claude Code hook format: { query, ... } or { prompt, ... }
    return data.query ?? data.prompt ?? data.message ?? (typeof data === "string" ? data : "");
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
  const around = new RegExp(`(?:what|how|why|explain|describe|tell me about)\\s+(?:is|does|are)?\\s*${escaped}`, "i");
  return around.test(text);
}

function hookOutput(additionalContext) {
  const output = {
    continue: true,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      ...(additionalContext ? { additionalContext } : {}),
    },
  };
  process.stdout.write(JSON.stringify(output));
}

function ensureStateDir() {
  mkdirSync(STATE_DIR, { recursive: true });
}

function writeSessionState(phase, mode = "mr.beads") {
  ensureStateDir();
  const state = {
    current_phase: phase,
    active: true,
    mode,
    started_at: new Date().toISOString(),
    reinforcement_count: 0,
  };
  writeFileSync(join(STATE_DIR, "session.json"), JSON.stringify(state, null, 2));
}

function clearSessionState() {
  const sessionFile = join(STATE_DIR, "session.json");
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
  const raw = extractPrompt(input.trim());
  const clean = sanitize(raw);

  for (const kw of KEYWORDS) {
    if (!kw.pattern.test(clean)) continue;

    // Skip informational context ("what is omb?", "what is mr.fast?")
    if (kw.action === "invoke" && (isInformational(clean, "omb") || isInformational(clean, "oh-my-beads") || isInformational(clean, "mr.beads") || isInformational(clean, "mrbeads"))) continue;
    if (kw.action === "invoke-fast" && (isInformational(clean, "mr.fast") || isInformational(clean, "mrfast"))) continue;

    if (kw.action === "cancel") {
      clearSessionState();
      hookOutput("[MAGIC KEYWORD: cancel-omb]\n\nYou MUST cancel the active oh-my-beads session. Clear state and report.");
      return;
    }

    if (kw.action === "invoke-fast") {
      writeSessionState("fast_bootstrap", "mr.fast");
      hookOutput(
        `[MAGIC KEYWORD: mr-fast]\n\nYou MUST invoke the skill using the Skill tool:\n\nSkill: oh-my-beads:mr-fast\n\nUser request:\n${raw}\n\nIMPORTANT: Invoke the skill IMMEDIATELY. Do not proceed without loading the skill instructions.`
      );
      return;
    }

    // Activate Mr.Beads (default mode)
    writeSessionState("bootstrap", "mr.beads");
    hookOutput(
      `[MAGIC KEYWORD: oh-my-beads]\n\nYou MUST invoke the skill using the Skill tool:\n\nSkill: oh-my-beads:using-oh-my-beads\n\nUser request:\n${raw}\n\nIMPORTANT: Invoke the skill IMMEDIATELY. Do not proceed without loading the skill instructions.`
    );
    return;
  }

  // No keyword matched — pass through
  hookOutput(null);
});
