#!/usr/bin/env node

/**
 * oh-my-beads shared helpers — used by all hook scripts.
 *
 * Exports:
 *   readJson(path) — Read and parse JSON file, returns null on error/missing.
 *   writeJsonAtomic(filePath, data) — Atomic JSON write (tmp + rename).
 *   hookOutput(hookEventName, additionalContext?, systemMessage?) — Standard hook output.
 *
 * All hook scripts import from this module instead of defining inline copies.
 * CJS scripts (persistent-mode.cjs, state-bridge.cjs) use helpers.cjs shim.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { dirname } from "path";

/**
 * Read and parse a JSON file.
 * @param {string} path — Absolute path to JSON file.
 * @returns {object|null} Parsed JSON or null if file missing/invalid.
 */
export function readJson(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch { return null; }
}

/**
 * Write JSON to a file atomically using tmp + rename pattern.
 * Creates parent directories if they don't exist.
 * @param {string} filePath — Absolute path to target file.
 * @param {object} data — Data to serialize as JSON.
 */
export function writeJsonAtomic(filePath, data) {
  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, filePath);
  } catch { /* best effort */ }
}

/**
 * Get the OMB_QUIET level from env var.
 * Level 0 (default): normal output.
 * Level 1: suppress informational additionalContext (keep warnings/errors).
 * Level 2: suppress all non-critical output (only blocks/critical errors).
 * @returns {number} 0, 1, or 2.
 */
export function getQuietLevel() {
  return parseInt(process.env.OMB_QUIET || "0", 10) || 0;
}

/**
 * Produce standard hook output JSON and write to stdout.
 * @param {string} hookEventName — Hook event name (e.g., "UserPromptSubmit").
 * @param {string|null} [additionalContext] — Advisory context for Claude.
 * @param {string} [systemMessage] — Optional system message for re-injection (used by pre-compact.mjs).
 */
export function hookOutput(hookEventName, additionalContext, systemMessage) {
  const output = {
    continue: true,
    ...(systemMessage ? { systemMessage } : {}),
    hookSpecificOutput: {
      hookEventName,
      ...(additionalContext ? { additionalContext } : {}),
    },
  };
  process.stdout.write(JSON.stringify(output));
}
