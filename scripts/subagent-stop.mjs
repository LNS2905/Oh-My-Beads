#!/usr/bin/env node

/**
 * oh-my-beads consolidated SubagentStop handler.
 *
 * Merges subagent-tracker (stop handling) and verify-deliverables into
 * a single script for the SubagentStop hook. Responsibilities:
 *
 * 1. Update subagent-tracking.json (mark agent as stopped)
 * 2. Verify deliverables by role (Scout → CONTEXT.md, Architect → plan, etc.)
 * 3. Report warnings/results as additionalContext
 *
 * Input (stdin JSON): SubagentStop hook payload from Claude Code
 * Output (stdout JSON): Standard hook output with verification results
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { resolveStateDir, getArtifactsDir, getProjectStateRoot } from "./state-tools/resolve-state-dir.mjs";
import { readJson, writeJsonAtomic, simpleOutput } from "./helpers.mjs";

// --- Role deliverables (from subagent-tracker) ---
const ROLE_DELIVERABLES = {
  scout: {
    files: ["history/*/CONTEXT.md"],
    description: "CONTEXT.md with locked decisions",
  },
  "fast-scout": {
    messages: true,
    description: "Analysis summary with root cause and affected files",
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

// --- Detailed deliverable checks (from verify-deliverables) ---
function resolveStateFile(dir, filename) {
  const systemPath = join(getProjectStateRoot(dir), filename);
  if (existsSync(systemPath)) return systemPath;
  const legacyPath = join(dir, ".oh-my-beads", "state", filename);
  if (existsSync(legacyPath)) return legacyPath;
  return systemPath;
}

function safeReadJson(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch { return null; }
}

const EXPECTATIONS = {
  scout: {
    checks: [
      {
        name: "CONTEXT.md exists",
        check: (dir, feature) => {
          if (feature) {
            return existsSync(join(dir, ".oh-my-beads", "history", feature, "CONTEXT.md"));
          }
          const historyDir = join(dir, ".oh-my-beads", "history");
          if (!existsSync(historyDir)) return false;
          const entries = readdirSync(historyDir, { withFileTypes: true });
          return entries.some(e =>
            e.isDirectory() && existsSync(join(historyDir, e.name, "CONTEXT.md"))
          );
        },
      },
      {
        name: "CONTEXT.md has locked decisions",
        check: (dir, feature) => {
          const historyDir = join(dir, ".oh-my-beads", "history");
          if (!existsSync(historyDir)) return false;
          const entries = readdirSync(historyDir, { withFileTypes: true });
          for (const e of entries) {
            if (!e.isDirectory()) continue;
            const ctxFile = join(historyDir, e.name, "CONTEXT.md");
            if (!existsSync(ctxFile)) continue;
            const content = readFileSync(ctxFile, "utf8");
            if (/D\d+\s*[:—–-]/m.test(content)) return true;
          }
          return false;
        },
      },
    ],
  },

  "fast-scout": {
    checks: [
      {
        name: "Analysis summary delivered",
        check: (dir, _feature, agentId) => {
          const trackingFile = resolveStateFile(dir, "subagent-tracking.json");
          const tracking = safeReadJson(trackingFile);
          if (!tracking?.agents) return true;
          const agent = tracking.agents.find(a => a.id === agentId);
          return !agent || (agent.status === "stopped" && (agent.exit_code ?? 0) === 0);
        },
      },
    ],
  },

  architect: {
    checks: [
      {
        name: "Plan file exists",
        check: (dir) => {
          const artifacts = getArtifactsDir(dir);
          return existsSync(join(artifacts, "plans", "plan.md"))
            || existsSync(join(artifacts, "plan.md"));
        },
      },
    ],
  },

  worker: {
    checks: [
      {
        name: "Tool tracking shows file modifications",
        check: (dir) => {
          const trackingFile = resolveStateFile(dir, "tool-tracking.json");
          const tracking = safeReadJson(trackingFile);
          return tracking?.files_modified?.length > 0;
        },
      },
    ],
  },

  reviewer: {
    checks: [
      {
        name: "Review verdict delivered",
        check: (dir, _feature, agentId) => {
          const trackingFile = resolveStateFile(dir, "subagent-tracking.json");
          const tracking = safeReadJson(trackingFile);
          if (!tracking?.agents) return false;
          const agent = tracking.agents.find(a => a.id === agentId);
          return agent?.status === "stopped" && (agent.exit_code ?? 0) === 0;
        },
      },
    ],
  },
};

// --- Helpers ---
function detectRole(data) {
  const role = data.agent_role ?? data.agentRole ?? data.role ?? null;
  if (role) return role.toLowerCase();

  const agentType = data.agent_type ?? data.agentType ?? null;
  if (agentType) {
    const normalized = agentType.toLowerCase().replace(/_/g, "-");
    const stripped = normalized.includes(":") ? normalized.split(":").pop() : normalized;
    for (const r of ["fast-scout", "scout", "architect", "worker", "reviewer", "master", "executor", "explorer", "verifier"]) {
      if (stripped === r || stripped.includes(r)) return r;
    }
  }

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

function verifyDeliverables(directory, role, agentId, featureSlug) {
  const expectations = EXPECTATIONS[role];
  if (!expectations) {
    return { verified: true, checks: [{ name: "no expectations defined", passed: true, detail: `Role '${role}' has no deliverable checks` }] };
  }

  const results = expectations.checks.map(c => {
    try {
      const passed = c.check(directory, featureSlug, agentId);
      return { name: c.name, passed, detail: passed ? "OK" : "NOT FOUND" };
    } catch (err) {
      return { name: c.name, passed: false, detail: `Error: ${err.message}` };
    }
  });

  return { verified: results.every(r => r.passed), checks: results };
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
    simpleOutput(null);
    return;
  }

  const directory = data.cwd || data.directory || process.cwd();
  const { stateDir } = resolveStateDir(directory, data);
  const trackingFile = join(stateDir, "subagent-tracking.json");

  const role = detectRole(data);
  const agentId = data.agent_id ?? data.agentId ?? data.id ?? `${role}-${Date.now()}`;
  const featureSlug = data.feature_slug ?? data.featureSlug ?? null;

  // 1. Update subagent tracking state
  let tracking = readJson(trackingFile) || { agents: [] };
  const agent = tracking.agents.find(a => a.id === agentId);

  if (agent) {
    agent.status = "stopped";
    agent.stopped_at = new Date().toISOString();
    agent.exit_code = data.exit_code ?? data.exitCode ?? 0;
    writeJsonAtomic(trackingFile, tracking);
  }

  // 2. Collect warnings from file-based deliverable checks (subagent-tracker style)
  const warnings = [];
  const expected = ROLE_DELIVERABLES[role];

  if (expected?.files) {
    for (const glob of expected.files) {
      const baseDir = getArtifactsDir(directory);
      const parts = glob.split("/");
      let checkPath = baseDir;
      let found = false;

      for (const part of parts) {
        if (part === "*") {
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

  // 3. Run detailed deliverable verification
  const verification = verifyDeliverables(directory, role, agentId, featureSlug);
  const failedChecks = verification.checks.filter(c => !c.passed);
  for (const check of failedChecks) {
    warnings.push(`Deliverable check failed: ${check.name} (${check.detail})`);
  }

  // 4. Report results
  if (warnings.length > 0) {
    simpleOutput(
      `[oh-my-beads] Subagent stopped: ${role} (${agentId})\n` +
      `WARNINGS:\n${warnings.map(w => `  - ${w}`).join("\n")}\n` +
      `Verify deliverables before proceeding.`
    );
  } else {
    simpleOutput(
      `[oh-my-beads] Subagent completed: ${role} (${agentId}). Deliverables verified.`
    );
  }
});
