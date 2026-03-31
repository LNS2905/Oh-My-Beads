/**
 * oh-my-beads state utilities — shared state management for all scripts.
 *
 * Provides session-scoped state with fallback to legacy paths.
 *
 * State layout:
 *   .oh-my-beads/state/session.json                         (legacy, still primary)
 *   .oh-my-beads/state/sessions/{sessionId}/session.json    (session-scoped)
 *   .oh-my-beads/state/sessions/{sessionId}/tool-tracking.json
 *   .oh-my-beads/state/sessions/{sessionId}/subagent-tracking.json
 *
 * Usage:
 *   import { StateManager } from "./state-utils.mjs";
 *   const mgr = new StateManager(directory, sessionId);
 *   const session = mgr.readSession();
 *   mgr.writeSession({ ...session, current_phase: "phase_2_planning" });
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, readdirSync, rmSync } from "fs";
import { join, dirname } from "path";

export class StateManager {
  constructor(directory, sessionId = null) {
    this.directory = directory;
    this.sessionId = sessionId || process.env.CLAUDE_SESSION_ID || process.env.CLAUDECODE_SESSION_ID || null;
    this.baseDir = join(directory, ".oh-my-beads", "state");
    this.legacyDir = this.baseDir;
    this.sessionDir = this.sessionId
      ? join(this.baseDir, "sessions", this.sessionId)
      : null;
  }

  // --- Path resolution ---

  /** Get the path for a state file, preferring session-scoped */
  _path(filename) {
    if (this.sessionDir) {
      return join(this.sessionDir, filename);
    }
    return join(this.legacyDir, filename);
  }

  /** Get legacy path for a state file */
  _legacyPath(filename) {
    return join(this.legacyDir, filename);
  }

  /** Resolve a state file — check session-scoped first, then legacy */
  _resolve(filename) {
    if (this.sessionDir) {
      const sessionPath = join(this.sessionDir, filename);
      if (existsSync(sessionPath)) return sessionPath;
    }
    const legacyPath = join(this.legacyDir, filename);
    if (existsSync(legacyPath)) return legacyPath;
    // Default to session-scoped if available, else legacy
    return this._path(filename);
  }

  // --- Core I/O ---

  readJson(filename) {
    const path = this._resolve(filename);
    try {
      if (!existsSync(path)) return null;
      return JSON.parse(readFileSync(path, "utf8"));
    } catch { return null; }
  }

  writeJson(filename, data) {
    const path = this._path(filename);
    try {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(data, null, 2));
      renameSync(tmp, path);
      return true;
    } catch { return false; }
  }

  deleteFile(filename) {
    // Delete from both session-scoped and legacy
    const paths = [this._path(filename), this._legacyPath(filename)];
    for (const p of paths) {
      try { rmSync(p, { force: true }); } catch { /* ignore */ }
    }
  }

  // --- Session state ---

  readSession() {
    return this.readJson("session.json");
  }

  writeSession(data) {
    data.last_checked_at = new Date().toISOString();
    // Always write to both legacy and session-scoped for compatibility
    this.writeJson("session.json", data);
    if (this.sessionDir) {
      const legacyPath = this._legacyPath("session.json");
      try {
        const dir = dirname(legacyPath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(legacyPath, JSON.stringify(data, null, 2));
      } catch { /* best effort */ }
    }
    return true;
  }

  // --- Tool tracking ---

  readToolTracking() {
    return this.readJson("tool-tracking.json") || {
      files_modified: [],
      failures: [],
      last_tool: null,
      tool_count: 0,
    };
  }

  writeToolTracking(data) {
    return this.writeJson("tool-tracking.json", data);
  }

  // --- Subagent tracking ---

  readSubagentTracking() {
    return this.readJson("subagent-tracking.json") || { agents: [] };
  }

  writeSubagentTracking(data) {
    return this.writeJson("subagent-tracking.json", data);
  }

  // --- State operations ---

  /** List all active sessions (scan sessions/ directory) */
  listActiveSessions() {
    const sessionsDir = join(this.baseDir, "sessions");
    if (!existsSync(sessionsDir)) return [];

    const sessions = [];
    try {
      const entries = readdirSync(sessionsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const sessionFile = join(sessionsDir, entry.name, "session.json");
        try {
          if (!existsSync(sessionFile)) continue;
          const data = JSON.parse(readFileSync(sessionFile, "utf8"));
          sessions.push({
            session_id: entry.name,
            active: data.active || false,
            current_phase: data.current_phase || "unknown",
            started_at: data.started_at || null,
          });
        } catch { /* skip corrupt */ }
      }
    } catch { /* ignore */ }

    // Also check legacy session
    const legacyFile = this._legacyPath("session.json");
    try {
      if (existsSync(legacyFile)) {
        const data = JSON.parse(readFileSync(legacyFile, "utf8"));
        if (data.active && !sessions.some(s => s.active)) {
          sessions.push({
            session_id: "legacy",
            active: data.active,
            current_phase: data.current_phase || data.phase || "unknown",
            started_at: data.started_at || data.startedAt || null,
          });
        }
      }
    } catch { /* ignore */ }

    return sessions;
  }

  /** Clear state for this session */
  clearSession() {
    this.deleteFile("session.json");
    this.deleteFile("tool-tracking.json");
    this.deleteFile("subagent-tracking.json");

    // Clean up empty session directory
    if (this.sessionDir && existsSync(this.sessionDir)) {
      try {
        const remaining = readdirSync(this.sessionDir);
        if (remaining.length === 0) {
          rmSync(this.sessionDir, { recursive: true, force: true });
        }
      } catch { /* ignore */ }
    }
  }

  /** Get full status for this session */
  getStatus() {
    const session = this.readSession();
    const tracking = this.readToolTracking();
    const subagents = this.readSubagentTracking();

    return {
      session_id: this.sessionId || "legacy",
      has_session: !!session,
      active: session?.active || false,
      current_phase: session?.current_phase || null,
      started_at: session?.started_at || null,
      reinforcement_count: session?.reinforcement_count || 0,
      failure_count: session?.failure_count || 0,
      feature_slug: session?.feature_slug || null,
      tools_used: tracking.tool_count || 0,
      files_modified: tracking.files_modified?.length || 0,
      active_subagents: subagents.agents?.filter(a => a.status === "running").length || 0,
      total_subagents: subagents.agents?.length || 0,
    };
  }
}

/** Create a StateManager from hook input data */
export function createStateManager(data) {
  const directory = data.cwd || data.directory || process.cwd();
  const sessionId = data.session_id || data.sessionId || process.env.CLAUDE_SESSION_ID || process.env.CLAUDECODE_SESSION_ID || null;
  return new StateManager(directory, sessionId);
}
