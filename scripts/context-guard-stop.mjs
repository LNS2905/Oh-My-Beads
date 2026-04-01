#!/usr/bin/env node

/**
 * oh-my-beads context guard — Stop hook (runs BEFORE persistent-mode.cjs).
 *
 * Classifies stop type and ensures context-limit stops are allowed through
 * before persistent-mode.cjs can block them. This prevents the autonomy
 * engine from fighting context exhaustion (which wastes the last tokens).
 *
 * Classification:
 * 1. Context limit stop → write checkpoint, ALLOW stop
 * 2. User abort → ALLOW stop
 * 3. Normal stop → pass through (let persistent-mode.cjs decide)
 *
 * Claude Code Stop hook fires when the MODEL decides to stop.
 * Context limits and explicit user aborts are handled by the engine
 * BEFORE the Stop hook fires, so we detect context pressure via
 * the transcript file (if available).
 *
 * Safety:
 * - Checkpoint writes are atomic (tmp + rename)
 * - Graceful: failures always allow stop (fail-open)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { join, dirname } from "path";
import { resolveStateDir } from "./state-tools/resolve-state-dir.mjs";

// --- Constants ---
const CONTEXT_PRESSURE_THRESHOLD = 0.85; // 85% usage = likely context pressure

// --- Helpers ---
function readJson(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch { return null; }
}

function writeJsonAtomic(filePath, data) {
  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, filePath);
  } catch { /* best effort */ }
}

function allowStop() {
  process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }));
}

function passThrough() {
  // Don't output anything — let the next Stop hook (persistent-mode.cjs) handle it
  process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }));
}

/**
 * Detect context pressure by reading the tail of the transcript file.
 * Looks for context_window and input_tokens fields to estimate usage.
 */
function detectContextPressure(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return null;

  try {
    const fd = require("fs").openSync(transcriptPath, "r");
    const stats = require("fs").fstatSync(fd);
    const readSize = Math.min(stats.size, 8192);
    const buffer = Buffer.alloc(readSize);
    require("fs").readSync(fd, buffer, 0, readSize, stats.size - readSize);
    require("fs").closeSync(fd);

    const tail = buffer.toString("utf8");

    // Look for context_window and input_tokens in the tail
    const contextMatch = tail.match(/"context_window"\s*:\s*(\d+)/);
    const inputMatch = tail.match(/"input_tokens"\s*:\s*(\d+)/);

    if (contextMatch && inputMatch) {
      const contextWindow = parseInt(contextMatch[1], 10);
      const inputTokens = parseInt(inputMatch[1], 10);
      if (contextWindow > 0) {
        return inputTokens / contextWindow;
      }
    }
  } catch { /* best effort */ }

  return null;
}

function writeCheckpoint(stateDir, session, reason) {
  if (!session) return;
  try {
    const now = new Date().toISOString();

    if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });

    const checkpoint = {
      checkpointed_at: now,
      reason,
      phase: session.current_phase || "unknown",
      feature: session.feature_slug || "unknown",
      reinforcement_count: session.reinforcement_count || 0,
      failure_count: session.failure_count || 0,
    };
    writeJsonAtomic(join(stateDir, "checkpoint.json"), checkpoint);
  } catch { /* best effort */ }
}

// --- Main ---
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let data;
  try {
    data = JSON.parse(input.trim());
  } catch {
    allowStop();
    return;
  }

  const directory = data.cwd || data.directory || process.cwd();
  const { stateDir } = resolveStateDir(directory, data);
  const stateFile = join(stateDir, "session.json");
  const transcriptPath = data.transcript_path ?? data.transcriptPath ?? null;

  // No session state → pass through
  const session = readJson(stateFile);
  if (!session || !session.active) {
    passThrough();
    return;
  }

  // Check context pressure
  const contextUsage = detectContextPressure(transcriptPath);

  if (contextUsage !== null && contextUsage >= CONTEXT_PRESSURE_THRESHOLD) {
    // Context pressure detected — write checkpoint and allow stop
    writeCheckpoint(stateDir, session, "context_pressure");

    // Update session state to indicate context-limit stop
    session.last_checked_at = new Date().toISOString();
    session.context_limit_stop = true;
    writeJsonAtomic(stateFile, session);

    allowStop();
    return;
  }

  // Not a context-limit stop — pass through to persistent-mode.cjs
  passThrough();
});
