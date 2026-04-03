#!/usr/bin/env node

/**
 * oh-my-beads subagent tracker — SubagentStart hook handler.
 *
 * Tracks spawned sub-agents in subagent-tracking.json (system-level state).
 * Records role, pid, started time, expected deliverables.
 *
 * SubagentStop is handled by subagent-stop.mjs (see hooks.json).
 *
 * Usage:
 *   SubagentStart: node run.cjs subagent-tracker.mjs
 */

import { join } from "path";
import { resolveStateDir } from "./state-tools/resolve-state-dir.mjs";
import { readJson, writeJsonAtomic, hookOutput } from "./helpers.mjs";

// --- Expected deliverable descriptions per role ---
const ROLE_DESCRIPTIONS = {
  scout: "CONTEXT.md with locked decisions",
  "fast-scout": "Analysis summary with root cause and affected files",
  architect: "Implementation plan or bead decomposition",
  worker: "Bead completion message to Master via msg()",
  reviewer: "Review verdict (PASS/MINOR/FAIL) message to Master",
};

// --- Helpers ---
function detectRole(data) {
  // Check explicit role in spawn config
  const role = data.agent_role ?? data.agentRole ?? data.role ?? null;
  if (role) return role.toLowerCase();

  // Claude Code native: agent_type field from SubagentStart hooks
  const agentType = data.agent_type ?? data.agentType ?? null;
  if (agentType) {
    const normalized = agentType.toLowerCase().replace(/_/g, "-");
    // Strip plugin prefix if present (e.g. "oh-my-beads:scout" → "scout")
    const stripped = normalized.includes(":") ? normalized.split(":").pop() : normalized;
    for (const r of ["fast-scout", "scout", "architect", "worker", "reviewer", "master", "executor", "explorer", "verifier"]) {
      if (stripped === r || stripped.includes(r)) return r;
    }
  }

  // Heuristic: scan the agent description/prompt for role hints
  const text = [
    data.description ?? "",
    data.agent_description ?? "",
    data.prompt ?? "",
  ].join(" ").toLowerCase();

  for (const r of ["fast-scout", "scout", "architect", "worker", "reviewer", "master"]) {
    if (text.includes(r)) return r;
  }
  return "unknown";
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
    hookOutput("SubagentStart", null);
    return;
  }

  const directory = data.cwd || data.directory || process.cwd();
  const { stateDir } = resolveStateDir(directory, data);
  const trackingFile = join(stateDir, "subagent-tracking.json");

  const role = detectRole(data);
  const agentId = data.agent_id ?? data.agentId ?? data.id ?? `${role}-${Date.now()}`;

  // Load or create tracking state
  let tracking = readJson(trackingFile) || { agents: [] };

  const entry = {
    id: agentId,
    role,
    started_at: new Date().toISOString(),
    status: "running",
    expected_deliverables: ROLE_DESCRIPTIONS[role] ?? "unknown",
  };

  // Avoid duplicates
  tracking.agents = tracking.agents.filter(a => a.id !== agentId);
  tracking.agents.push(entry);
  writeJsonAtomic(trackingFile, tracking);

  hookOutput("SubagentStart",
    `[oh-my-beads] Subagent started: ${role} (${agentId}). ` +
    `Expected: ${entry.expected_deliverables}`
  );
});
