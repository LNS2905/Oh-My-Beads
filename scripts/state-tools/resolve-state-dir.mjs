/**
 * oh-my-beads state path resolver — hybrid state model.
 *
 * Runtime state (ephemeral) → system-level: ~/.oh-my-beads/projects/{hash}/
 * Project artifacts (committed) → project-level: {cwd}/.oh-my-beads/
 *
 * Hybrid model: user installs OMB once, works across any project without setup.
 * Plans and history stay in the project repo (committable).
 * Session state, handoffs, tracking live at system-level (never committed).
 *
 * Migration: if legacy state exists at {cwd}/.oh-my-beads/state/ but not at
 * system-level, it is read from legacy path. New writes go to system-level.
 */

import { join } from "path";
import { mkdirSync, existsSync, readFileSync } from "fs";
import { createHash } from "crypto";
import { homedir } from "os";

// --- Path helpers ---

/**
 * Get system-level root for OMB runtime data.
 * Respects OMB_HOME env override, otherwise ~/.oh-my-beads/
 */
export function getSystemRoot() {
  return process.env.OMB_HOME || join(homedir(), ".oh-my-beads");
}

/**
 * Generate a short hash (8 hex chars) from a project path.
 * Deterministic: same cwd always gives same hash.
 */
export function projectHash(cwd) {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 8);
}

/**
 * Get system-level state directory for a project.
 * ~/.oh-my-beads/projects/{hash}/
 */
export function getProjectStateRoot(cwd) {
  return join(getSystemRoot(), "projects", projectHash(cwd));
}

/**
 * Get project-level artifacts directory (plans, history — committable).
 * {cwd}/.oh-my-beads/
 */
export function getArtifactsDir(cwd) {
  return join(cwd, ".oh-my-beads");
}

/**
 * Resolve session-scoped runtime state directory.
 *
 * With session ID: ~/.oh-my-beads/projects/{hash}/sessions/{sessionId}/
 * Without:         ~/.oh-my-beads/projects/{hash}/
 *
 * Falls back to legacy {cwd}/.oh-my-beads/state/ for reading if system-level
 * doesn't exist yet (migration support).
 *
 * @param {string} baseDir - Project root (cwd)
 * @param {object} [data] - Hook input data (may contain session_id)
 * @returns {{ stateDir: string, sessionId: string|null, legacyDir: string, projectRoot: string }}
 */
export function resolveStateDir(baseDir, data) {
  const sessionId = data?.session_id
    ?? data?.sessionId
    ?? process.env.CLAUDE_SESSION_ID
    ?? null;

  const projectRoot = getProjectStateRoot(baseDir);
  let stateDir;
  if (sessionId) {
    stateDir = join(projectRoot, "sessions", sessionId);
  } else {
    stateDir = projectRoot;
  }

  // Legacy path for migration fallback reads
  const legacyDir = sessionId
    ? join(baseDir, ".oh-my-beads", "state", "sessions", sessionId)
    : join(baseDir, ".oh-my-beads", "state");

  return { stateDir, sessionId, legacyDir, projectRoot };
}

/**
 * Resolve handoffs directory (system-level, ephemeral).
 */
export function resolveHandoffsDir(baseDir) {
  return join(getProjectStateRoot(baseDir), "handoffs");
}

/**
 * Ensure a directory exists (recursive mkdir).
 */
export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

/**
 * Ensure all runtime directories exist for a project.
 * Called by session-start for auto-initialization.
 */
export function ensureRuntimeDirs(baseDir, sessionId) {
  const projectRoot = getProjectStateRoot(baseDir);
  ensureDir(projectRoot);
  if (sessionId) {
    ensureDir(join(projectRoot, "sessions", sessionId));
  }
  ensureDir(join(projectRoot, "handoffs"));
}

/**
 * Ensure project-level artifact directories exist.
 * Only creates when skills actually need to write (lazy).
 */
export function ensureArtifactDirs(baseDir) {
  const artifacts = getArtifactsDir(baseDir);
  ensureDir(join(artifacts, "plans"));
  ensureDir(join(artifacts, "history"));
}

/**
 * Check if legacy state exists at project-level path.
 * Used for migration detection.
 */
export function hasLegacyState(baseDir) {
  return existsSync(join(baseDir, ".oh-my-beads", "state", "session.json"));
}

/**
 * Read a JSON file, return null on any error.
 */
export function readJsonSafe(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
