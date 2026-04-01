#!/usr/bin/env node

/**
 * oh-my-beads pre-tool enforcer.
 *
 * Enforces tool access control per agent role as defined in AGENTS.md.
 * Also includes a Bash permission handler for dangerous commands.
 *
 * Role matrix:
 * | Agent            | NEVER use                                            |
 * |------------------|------------------------------------------------------|
 * | Master           | Edit (Write restricted to .oh-my-beads/ paths)       |
 * | Scout            | Edit, reserve, claim, done, Agent (Write→CONTEXT.md) |
 * | Fast Scout       | Edit, reserve, claim, done, Agent (Write only BRIEF.md) |
 * | Architect        | Edit, reserve, claim, done (Write→plans/ only)       |
 * | Worker           | ls, assign, graph, done, Agent, AskUserQuestion      |
 * | Reviewer         | Write, Edit, reserve, release, claim, done, Agent    |
 * | Explorer         | Write, Edit, Agent                                   |
 * | Executor         | Agent, AskUserQuestion                               |
 * | Verifier         | Write, Edit, Agent                                   |
 * | Code-Reviewer    | Write, Edit, Agent                                   |
 * | Security-Reviewer| Write, Edit, Agent                                   |
 * | Test-Engineer    | Agent (can Write/Edit test files only)                |
 *
 * Bash safeguards (all roles):
 * - Block: rm -rf /, drop database, format commands
 * - Warn: git push --force, git reset --hard
 */

import { existsSync } from "fs";
import { join } from "path";

// --- Role Restrictions ---
const BV = (name) => `mcp__beads-village__${name}`;

const ROLE_RESTRICTIONS = {
  master: {
    deny: [],
    msg: "Master prefers delegating to sub-agents but can edit directly when needed.",
  },
  scout: {
    deny: ["Edit", BV("reserve"), BV("claim"), BV("done"), "Agent"],
    msg: "Scout is read-only except for CONTEXT.md output.",
    fileRestriction: /CONTEXT\.md$/,
  },
  architect: {
    deny: ["Edit", BV("reserve"), BV("claim"), BV("done")],
    msg: "Architect does not write code, only plans.",
    fileRestriction: /(?:^|[/\\])\.oh-my-beads[/\\]plans?[/\\]/,
  },
  worker: {
    deny: [BV("ls"), BV("assign"), BV("graph"), BV("done"), "Agent", "AskUserQuestion"],
    msg: "Worker must not orchestrate or close beads.",
  },
  reviewer: {
    deny: ["Write", "Edit", BV("reserve"), BV("release"), BV("claim"), BV("done"), "Agent"],
    msg: "Reviewer is read-only.",
  },
  explorer: {
    deny: ["Write", "Edit", "Agent"],
    msg: "Explorer is read-only.",
  },
  executor: {
    deny: ["Agent", "AskUserQuestion"],
    msg: "Executor must not spawn sub-agents or ask user questions.",
  },
  verifier: {
    deny: ["Write", "Edit", "Agent"],
    msg: "Verifier is read-only.",
  },
  "code-reviewer": {
    deny: ["Write", "Edit", "Agent"],
    msg: "Code Reviewer is read-only.",
  },
  "security-reviewer": {
    deny: ["Write", "Edit", "Agent"],
    msg: "Security Reviewer is read-only.",
  },
  "fast-scout": {
    deny: ["Edit", BV("reserve"), BV("claim"), BV("done"), "Agent"],
    msg: "Fast Scout can only Write BRIEF.md (analysis artifact). No Edit, no beads_village execution.",
    // Fast Scout CAN use Write, but only for BRIEF.md
    fileRestriction: /BRIEF\.md$/,
  },
  "test-engineer": {
    deny: ["Agent"],
    msg: "Test Engineer must not spawn sub-agents.",
    // Note: test-engineer CAN use Write/Edit, but only on test files.
    // The fileRestriction is checked separately below.
    fileRestriction: /\.(test|spec)\.[^/]+$|(?:^|[/\\])(?:tests?|__tests__)[/\\]/,
  },
};

// --- Dangerous Bash Commands ---
const BASH_BLOCKLIST = [
  { pattern: /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\s*$/,   reason: "Refusing rm on root filesystem" },
  { pattern: /rm\s+-rf\s+\/(?!\S)/,                        reason: "Refusing rm -rf /" },
  { pattern: /rm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)*\/\*/,    reason: "Refusing rm on root glob" },
  { pattern: /--no-preserve-root/,                          reason: "Refusing --no-preserve-root" },
  { pattern: /find\s+\/\s+.*-delete/,                       reason: "Refusing find / -delete" },
  { pattern: /mkfs\b/,                                     reason: "Refusing filesystem format" },
  { pattern: /dd\s+.*of=\/dev\//,                          reason: "Refusing dd to device" },
  { pattern: /:(){ :|:& };:/,                              reason: "Refusing fork bomb" },
  { pattern: /DROP\s+DATABASE/i,                            reason: "Refusing DROP DATABASE" },
  { pattern: /DROP\s+TABLE/i,                               reason: "Refusing DROP TABLE" },
  { pattern: />\s*\/dev\/sd[a-z]/,                          reason: "Refusing write to block device" },
];

const BASH_WARNINGS = [
  { pattern: /git\s+push\s+.*--force/,   warning: "Force push detected. Confirm with user first." },
  { pattern: /git\s+reset\s+--hard/,     warning: "Hard reset detected. This discards uncommitted changes." },
  { pattern: /git\s+clean\s+-[a-zA-Z]*f/, warning: "Git clean -f detected. This deletes untracked files." },
  { pattern: /npm\s+publish/,            warning: "npm publish detected. Confirm with user first." },
];

// --- Helpers ---
function detectRole(input) {
  // Check env var first (set when spawning sub-agents)
  const envRole = process.env.OMB_AGENT_ROLE;
  if (envRole) {
    const normalized = envRole.toLowerCase().replace(/_/g, "-");
    if (ROLE_RESTRICTIONS[normalized]) return normalized;
  }

  // Priority 2: No env var → no role restriction.
  // OMB_AGENT_ROLE env var is the ONLY reliable role indicator.
  // Heuristics (searching prompt text, subagent_type, description) cause
  // false matches: subagent_type describes the TARGET not the CALLER,
  // and prompt text naturally mentions other role names.
  // Spawned agents get their own OMB_AGENT_ROLE via agent frontmatter.
  return null;
}

function extractBashCommand(data) {
  return data.tool_input?.command
    ?? data.toolInput?.command
    ?? null;
}

function extractFilePath(data) {
  return data.tool_input?.file_path
    ?? data.toolInput?.file_path
    ?? data.tool_input?.filePath
    ?? data.toolInput?.filePath
    ?? null;
}

function emitDecision(decision, reason) {
  if (decision === "block") {
    // Claude Code's PreToolUse engine uses hookSpecificOutput.permissionDecision
    // to enforce tool blocking. 'deny' prevents the tool from executing.
    // Top-level decision:'block' is a fallback for older versions.
    // additionalContext kept so the model sees why it was blocked.
    const output = {
      continue: true,
      decision: "block",
      reason: `[oh-my-beads] ${reason}`,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `[oh-my-beads] ${reason}`,
        additionalContext: `BLOCKED: ${reason}`,
      },
    };
    process.stdout.write(JSON.stringify(output));
  } else if (decision === "warn") {
    const output = {
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: `WARNING: ${reason}`,
      },
    };
    process.stdout.write(JSON.stringify(output));
  } else {
    const output = {
      continue: true,
      hookSpecificOutput: { hookEventName: "PreToolUse" },
    };
    process.stdout.write(JSON.stringify(output));
  }
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
    emitDecision("allow");
    return;
  }

  const toolName = data.tool_name ?? data.toolName ?? "";
  const role = detectRole(data);

  // --- Bash safety checks (all roles) ---
  if (toolName === "Bash") {
    const command = extractBashCommand(data);
    if (command) {
      for (const { pattern, reason } of BASH_BLOCKLIST) {
        if (pattern.test(command)) {
          emitDecision("block", `${reason}. Command: ${command.substring(0, 100)}`);
          return;
        }
      }
      for (const { pattern, warning } of BASH_WARNINGS) {
        if (pattern.test(command)) {
          emitDecision("warn", warning);
          return;
        }
      }
    }
  }

  // No role detected → allow
  if (!role) {
    emitDecision("allow");
    return;
  }

  const restrictions = ROLE_RESTRICTIONS[role];
  if (!restrictions) {
    emitDecision("allow");
    return;
  }

  // Check tool deny list
  const blocked = restrictions.deny.find((t) => toolName === t);
  if (blocked) {
    emitDecision("block", `${restrictions.msg} Tool '${toolName}' is not allowed for ${role} role.`);
    return;
  }

  // Check file restriction (test-engineer, master, scout, architect)
  if (restrictions.fileRestriction && (toolName === "Write" || toolName === "Edit")) {
    const filePath = extractFilePath(data);
    if (filePath && !restrictions.fileRestriction.test(filePath)) {
      emitDecision("block",
        `${role} can only modify allowed files matching its fileRestriction. ` +
        `Attempted: ${filePath}`
      );
      return;
    }
  }

  emitDecision("allow");
});
