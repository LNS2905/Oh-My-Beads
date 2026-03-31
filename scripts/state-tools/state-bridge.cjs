#!/usr/bin/env node

/**
 * oh-my-beads state bridge — CLI interface for state operations.
 *
 * Provides uniform state_read/state_write/state_list_active/state_clear/state_get_status
 * operations callable from skills and hooks.
 *
 * Usage:
 *   node state-bridge.cjs read [--session-id ID]
 *   node state-bridge.cjs write --phase PHASE [--active true|false] [--session-id ID] [--data JSON]
 *   node state-bridge.cjs list
 *   node state-bridge.cjs clear [--session-id ID]
 *   node state-bridge.cjs status [--session-id ID]
 *
 * All output is JSON to stdout.
 */

"use strict";

const { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, readdirSync, rmSync } = require("fs");
const { join, dirname } = require("path");

// --- Helpers ---
function readJson(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch { return null; }
}

function writeJsonAtomic(path, data) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, path);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const val = (i + 1 < argv.length && !argv[i + 1].startsWith("--")) ? argv[++i] : "true";
      args[key] = val;
    } else {
      args._.push(argv[i]);
    }
  }
  return args;
}

function getBaseDir() {
  return join(process.cwd(), ".oh-my-beads", "state");
}

function getSessionPath(baseDir, sessionId) {
  if (sessionId && sessionId !== "legacy") {
    return join(baseDir, "sessions", sessionId);
  }
  return baseDir;
}

function resolvePath(baseDir, sessionId, filename) {
  if (sessionId && sessionId !== "legacy") {
    const sessionPath = join(baseDir, "sessions", sessionId, filename);
    if (existsSync(sessionPath)) return sessionPath;
  }
  const legacyPath = join(baseDir, filename);
  if (existsSync(legacyPath)) return legacyPath;
  // Default
  return sessionId && sessionId !== "legacy"
    ? join(baseDir, "sessions", sessionId, filename)
    : join(baseDir, filename);
}

// --- Commands ---

function cmdRead(args) {
  const baseDir = getBaseDir();
  const sessionId = args["session-id"] || process.env.CLAUDE_SESSION_ID || null;
  const path = resolvePath(baseDir, sessionId, "session.json");
  const data = readJson(path);
  process.stdout.write(JSON.stringify({
    success: true,
    session_id: sessionId || "legacy",
    path,
    data: data || null,
  }));
}

function cmdWrite(args) {
  const baseDir = getBaseDir();
  const sessionId = args["session-id"] || process.env.CLAUDE_SESSION_ID || null;
  const sessionDir = getSessionPath(baseDir, sessionId);
  const path = join(sessionDir, "session.json");

  // Read existing or start fresh
  let existing = readJson(path) || {};

  // Merge provided fields
  if (args.phase) existing.current_phase = args.phase;
  if (args.active !== undefined) existing.active = args.active === "true";
  if (args.feature) existing.feature_slug = args.feature;
  if (args.data) {
    try {
      const extra = JSON.parse(args.data);
      Object.assign(existing, extra);
    } catch { /* ignore bad JSON */ }
  }

  existing.last_checked_at = new Date().toISOString();
  if (!existing.started_at) existing.started_at = new Date().toISOString();

  writeJsonAtomic(path, existing);

  // Also write to legacy path for compatibility
  if (sessionId && sessionId !== "legacy") {
    const legacyPath = join(baseDir, "session.json");
    try { writeJsonAtomic(legacyPath, existing); } catch { /* best effort */ }
  }

  process.stdout.write(JSON.stringify({
    success: true,
    session_id: sessionId || "legacy",
    path,
    data: existing,
  }));
}

function cmdList() {
  const baseDir = getBaseDir();
  const sessions = [];

  // Scan sessions/ directory
  const sessionsDir = join(baseDir, "sessions");
  if (existsSync(sessionsDir)) {
    try {
      const entries = readdirSync(sessionsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const sessionFile = join(sessionsDir, entry.name, "session.json");
        const data = readJson(sessionFile);
        if (data) {
          sessions.push({
            session_id: entry.name,
            active: data.active || false,
            current_phase: data.current_phase || "unknown",
            started_at: data.started_at || null,
          });
        }
      }
    } catch { /* ignore */ }
  }

  // Check legacy
  const legacyFile = join(baseDir, "session.json");
  const legacyData = readJson(legacyFile);
  if (legacyData) {
    sessions.push({
      session_id: "legacy",
      active: legacyData.active || false,
      current_phase: legacyData.current_phase || legacyData.phase || "unknown",
      started_at: legacyData.started_at || legacyData.startedAt || null,
    });
  }

  process.stdout.write(JSON.stringify({
    success: true,
    sessions,
    active_count: sessions.filter(s => s.active).length,
  }));
}

function cmdClear(args) {
  const baseDir = getBaseDir();
  const sessionId = args["session-id"] || process.env.CLAUDE_SESSION_ID || null;
  const files = ["session.json", "tool-tracking.json", "subagent-tracking.json", "checkpoint.json"];
  const cleared = [];

  if (sessionId && sessionId !== "legacy") {
    const sessionDir = join(baseDir, "sessions", sessionId);
    for (const f of files) {
      const p = join(sessionDir, f);
      if (existsSync(p)) { rmSync(p, { force: true }); cleared.push(p); }
    }
    // Clean empty dir
    try {
      if (existsSync(sessionDir) && readdirSync(sessionDir).length === 0) {
        rmSync(sessionDir, { recursive: true, force: true });
      }
    } catch { /* ignore */ }
  }

  // Also clear legacy
  for (const f of files) {
    const p = join(baseDir, f);
    if (existsSync(p)) { rmSync(p, { force: true }); cleared.push(p); }
  }

  process.stdout.write(JSON.stringify({
    success: true,
    session_id: sessionId || "legacy",
    cleared,
  }));
}

function cmdStatus(args) {
  const baseDir = getBaseDir();
  const sessionId = args["session-id"] || process.env.CLAUDE_SESSION_ID || null;

  const sessionPath = resolvePath(baseDir, sessionId, "session.json");
  const session = readJson(sessionPath);
  const tracking = readJson(resolvePath(baseDir, sessionId, "tool-tracking.json"));
  const subagents = readJson(resolvePath(baseDir, sessionId, "subagent-tracking.json"));

  process.stdout.write(JSON.stringify({
    success: true,
    session_id: sessionId || "legacy",
    has_session: !!session,
    active: session?.active || false,
    current_phase: session?.current_phase || null,
    started_at: session?.started_at || null,
    reinforcement_count: session?.reinforcement_count || 0,
    failure_count: session?.failure_count || 0,
    feature_slug: session?.feature_slug || null,
    tools_used: tracking?.tool_count || 0,
    files_modified: tracking?.files_modified?.length || 0,
    active_subagents: (subagents?.agents || []).filter(a => a.status === "running").length,
    total_subagents: (subagents?.agents || []).length,
  }));
}

// --- Main ---
const args = parseArgs(process.argv.slice(2));
const command = args._[0];

switch (command) {
  case "read":    cmdRead(args); break;
  case "write":   cmdWrite(args); break;
  case "list":    cmdList(args); break;
  case "clear":   cmdClear(args); break;
  case "status":  cmdStatus(args); break;
  default:
    process.stdout.write(JSON.stringify({
      success: false,
      error: `Unknown command: ${command}`,
      usage: "state-bridge.cjs read|write|list|clear|status [--session-id ID] [--phase PHASE] [--active true|false]",
    }));
}
