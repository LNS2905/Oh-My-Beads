#!/usr/bin/env node

/**
 * oh-my-beads state bridge — CLI interface for state operations.
 *
 * Hybrid state model:
 *   Runtime state → ~/.oh-my-beads/projects/{hash}/
 *   Legacy fallback → {cwd}/.oh-my-beads/state/ (read-only migration)
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
const { createHash } = require("crypto");
const { homedir } = require("os");
const { readJson, writeJsonAtomic } = require("../helpers.cjs");

// --- Inline path helpers (CJS cannot import ESM resolve-state-dir.mjs) ---

function getSystemRoot() {
  return process.env.OMB_HOME || join(homedir(), ".oh-my-beads");
}

function pHash(cwd) {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 8);
}

function getProjectStateRoot(cwd) {
  return join(getSystemRoot(), "projects", pHash(cwd));
}

function getLegacyBaseDir(cwd) {
  return join(cwd, ".oh-my-beads", "state");
}

// readJson and writeJsonAtomic imported from helpers.cjs

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

function getProjectRoot() {
  return process.cwd();
}

function getSessionDir(projectRoot, sessionId) {
  if (sessionId && sessionId !== "legacy" && sessionId !== "root") {
    return join(projectRoot, "sessions", sessionId);
  }
  return projectRoot;
}

/**
 * Resolve a file: check system-level first, then legacy fallback.
 */
function resolvePath(cwd, projectRoot, sessionId, filename) {
  // System-level session-scoped
  if (sessionId && sessionId !== "legacy" && sessionId !== "root") {
    const sessionPath = join(projectRoot, "sessions", sessionId, filename);
    if (existsSync(sessionPath)) return sessionPath;
  }
  // System-level root
  const systemPath = join(projectRoot, filename);
  if (existsSync(systemPath)) return systemPath;

  // Legacy fallback
  const legacyBase = getLegacyBaseDir(cwd);
  if (sessionId && sessionId !== "legacy" && sessionId !== "root") {
    const legacySessionPath = join(legacyBase, "sessions", sessionId, filename);
    if (existsSync(legacySessionPath)) return legacySessionPath;
  }
  const legacyPath = join(legacyBase, filename);
  if (existsSync(legacyPath)) return legacyPath;

  // Default: system-level
  if (sessionId && sessionId !== "legacy" && sessionId !== "root") {
    return join(projectRoot, "sessions", sessionId, filename);
  }
  return join(projectRoot, filename);
}

// --- Commands ---

function cmdRead(args) {
  const cwd = getProjectRoot();
  const projectRoot = getProjectStateRoot(cwd);
  const sessionId = args["session-id"] || process.env.CLAUDE_SESSION_ID || null;
  const path = resolvePath(cwd, projectRoot, sessionId, "session.json");
  const data = readJson(path);
  process.stdout.write(JSON.stringify({
    success: true,
    session_id: sessionId || "root",
    path,
    data: data || null,
  }));
}

function cmdWrite(args) {
  const cwd = getProjectRoot();
  const projectRoot = getProjectStateRoot(cwd);
  const sessionId = args["session-id"] || process.env.CLAUDE_SESSION_ID || null;
  const sessionDir = getSessionDir(projectRoot, sessionId);
  const path = join(sessionDir, "session.json");

  // Read existing or start fresh
  let existing = readJson(path);
  if (!existing) {
    // Try legacy
    existing = readJson(resolvePath(cwd, projectRoot, sessionId, "session.json")) || {};
  }

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

  process.stdout.write(JSON.stringify({
    success: true,
    session_id: sessionId || "root",
    path,
    data: existing,
  }));
}

function cmdList() {
  const cwd = getProjectRoot();
  const projectRoot = getProjectStateRoot(cwd);
  const sessions = [];

  // Scan system-level sessions/
  const sessionsDir = join(projectRoot, "sessions");
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

  // Check system-level root
  const rootFile = join(projectRoot, "session.json");
  const rootData = readJson(rootFile);
  if (rootData) {
    sessions.push({
      session_id: "root",
      active: rootData.active || false,
      current_phase: rootData.current_phase || "unknown",
      started_at: rootData.started_at || null,
    });
  }

  // Check legacy
  const legacyFile = join(getLegacyBaseDir(cwd), "session.json");
  const legacyData = readJson(legacyFile);
  if (legacyData && !sessions.some(s => s.active)) {
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
  const cwd = getProjectRoot();
  const projectRoot = getProjectStateRoot(cwd);
  const sessionId = args["session-id"] || process.env.CLAUDE_SESSION_ID || null;
  const files = ["session.json", "tool-tracking.json", "subagent-tracking.json", "checkpoint.json"];
  const cleared = [];

  // Clear system-level
  if (sessionId && sessionId !== "legacy" && sessionId !== "root") {
    const sessionDir = join(projectRoot, "sessions", sessionId);
    for (const f of files) {
      const p = join(sessionDir, f);
      if (existsSync(p)) { rmSync(p, { force: true }); cleared.push(p); }
    }
    try {
      if (existsSync(sessionDir) && readdirSync(sessionDir).length === 0) {
        rmSync(sessionDir, { recursive: true, force: true });
      }
    } catch { /* ignore */ }
  }

  // Clear system-level root
  for (const f of files) {
    const p = join(projectRoot, f);
    if (existsSync(p)) { rmSync(p, { force: true }); cleared.push(p); }
  }

  process.stdout.write(JSON.stringify({
    success: true,
    session_id: sessionId || "root",
    cleared,
  }));
}

function cmdStatus(args) {
  const cwd = getProjectRoot();
  const projectRoot = getProjectStateRoot(cwd);
  const sessionId = args["session-id"] || process.env.CLAUDE_SESSION_ID || null;

  const sessionPath = resolvePath(cwd, projectRoot, sessionId, "session.json");
  const session = readJson(sessionPath);
  const tracking = readJson(resolvePath(cwd, projectRoot, sessionId, "tool-tracking.json"));
  const subagents = readJson(resolvePath(cwd, projectRoot, sessionId, "subagent-tracking.json"));

  process.stdout.write(JSON.stringify({
    success: true,
    session_id: sessionId || "root",
    state_dir: projectRoot,
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
