#!/usr/bin/env node

/**
 * oh-my-beads Skill Injector — UserPromptSubmit hook.
 *
 * Auto-discovers learned skill files and injects relevant ones into prompts.
 *
 * Skill discovery:
 *   1. {cwd}/.oh-my-beads/skills/ (project-level, highest priority)
 *   2. ~/.oh-my-beads/skills/ (user-global)
 *
 * Skill file format: YAML frontmatter (name, description, triggers[], source, tags[])
 * + markdown body (# Problem, # Solution).
 *
 * Matching: word-boundary regex match of triggers against user prompt.
 * Scoring: +10 per single-word trigger match, +15 per multi-word trigger match.
 * Cap: MAX_SKILLS=3 per prompt.
 * Dedup: tracks injected skills per session to avoid re-injection.
 * Feedback: tracks negative feedback per skill; suppresses skills with ≥3 negatives.
 *
 * OMB_QUIET support: suppress at level 2.
 * Early-returns if no .oh-my-beads/skills/ directories exist.
 */

import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { hookOutput as _hookOutput, readJson, writeJsonAtomic, getQuietLevel } from "./helpers.mjs";
import { getProjectStateRoot } from "./state-tools/resolve-state-dir.mjs";

// --- Config ---
const MAX_SKILLS = 3;
const SCORE_PER_TRIGGER = 10;
const SCORE_PER_MULTI_WORD_TRIGGER = 15;
const MIN_SCORE_THRESHOLD = 10;
const NEGATIVE_FEEDBACK_THRESHOLD = 3;

// --- Helpers ---

/**
 * Extract user prompt from hook input JSON.
 */
function extractPrompt(input) {
  try {
    const data = JSON.parse(input);
    return data.prompt ?? data.query ?? data.message ?? (typeof data === "string" ? data : "");
  } catch {
    return input;
  }
}

/**
 * Extract cwd from hook input JSON.
 */
function extractCwd(input) {
  try {
    const data = JSON.parse(input);
    return data.cwd ?? data.directory ?? process.cwd();
  } catch {
    return process.cwd();
  }
}

/**
 * Parse simple YAML frontmatter from a markdown file content.
 * Returns { frontmatter: object, body: string }.
 *
 * Handles:
 *   - String fields: name, description, source
 *   - Array fields: triggers[], tags[] (YAML list with `- item` syntax)
 *
 * Zero-dependency — no YAML parser required.
 */
export function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const yamlBlock = match[1];
  const body = match[2];
  const frontmatter = {};

  let currentKey = null;
  let isArray = false;

  for (const line of yamlBlock.split("\n")) {
    // Array item: "  - value"
    const arrayMatch = line.match(/^\s+-\s+(.+)$/);
    if (arrayMatch && currentKey && isArray) {
      if (!Array.isArray(frontmatter[currentKey])) frontmatter[currentKey] = [];
      frontmatter[currentKey].push(arrayMatch[1].trim());
      continue;
    }

    // Key-value: "key: value" or "key:"
    const kvMatch = line.match(/^(\w[\w_-]*):\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const value = kvMatch[2].trim();
      if (value === "" || value === "[]") {
        // Empty value — next lines may be array items
        frontmatter[currentKey] = [];
        isArray = true;
      } else if (value.startsWith("[") && value.endsWith("]")) {
        // Inline array: [a, b, c]
        frontmatter[currentKey] = value
          .slice(1, -1)
          .split(",")
          .map(s => s.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
        isArray = false;
      } else {
        frontmatter[currentKey] = value.replace(/^['"]|['"]$/g, "");
        isArray = false;
      }
    }
  }

  return { frontmatter, body };
}

/**
 * Discover skill files from a directory.
 * Returns array of { name, description, triggers, source, tags, body, filePath, priority }.
 */
export function discoverSkills(dir, priority) {
  if (!existsSync(dir)) return [];

  const skills = [];
  let files;
  try {
    files = readdirSync(dir).filter(f => f.endsWith(".md"));
  } catch {
    return [];
  }

  for (const file of files) {
    try {
      const filePath = join(dir, file);
      const content = readFileSync(filePath, "utf8");
      const { frontmatter, body } = parseFrontmatter(content);

      // Require at minimum: name and triggers
      if (!frontmatter.name || !Array.isArray(frontmatter.triggers) || frontmatter.triggers.length === 0) {
        continue;
      }

      skills.push({
        name: frontmatter.name,
        description: frontmatter.description || "",
        triggers: frontmatter.triggers,
        source: frontmatter.source || "unknown",
        tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
        body: body.trim(),
        filePath,
        priority,
      });
    } catch {
      // Skip unreadable files
      continue;
    }
  }

  return skills;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Match skill triggers against user prompt using word-boundary matching.
 * Returns score: +10 per single-word trigger match, +15 per multi-word trigger match.
 * Uses word-boundary regex instead of plain substring includes().
 */
export function scoreSkill(skill, prompt) {
  const lowerPrompt = prompt.toLowerCase();
  let score = 0;
  for (const trigger of skill.triggers) {
    const lowerTrigger = trigger.toLowerCase();
    const isMultiWord = lowerTrigger.includes(" ");
    try {
      // Word-boundary matching: \b ensures trigger matches whole words
      const pattern = new RegExp(`\\b${escapeRegex(lowerTrigger)}\\b`, "i");
      if (pattern.test(lowerPrompt)) {
        score += isMultiWord ? SCORE_PER_MULTI_WORD_TRIGGER : SCORE_PER_TRIGGER;
      }
    } catch {
      // Fallback to exact includes if regex fails
      if (lowerPrompt.includes(lowerTrigger)) {
        score += isMultiWord ? SCORE_PER_MULTI_WORD_TRIGGER : SCORE_PER_TRIGGER;
      }
    }
  }
  return score;
}

/**
 * Load previously injected skill names for this session.
 * Session-scoped: if the session's started_at differs from the stored one,
 * treat as a fresh session (all skills eligible for re-injection).
 */
function loadInjectedSkills(stateDir) {
  const filePath = join(stateDir, "injected-skills.json");
  const data = readJson(filePath);
  if (!data?.skills || !Array.isArray(data.skills)) return [];

  // Session-scoped dedup: check if the current session matches the stored one
  const sessionFile = join(stateDir, "session.json");
  const session = readJson(sessionFile);
  const currentStartedAt = session?.started_at || null;
  const storedStartedAt = data.session_started_at || null;

  // If session changed (different started_at), reset dedup
  if (currentStartedAt && storedStartedAt && currentStartedAt !== storedStartedAt) {
    return [];
  }

  return data.skills;
}

/**
 * Save injected skill names for this session, with per-skill tracking.
 * Includes session_started_at for session-scoped dedup.
 */
function saveInjectedSkills(stateDir, skillNames, newlyInjected) {
  const filePath = join(stateDir, "injected-skills.json");
  const existing = readJson(filePath) || {};
  const tracking = existing.tracking || {};

  // Update tracking for newly injected skills
  for (const name of newlyInjected) {
    if (!tracking[name]) {
      tracking[name] = { totalInjections: 0, lastInjected: null };
    }
    tracking[name].totalInjections += 1;
    tracking[name].lastInjected = new Date().toISOString();
  }

  // Read current session's started_at for session-scoped dedup
  const sessionFile = join(stateDir, "session.json");
  const session = readJson(sessionFile);
  const sessionStartedAt = session?.started_at || null;

  writeJsonAtomic(filePath, {
    skills: skillNames,
    session_started_at: sessionStartedAt,
    tracking,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Load skill feedback data (negative feedback counts).
 * Returns object: { slug: { negativeCount, lastNegative, reason } }
 */
export function loadSkillFeedback(stateDir) {
  const filePath = join(stateDir, "skill-feedback.json");
  return readJson(filePath) || {};
}

/**
 * Check if a skill is suppressed due to negative feedback.
 * Applies time-based decay: if the last negative feedback was more than 14 days ago,
 * halve the negativeCount (round down). This allows skills to recover if the codebase changes.
 */
function isSkillSuppressed(feedback, skillName) {
  const entry = feedback[skillName];
  if (!entry) return false;
  let count = entry.negativeCount || 0;

  // Time-based decay: halve negativeCount if last negative was >14 days ago
  if (entry.lastNegative && count >= NEGATIVE_FEEDBACK_THRESHOLD) {
    const lastNeg = new Date(entry.lastNegative).getTime();
    const now = Date.now();
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    if (now - lastNeg > fourteenDaysMs) {
      count = Math.floor(count / 2);
      // Persist the decayed count back to the feedback object (in-memory only;
      // will be saved on next feedback write)
      entry.negativeCount = count;
    }
  }

  return count >= NEGATIVE_FEEDBACK_THRESHOLD;
}

/**
 * Format matched skills into injection context.
 * Includes feedback hint so agents can report unhelpful skills.
 */
function formatInjection(matchedSkills) {
  const parts = matchedSkills.map(s => {
    const slug = s.name;
    let section = `### ${s.name}`;
    if (s.description) section += `\n${s.description}`;
    if (s.body) section += `\n\n${s.body}`;
    section += `\n\n_(Report issues: \`<skill-feedback name="${slug}" useful="false">reason</skill-feedback>\`)_`;
    return section;
  });
  return `<omb-learned-skills>\n${parts.join("\n\n---\n\n")}\n</omb-learned-skills>`;
}

// --- Main ---
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const raw = input.trim();
  const prompt = extractPrompt(raw);
  const cwd = extractCwd(raw);

  // Determine skill directories
  const projectSkillsDir = join(cwd, ".oh-my-beads", "skills");
  const systemRoot = process.env.OMB_HOME || join(homedir(), ".oh-my-beads");
  const globalSkillsDir = join(systemRoot, "skills");

  // Early-return if neither directory exists
  if (!existsSync(projectSkillsDir) && !existsSync(globalSkillsDir)) {
    _hookOutput("UserPromptSubmit", null);
    return;
  }

  // Discover skills from both directories
  // Project skills have higher priority (1) than global skills (2)
  const projectSkills = discoverSkills(projectSkillsDir, 1);
  const globalSkills = discoverSkills(globalSkillsDir, 2);

  // Merge: project skills override global ones with the same name
  const skillMap = new Map();
  for (const skill of globalSkills) {
    skillMap.set(skill.name, skill);
  }
  for (const skill of projectSkills) {
    skillMap.set(skill.name, skill); // override global
  }
  const allSkills = Array.from(skillMap.values());

  if (allSkills.length === 0) {
    _hookOutput("UserPromptSubmit", null);
    return;
  }

  // Score skills against prompt
  const scored = allSkills
    .map(skill => ({ ...skill, score: scoreSkill(skill, prompt) }))
    .filter(s => s.score >= MIN_SCORE_THRESHOLD)
    .sort((a, b) => {
      // Sort by score descending, then by priority ascending (project first)
      if (b.score !== a.score) return b.score - a.score;
      return a.priority - b.priority;
    });

  if (scored.length === 0) {
    _hookOutput("UserPromptSubmit", null);
    return;
  }

  // Session dedup: filter out already-injected skills
  const stateDir = getProjectStateRoot(cwd);
  const injected = loadInjectedSkills(stateDir);
  const newSkills = scored.filter(s => !injected.includes(s.name));

  if (newSkills.length === 0) {
    _hookOutput("UserPromptSubmit", null);
    return;
  }

  // Feedback-based suppression: skip skills with too much negative feedback
  const feedback = loadSkillFeedback(stateDir);
  const unsuppressed = newSkills.filter(s => !isSkillSuppressed(feedback, s.name));

  if (unsuppressed.length === 0) {
    _hookOutput("UserPromptSubmit", null);
    return;
  }

  // Cap at MAX_SKILLS
  const toInject = unsuppressed.slice(0, MAX_SKILLS);

  // Track injected skills
  const updatedInjected = [...injected, ...toInject.map(s => s.name)];
  try {
    saveInjectedSkills(stateDir, updatedInjected, toInject.map(s => s.name));
  } catch { /* best effort */ }

  // Format and inject
  const injection = formatInjection(toInject);
  const skillNames = toInject.map(s => s.name).join(", ");

  // OMB_QUIET support: suppress at level 2
  const quiet = getQuietLevel();
  if (quiet >= 2) {
    _hookOutput("UserPromptSubmit", null);
    return;
  }

  _hookOutput(
    "UserPromptSubmit",
    `[oh-my-beads] Injected ${toInject.length} learned skill(s): ${skillNames}\n\n${injection}`
  );
});
