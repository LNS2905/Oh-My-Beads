#!/usr/bin/env node

/**
 * oh-my-beads user configuration module.
 *
 * Reads user-level config from ~/.oh-my-beads/config.json (or $OMB_HOME/config.json).
 * Provides default model assignments for each agent role, overridable by user config.
 *
 * Exports:
 *   loadConfig()        — Read config.json, returns defaults if missing/invalid.
 *   getModelForRole(role) — Returns the configured model for a given agent role.
 *   DEFAULT_MODELS      — Default model mapping for all agent roles.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

/**
 * Default model assignments for all agent roles.
 * Values are model aliases (opus, sonnet, haiku) matching the agent .md frontmatter.
 */
export const DEFAULT_MODELS = {
  "master": "opus",
  "scout": "opus",
  "fast-scout": "sonnet",
  "architect": "opus",
  "worker": "sonnet",
  "reviewer": "sonnet",
  "explorer": "haiku",
  "executor": "sonnet",
  "verifier": "sonnet",
  "code-reviewer": "opus",
  "security-reviewer": "sonnet",
  "test-engineer": "sonnet",
};

/**
 * Get the OMB system root directory.
 * Respects OMB_HOME env override, otherwise ~/.oh-my-beads/
 * @returns {string} Absolute path to system root.
 */
function getSystemRoot() {
  return process.env.OMB_HOME || join(homedir(), ".oh-my-beads");
}

/**
 * Load user configuration from config.json.
 * Returns a config object with `models` key merged over defaults.
 * Returns defaults if file is missing or invalid.
 *
 * @returns {{ models: Record<string, string> }} Configuration object.
 */
export function loadConfig() {
  const configPath = join(getSystemRoot(), "config.json");
  const defaults = { models: { ...DEFAULT_MODELS } };

  try {
    if (!existsSync(configPath)) return defaults;
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);

    // Merge user models over defaults
    if (parsed && typeof parsed.models === "object" && parsed.models !== null) {
      return {
        ...defaults,
        models: { ...defaults.models, ...parsed.models },
      };
    }
    return defaults;
  } catch {
    return defaults;
  }
}

/**
 * Get the configured model for a given agent role.
 * Returns the user-configured value if present, otherwise the default.
 * Values can be model aliases (opus, sonnet, haiku) or full model names.
 *
 * @param {string} role — Agent role name (e.g., "master", "worker", "fast-scout").
 * @returns {string} Model alias or full model name.
 */
export function getModelForRole(role) {
  const config = loadConfig();
  return config.models[role] || DEFAULT_MODELS[role] || "sonnet";
}
