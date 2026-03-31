#!/usr/bin/env node

/**
 * oh-my-beads subagent tracker — handles both SubagentStart and SubagentStop hooks.
 *
 * Tracks spawned sub-agents in .oh-my-beads/state/subagent-tracking.json.
 * Records role, pid, started/stopped times, expected deliverables.
 *
 * On SubagentStop: triggers verify-deliverables check and posts result
 * as additionalContext so the Master can act on it.
 *
 * Usage:
 *   SubagentStart: node run.cjs subagent-tracker.mjs
 *   SubagentStop:  node run.cjs subagent-tracker.mjs
 *
 * The hook type is detected from the input payload.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, readdirSync } from "fs";
import { join, dirname } from "path";

// --- Constants ---
const ROLE_DELIVERABLES = {
  scout: {
    files: ["history/*/CONTEXT.md"],
    description: "CONTEXT.md with locked decisions",
  },
  architect: {
    files: ["plans/plan.md"],
    description: "Implementation plan or bead decomposition",
  },
  worker: {
    messages: true,
    description: "Bead completion message to Master via msg()",
  },
  reviewer: {
    messages: true,
    description: "Review verdict (PASS/MINOR/FAIL) message to Master",
  },
};

// --- Helpers ---
function readJson(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch { return null; }
}

function writeJsonAtomic(path, data) {
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, path);
  } catch { /* best effort */ }
}

function hookOutput(eventName, additionalContext) {
  const output = {
    continue: true,
    hookSpecificOutput: {
      hookEventName: eventName,
      ...(additionalContext ? { additionalContext } : {}),
    },
  };
  process.stdout.write(JSON.stringify(output));
}

function detectRole(data) {
  // Check explicit role in spawn config
  const role = data.agent_role ?? data.agentRole ?? data.role ?? null;
  if (role) return role.toLowerCase();

  // Heuristic: scan the agent description/prompt for role hints
  const text = [
    data.description ?? "",
    data.agent_description ?? "",
    data.prompt ?? "",
  ].join(" ").toLowerCase();

  for (const r of ["scout", "architect", "worker", "reviewer", "master"]) {
    if (text.includes(r)) return r;
  }
  return "unknown";
}

function detectEvent(data) {
  // Check for explicit hook event name
  const event = data.hook_event ?? data.hookEvent ?? data.event ?? "";
  if (event.toLowerCase().includes("stop")) return "stop";
  if (event.toLowerCase().includes("start")) return "start";

  // Heuristic: if agent has stopped_at or exit_code, it's a stop event
  if (data.stopped_at || data.stoppedAt || data.exit_code !== undefined || data.exitCode !== undefined) {
    return "stop";
  }
  return "start";
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
  const stateDir = join(directory, ".oh-my-beads", "state");
  const trackingFile = join(stateDir, "subagent-tracking.json");

  const event = detectEvent(data);
  const role = detectRole(data);
  const agentId = data.agent_id ?? data.agentId ?? data.id ?? `${role}-${Date.now()}`;

  // Load or create tracking state
  let tracking = readJson(trackingFile) || { agents: [] };

  if (event === "start") {
    // --- SubagentStart ---
    const entry = {
      id: agentId,
      role,
      started_at: new Date().toISOString(),
      status: "running",
      expected_deliverables: ROLE_DELIVERABLES[role]?.description ?? "unknown",
    };

    // Avoid duplicates
    tracking.agents = tracking.agents.filter(a => a.id !== agentId);
    tracking.agents.push(entry);
    writeJsonAtomic(trackingFile, tracking);

    hookOutput("SubagentStart",
      `[oh-my-beads] Subagent started: ${role} (${agentId}). ` +
      `Expected: ${entry.expected_deliverables}`
    );

  } else {
    // --- SubagentStop ---
    const agent = tracking.agents.find(a => a.id === agentId);

    if (agent) {
      agent.status = "stopped";
      agent.stopped_at = new Date().toISOString();
      agent.exit_code = data.exit_code ?? data.exitCode ?? 0;
      writeJsonAtomic(trackingFile, tracking);
    }

    // Verify deliverables based on role
    const expected = ROLE_DELIVERABLES[role];
    const warnings = [];

    if (expected?.files) {
      for (const glob of expected.files) {
        // Simple check: look for the pattern in .oh-my-beads
        const baseDir = join(directory, ".oh-my-beads");
        const parts = glob.split("/");
        let checkPath = baseDir;
        let found = false;

        for (const part of parts) {
          if (part === "*") {
            // Wildcard — check if any subdirectory has the next part
            if (existsSync(checkPath)) {
              try {
                const entries = readdirSync(checkPath, { withFileTypes: true });
                for (const entry of entries) {
                  if (entry.isDirectory()) {
                    const candidatePath = join(checkPath, entry.name, parts.slice(parts.indexOf("*") + 1).join("/"));
                    if (existsSync(candidatePath)) {
                      found = true;
                      break;
                    }
                  }
                }
              } catch { /* ignore */ }
            }
            break;
          } else {
            checkPath = join(checkPath, part);
          }
        }

        if (!parts.includes("*")) {
          found = existsSync(checkPath);
        }

        if (!found) {
          warnings.push(`Missing expected deliverable: ${glob}`);
        }
      }
    }

    const exitCode = data.exit_code ?? data.exitCode ?? 0;
    if (exitCode !== 0) {
      warnings.push(`Agent exited with code ${exitCode}`);
    }

    if (warnings.length > 0) {
      hookOutput("SubagentStop",
        `[oh-my-beads] Subagent stopped: ${role} (${agentId})\n` +
        `WARNINGS:\n${warnings.map(w => `  - ${w}`).join("\n")}\n` +
        `Verify deliverables before proceeding.`
      );
    } else {
      hookOutput("SubagentStop",
        `[oh-my-beads] Subagent completed: ${role} (${agentId}). Deliverables verified.`
      );
    }
  }
});
