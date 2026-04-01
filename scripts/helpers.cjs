#!/usr/bin/env node

/**
 * oh-my-beads shared helpers — CJS shim.
 *
 * Provides the same readJson, writeJsonAtomic, hookOutput functions
 * for CommonJS scripts (persistent-mode.cjs, state-bridge.cjs).
 *
 * Cannot import from helpers.mjs (ESM), so functions are re-implemented
 * using require() equivalents with identical behavior.
 */

"use strict";

const { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } = require("fs");
const { dirname } = require("path");

/**
 * Read and parse a JSON file.
 * @param {string} path — Absolute path to JSON file.
 * @returns {object|null} Parsed JSON or null if file missing/invalid.
 */
function readJson(path) {
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
function writeJsonAtomic(filePath, data) {
  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, filePath);
  } catch { /* best effort */ }
}

/**
 * Produce standard hook output JSON and write to stdout.
 * @param {string} hookEventName — Hook event name (e.g., "Stop").
 * @param {string|null} [additionalContext] — Advisory context for Claude.
 * @param {string} [systemMessage] — Optional system message for re-injection.
 */
function hookOutput(hookEventName, additionalContext, systemMessage) {
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

/**
 * Get the OMB_QUIET level from env var.
 * Level 0 (default): normal output.
 * Level 1: suppress informational additionalContext (keep warnings/errors).
 * Level 2: suppress all non-critical output (only blocks/critical errors).
 * @returns {number} 0, 1, or 2.
 */
function getQuietLevel() {
  return parseInt(process.env.OMB_QUIET || "0", 10) || 0;
}

module.exports = { readJson, writeJsonAtomic, hookOutput, getQuietLevel };
