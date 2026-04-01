/**
 * Shared utility: resolve session-scoped state directory.
 *
 * When a sessionId is available (from hook input or env), returns:
 *   <base>/.oh-my-beads/state/sessions/<sessionId>/
 *
 * Otherwise falls back to legacy path:
 *   <base>/.oh-my-beads/state/
 *
 * All hooks should use this to ensure consistent state isolation.
 */

import { join } from "path";
import { mkdirSync } from "fs";

/**
 * @param {string} baseDir - Project root (cwd)
 * @param {object} [data] - Hook input data (may contain session_id)
 * @returns {{ stateDir: string, sessionId: string|null }}
 */
export function resolveStateDir(baseDir, data) {
  const sessionId = data?.session_id
    ?? data?.sessionId
    ?? process.env.CLAUDE_SESSION_ID
    ?? null;

  let stateDir;
  if (sessionId) {
    stateDir = join(baseDir, ".oh-my-beads", "state", "sessions", sessionId);
  } else {
    stateDir = join(baseDir, ".oh-my-beads", "state");
  }

  return { stateDir, sessionId };
}

/**
 * Ensure the state directory exists.
 */
export function ensureStateDir(stateDir) {
  mkdirSync(stateDir, { recursive: true });
}
