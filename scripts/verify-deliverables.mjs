#!/usr/bin/env node

/**
 * oh-my-beads verify-deliverables — standalone deliverable checker.
 *
 * Called by subagent-tracker on SubagentStop, or manually by Master.
 * Verifies that a subagent produced its expected outputs based on role.
 *
 * Input (stdin JSON):
 *   { agent_id, role, directory, feature_slug? }
 *
 * Output (stdout JSON):
 *   { verified: bool, agent_id, role, checks: [{name, passed, detail}] }
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

// --- Expected deliverables per role ---
const EXPECTATIONS = {
  scout: {
    checks: [
      {
        name: "CONTEXT.md exists",
        check: (dir, feature) => {
          if (feature) {
            return existsSync(join(dir, ".oh-my-beads", "history", feature, "CONTEXT.md"));
          }
          // Scan all feature dirs
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
        // Fast Scout communicates via return value to mr-fast skill.
        // No file output expected — just check that it completed successfully.
        check: (dir, _feature, agentId) => {
          const trackingFile = join(dir, ".oh-my-beads", "state", "subagent-tracking.json");
          const tracking = safeReadJson(trackingFile);
          if (!tracking?.agents) return true; // No tracking = assume OK
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
          return existsSync(join(dir, ".oh-my-beads", "plans", "plan.md"))
            || existsSync(join(dir, ".oh-my-beads", "plan.md"));
        },
      },
    ],
  },

  worker: {
    checks: [
      {
        name: "Tool tracking shows file modifications",
        check: (dir) => {
          const trackingFile = join(dir, ".oh-my-beads", "state", "tool-tracking.json");
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
        // Reviewer communicates via msg() — we check that subagent
        // tracking shows it completed without errors
        check: (dir, _feature, agentId) => {
          const trackingFile = join(dir, ".oh-my-beads", "state", "subagent-tracking.json");
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
function safeReadJson(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch { return null; }
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
    process.stdout.write(JSON.stringify({ verified: false, error: "invalid input" }));
    return;
  }

  const directory = data.directory || data.cwd || process.cwd();
  const role = (data.role || "unknown").toLowerCase();
  const agentId = data.agent_id || data.agentId || "unknown";
  const featureSlug = data.feature_slug || data.featureSlug || null;

  const expectations = EXPECTATIONS[role];
  if (!expectations) {
    process.stdout.write(JSON.stringify({
      verified: true,
      agent_id: agentId,
      role,
      checks: [{ name: "no expectations defined", passed: true, detail: `Role '${role}' has no deliverable checks` }],
    }));
    return;
  }

  const results = expectations.checks.map(c => {
    try {
      const passed = c.check(directory, featureSlug, agentId);
      return { name: c.name, passed, detail: passed ? "OK" : "NOT FOUND" };
    } catch (err) {
      return { name: c.name, passed: false, detail: `Error: ${err.message}` };
    }
  });

  const allPassed = results.every(r => r.passed);

  process.stdout.write(JSON.stringify({
    verified: allPassed,
    agent_id: agentId,
    role,
    checks: results,
  }));
});
