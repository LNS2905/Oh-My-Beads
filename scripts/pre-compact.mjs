#!/usr/bin/env node

/**
 * oh-my-beads pre-compact hook — fires before context compaction.
 *
 * Persists critical state to disk so the session can resume after compaction:
 * 1. Writes a checkpoint with current phase, progress, and active subagents
 * 2. Creates a handoff document summarizing what was happening
 * 3. Ensures session.json is up-to-date
 *
 * This prevents context loss when Claude compacts the conversation window.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { resolveStateDir, resolveHandoffsDir, getProjectStateRoot } from "./state-tools/resolve-state-dir.mjs";
import { readJson, writeJsonAtomic, hookOutput as _hookOutput } from "./helpers.mjs";
import { loadMemory, formatSummary } from "./project-memory.mjs";

// --- Helpers ---
function writeTextFile(path, content) {
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, content, "utf8");
  } catch { /* best effort */ }
}

const hookOutput = (additionalContext, systemMessage) => {
  _hookOutput("PreCompact", additionalContext, systemMessage);
};

// --- Main ---
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let data;
  try {
    data = JSON.parse(input.trim());
  } catch {
    hookOutput(null);
    return;
  }

  const directory = data.cwd || data.directory || process.cwd();
  const { stateDir } = resolveStateDir(directory, data);
  const handoffsDir = resolveHandoffsDir(directory);

  // Read current session state
  const sessionFile = join(stateDir, "session.json");
  const session = readJson(sessionFile);

  if (!session || !session.active) {
    hookOutput(null);
    return;
  }

  const phase = session.current_phase || "unknown";
  const feature = session.feature_slug || "unknown";
  const now = new Date().toISOString();

  // Read tool tracking for context
  const tracking = readJson(join(stateDir, "tool-tracking.json")) || {};
  const subagents = readJson(join(stateDir, "subagent-tracking.json")) || { agents: [] };

  // 1. Write checkpoint
  const checkpoint = {
    checkpointed_at: now,
    session: { ...session },
    tool_tracking: {
      files_modified: tracking.files_modified || [],
      tool_count: tracking.tool_count || 0,
      failure_count: (tracking.failures || []).length,
    },
    active_subagents: (subagents.agents || [])
      .filter(a => a.status === "running")
      .map(a => ({ id: a.id, role: a.role, started_at: a.started_at })),
    reason: "pre_compaction",
  };
  writeJsonAtomic(join(stateDir, "checkpoint.json"), checkpoint);

  // 2. Write handoff document
  const activeAgents = checkpoint.active_subagents;
  const filesModified = checkpoint.tool_tracking.files_modified;

  const handoff = [
    `## Handoff: Pre-Compaction Checkpoint`,
    ``,
    `**Phase:** ${phase}`,
    `**Feature:** ${feature}`,
    `**Checkpointed at:** ${now}`,
    `**Reinforcements:** ${session.reinforcement_count || 0}`,
    `**Failures:** ${session.failure_count || 0}`,
    ``,
    `### Files Modified`,
    filesModified.length > 0
      ? filesModified.map(f => `- ${f}`).join("\n")
      : "- (none yet)",
    ``,
    `### Active Subagents`,
    activeAgents.length > 0
      ? activeAgents.map(a => `- ${a.role} (${a.id}), started ${a.started_at}`).join("\n")
      : "- (none)",
    ``,
    `### Resume Instructions`,
    `1. Read this handoff to understand where work left off`,
    `2. Check session.json for current phase`,
    `3. Check beads_village ls(status="ready") for next work`,
    `4. If subagents were active, they may need to be re-spawned`,
    ``,
  ].join("\n");

  writeTextFile(join(handoffsDir, `pre-compact-${Date.now()}.md`), handoff);

  // 3. Update session state
  session.last_checked_at = now;
  session.last_compaction = now;
  writeJsonAtomic(sessionFile, session);

  // 4. Build systemMessage for re-injection after compaction
  const mode = session.mode || "mr.beads";
  const modeLabel = mode === "mr.fast" ? "Mr.Fast" : "Mr.Beads";
  const systemMsg = [
    `[oh-my-beads POST-COMPACTION CONTEXT]`,
    `Mode: ${modeLabel} | Phase: ${phase} | Feature: ${feature}`,
    `Reinforcements: ${session.reinforcement_count || 0} | Failures: ${session.failure_count || 0}`,
    filesModified.length > 0 ? `Files modified: ${filesModified.join(", ")}` : "",
    activeAgents.length > 0 ? `Active subagents: ${activeAgents.map(a => a.role).join(", ")}` : "",
    ``,
    `Resume: Read .oh-my-beads/state/session.json and .oh-my-beads/handoffs/ for full context.`,
    mode === "mr.beads" ? `Check beads_village ls(status="ready") for next work.` : `Continue the Mr.Fast workflow.`,
  ].filter(Boolean).join("\n");

  // 4b. Append project memory summary so it survives compaction
  let finalSystemMsg = systemMsg;
  try {
    const projectStateRoot = getProjectStateRoot(directory);
    const memory = loadMemory(projectStateRoot);
    const memorySummary = formatSummary(memory, 650);
    if (memorySummary) {
      finalSystemMsg += `\n\n# Project Memory (Post-Compaction Recovery)\n${memorySummary}`;
    }
  } catch { /* best effort */ }

  // 5. Emit context so Claude knows about the checkpoint
  hookOutput(
    `[oh-my-beads] Pre-compaction checkpoint saved.\n` +
    `Phase: ${phase} | Feature: ${feature}\n` +
    `Files modified: ${filesModified.length} | Active subagents: ${activeAgents.length}\n` +
    `Handoff written to .oh-my-beads/handoffs/\n` +
    `After compaction, read the handoff to resume.`,
    finalSystemMsg
  );
});
