#!/usr/bin/env node

/**
 * oh-my-beads pre-tool enforcer.
 *
 * Enforces tool access control per agent role as defined in AGENTS.md:
 *
 * | Agent     | NEVER use                                      |
 * |-----------|------------------------------------------------|
 * | Master    | Write, Edit (no implementation code)           |
 * | Scout     | Write, Edit, reserve, claim, done, Agent       |
 * | Architect | Write, Edit, reserve, claim, done              |
 * | Worker    | ls, assign, graph, done, Agent, AskUserQuestion|
 * | Reviewer  | Write, Edit, reserve, release, claim, done, Agent|
 *
 * Detection: Checks CLAUDE_AGENT_NAME or prompt context for role hints.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROLE_RESTRICTIONS = {
  master:   { deny: ["Write", "Edit"], msg: "Master must not write implementation code." },
  scout:    { deny: ["Write", "Edit", "mcp__beads-village__reserve", "mcp__beads-village__claim", "mcp__beads-village__done", "Agent"], msg: "Scout is read-only and does not use beads_village execution tools." },
  architect:{ deny: ["Write", "Edit", "mcp__beads-village__reserve", "mcp__beads-village__claim", "mcp__beads-village__done"], msg: "Architect does not write code or claim beads." },
  worker:   { deny: ["mcp__beads-village__ls", "mcp__beads-village__assign", "mcp__beads-village__graph", "mcp__beads-village__done", "Agent", "AskUserQuestion"], msg: "Worker must not orchestrate or close beads." },
  reviewer: { deny: ["Write", "Edit", "mcp__beads-village__reserve", "mcp__beads-village__release", "mcp__beads-village__claim", "mcp__beads-village__done", "Agent"], msg: "Reviewer is read-only." },
};

function detectRole(input) {
  // Check env var first (set when spawning sub-agents)
  const envRole = process.env.OMB_AGENT_ROLE;
  if (envRole && ROLE_RESTRICTIONS[envRole.toLowerCase()]) return envRole.toLowerCase();

  // Heuristic: look for role identifiers in the tool call context
  const text = typeof input === "string" ? input : JSON.stringify(input);
  for (const role of Object.keys(ROLE_RESTRICTIONS)) {
    if (new RegExp(`\\b${role}\\b`, "i").test(text)) return role;
  }
  return null;
}

function hookOutput(decision, reason) {
  const output = {
    continue: true,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      ...(decision === "block"
        ? { additionalContext: `BLOCKED: ${reason}` }
        : {}),
    },
  };
  process.stdout.write(JSON.stringify(output));
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
    hookOutput("allow");
    return;
  }

  const toolName = data.tool_name ?? data.toolName ?? "";
  const role = detectRole(data);

  if (!role) {
    hookOutput("allow");
    return;
  }

  const restrictions = ROLE_RESTRICTIONS[role];
  if (!restrictions) {
    hookOutput("allow");
    return;
  }

  const blocked = restrictions.deny.find((t) => toolName === t || toolName.startsWith(t));
  if (blocked) {
    hookOutput("block", `${restrictions.msg} Tool '${toolName}' is not allowed for ${role} role.`);
    return;
  }

  hookOutput("allow");
});
