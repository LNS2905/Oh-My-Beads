#!/usr/bin/env node

/**
 * oh-my-beads comprehensive test harness.
 *
 * Simulates hook invocations by piping JSON to scripts and asserting outputs.
 * Also tests the state bridge CLI and verify-deliverables.
 *
 * Usage: node test/run-tests.mjs
 */

import { execFileSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(__dirname, "..", "scripts");
const TEMP_DIR = join(__dirname, "..", ".test-workspace");

let passed = 0;
let failed = 0;
let total = 0;

// --- Test infrastructure ---

function setup() {
  rmSync(TEMP_DIR, { recursive: true, force: true });
  mkdirSync(join(TEMP_DIR, ".oh-my-beads", "state"), { recursive: true });
  mkdirSync(join(TEMP_DIR, ".oh-my-beads", "plans"), { recursive: true });
  mkdirSync(join(TEMP_DIR, ".oh-my-beads", "history"), { recursive: true });
  mkdirSync(join(TEMP_DIR, ".oh-my-beads", "handoffs"), { recursive: true });
}

function teardown() {
  rmSync(TEMP_DIR, { recursive: true, force: true });
}

function resetState() {
  const stateDir = join(TEMP_DIR, ".oh-my-beads", "state");
  for (const f of ["session.json", "tool-tracking.json", "subagent-tracking.json", "checkpoint.json"]) {
    rmSync(join(stateDir, f), { force: true });
  }
  // Clean handoffs
  const handoffsDir = join(TEMP_DIR, ".oh-my-beads", "handoffs");
  if (existsSync(handoffsDir)) {
    for (const f of readdirSync(handoffsDir)) {
      if (f !== ".gitkeep") rmSync(join(handoffsDir, f), { force: true });
    }
  }
}

function writeState(data) {
  writeFileSync(
    join(TEMP_DIR, ".oh-my-beads", "state", "session.json"),
    JSON.stringify(data, null, 2)
  );
}

function readState() {
  const p = join(TEMP_DIR, ".oh-my-beads", "state", "session.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

function runScript(scriptName, inputJson, env = {}) {
  const scriptPath = join(SCRIPTS_DIR, scriptName);
  const input = typeof inputJson === "string" ? inputJson : JSON.stringify(inputJson);
  try {
    const result = execFileSync(process.execPath, [scriptPath], {
      input,
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, ...env },
      cwd: TEMP_DIR,
    });
    return { output: result, exitCode: 0 };
  } catch (err) {
    return { output: err.stdout || "", exitCode: err.status || 1, error: err.stderr || "" };
  }
}

function runStateBridge(args) {
  const scriptPath = join(SCRIPTS_DIR, "state-tools", "state-bridge.cjs");
  try {
    const result = execFileSync(process.execPath, [scriptPath, ...args], {
      encoding: "utf8",
      timeout: 10_000,
      cwd: TEMP_DIR,
    });
    return JSON.parse(result);
  } catch (err) {
    try { return JSON.parse(err.stdout || "{}"); } catch { return null; }
  }
}

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertContains(text, substring, label) {
  assert(text.includes(substring), `${label}: expected "${substring}" in "${text.substring(0, 200)}"`);
}

function assertNotContains(text, substring, label) {
  assert(!text.includes(substring), `${label}: should not contain "${substring}"`);
}

function parseOutput(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

// ============================================================
// TEST SUITES
// ============================================================

setup();

// ---- KEYWORD DETECTOR ----

console.log("\n=== keyword-detector.mjs ===\n");

test("detects 'omb' keyword and triggers invocation", () => {
  resetState();
  const { output } = runScript("keyword-detector.mjs", { query: "omb build me a REST API" });
  const parsed = parseOutput(output);
  assert(parsed, "output should be valid JSON");
  assert(parsed.continue === true, "should continue");
  assertContains(parsed.hookSpecificOutput?.additionalContext || "", "MAGIC KEYWORD: oh-my-beads", "omb keyword");
});

test("detects 'oh-my-beads' keyword", () => {
  resetState();
  const { output } = runScript("keyword-detector.mjs", { query: "oh-my-beads create a feature" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "MAGIC KEYWORD: oh-my-beads", "full keyword");
});

test("ignores informational queries about omb", () => {
  const { output } = runScript("keyword-detector.mjs", { query: "what is omb?" });
  const parsed = parseOutput(output);
  assert(parsed?.continue === true, "should continue");
  const ctx = parsed?.hookSpecificOutput?.additionalContext;
  assert(!ctx || !ctx.includes("MAGIC KEYWORD"), "should not trigger on informational query");
});

test("ignores 'how does oh-my-beads work'", () => {
  const { output } = runScript("keyword-detector.mjs", { query: "how does oh-my-beads work" });
  const parsed = parseOutput(output);
  const ctx = parsed?.hookSpecificOutput?.additionalContext;
  assert(!ctx || !ctx.includes("MAGIC KEYWORD"), "should not trigger on how-question");
});

test("handles cancel omb", () => {
  writeState({ active: true, current_phase: "phase_2_planning", started_at: new Date().toISOString() });
  const { output } = runScript("keyword-detector.mjs", { query: "cancel omb" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "cancel-omb", "cancel trigger");
  const state = readState();
  assert(state.active === false, "session should be deactivated");
  assert(state.current_phase === "cancelled", "phase should be cancelled");
});

test("handles stop omb variant", () => {
  writeState({ active: true, current_phase: "phase_1_exploration", started_at: new Date().toISOString() });
  const { output } = runScript("keyword-detector.mjs", { query: "stop omb" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "cancel-omb", "stop variant");
});

test("passes through unrelated prompts", () => {
  const { output } = runScript("keyword-detector.mjs", { query: "fix the login bug" });
  const parsed = parseOutput(output);
  assert(parsed?.continue === true, "should continue");
  const ctx = parsed?.hookSpecificOutput?.additionalContext;
  assert(!ctx, "should have no additionalContext for unrelated prompt");
});

test("writes session state on keyword detection", () => {
  resetState();
  runScript("keyword-detector.mjs", { query: "omb start new feature" });
  const state = readState();
  assert(state, "session.json should exist after keyword detection");
  assert(state.active === true, "should be active");
  assert(state.current_phase === "bootstrap", "phase should be bootstrap");
  assert(state.reinforcement_count === 0, "reinforcement_count should be 0");
});

// ---- PERSISTENT MODE ----

console.log("\n=== persistent-mode.cjs ===\n");

test("allows stop when no session exists", () => {
  resetState();
  const { output } = runScript("persistent-mode.cjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assert(parsed, "output should be valid JSON");
  assert(!parsed.decision || parsed.decision !== "block", "should allow stop without session");
});

test("blocks stop when session is active", () => {
  writeState({
    active: true, current_phase: "phase_2_planning",
    started_at: new Date().toISOString(),
    last_checked_at: new Date().toISOString(),
    reinforcement_count: 0,
  });
  const { output } = runScript("persistent-mode.cjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assert(parsed?.decision === "block", "should block stop during active session");
  assertContains(parsed?.reason?.toLowerCase() || "", "oh-my-beads", "reason");
});

test("blocks with correct phase in message", () => {
  writeState({
    active: true, current_phase: "phase_6_execution",
    started_at: new Date().toISOString(),
    last_checked_at: new Date().toISOString(),
    reinforcement_count: 0,
  });
  const { output } = runScript("persistent-mode.cjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assertContains(parsed?.reason || "", "phase_6_execution", "should include phase");
});

test("allows stop when phase is complete", () => {
  writeState({ active: true, current_phase: "complete", started_at: new Date().toISOString() });
  const { output } = runScript("persistent-mode.cjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assert(!parsed?.decision || parsed.decision !== "block", "should allow stop when complete");
});

test("allows stop for 'completed' phase", () => {
  writeState({ active: true, current_phase: "completed", started_at: new Date().toISOString() });
  const { output } = runScript("persistent-mode.cjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assert(!parsed?.decision || parsed.decision !== "block", "should allow stop for completed");
});

test("allows stop for 'failed' phase", () => {
  writeState({ active: true, current_phase: "failed", started_at: new Date().toISOString() });
  const { output } = runScript("persistent-mode.cjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assert(!parsed?.decision || parsed.decision !== "block", "should allow stop for failed");
});

test("allows stop for 'cancelled' phase", () => {
  writeState({ active: true, current_phase: "cancelled", started_at: new Date().toISOString() });
  const { output } = runScript("persistent-mode.cjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assert(!parsed?.decision || parsed.decision !== "block", "should allow stop for cancelled");
});

test("allows stop for context limit", () => {
  writeState({ active: true, current_phase: "phase_6_execution", started_at: new Date().toISOString() });
  const { output } = runScript("persistent-mode.cjs", { cwd: TEMP_DIR, stop_reason: "context_limit" });
  const parsed = parseOutput(output);
  assert(!parsed?.decision || parsed.decision !== "block", "should allow stop on context limit");
});

test("writes checkpoint on context limit", () => {
  writeState({ active: true, current_phase: "phase_6_execution", started_at: new Date().toISOString(), feature_slug: "test-feat" });
  runScript("persistent-mode.cjs", { cwd: TEMP_DIR, stop_reason: "context_limit" });
  const checkpoint = JSON.parse(readFileSync(join(TEMP_DIR, ".oh-my-beads", "state", "checkpoint.json"), "utf8"));
  assert(checkpoint.reason === "context_limit", "checkpoint reason");
  assert(checkpoint.phase === "phase_6_execution", "checkpoint phase");
  // Check handoff was written
  const handoffs = readdirSync(join(TEMP_DIR, ".oh-my-beads", "handoffs")).filter(f => f.startsWith("checkpoint-"));
  assert(handoffs.length > 0, "handoff file should exist");
});

test("allows stop for user abort", () => {
  writeState({ active: true, current_phase: "phase_6_execution", started_at: new Date().toISOString() });
  const { output } = runScript("persistent-mode.cjs", { cwd: TEMP_DIR, user_requested: true });
  const parsed = parseOutput(output);
  assert(!parsed?.decision || parsed.decision !== "block", "should allow stop on user abort");
});

test("allows stop when cancel_requested is set", () => {
  writeState({ active: true, current_phase: "phase_6_execution", started_at: new Date().toISOString(), cancel_requested: true });
  const { output } = runScript("persistent-mode.cjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assert(!parsed?.decision || parsed.decision !== "block", "should allow stop on cancel_requested");
});

test("increments reinforcement_count on block", () => {
  writeState({
    active: true, current_phase: "phase_4_decomposition",
    started_at: new Date().toISOString(),
    last_checked_at: new Date().toISOString(),
    reinforcement_count: 5,
  });
  runScript("persistent-mode.cjs", { cwd: TEMP_DIR });
  const state = readState();
  assert(state.reinforcement_count === 6, `should be 6, got ${state.reinforcement_count}`);
});

test("circuit breaker at max reinforcements (50)", () => {
  writeState({
    active: true, current_phase: "phase_6_execution",
    started_at: new Date().toISOString(),
    last_checked_at: new Date().toISOString(),
    reinforcement_count: 50,
  });
  const { output } = runScript("persistent-mode.cjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assert(!parsed?.decision || parsed.decision !== "block", "should allow stop at circuit breaker");
  const state = readState();
  assert(state.active === false, "session should be deactivated");
  assert(state.deactivated_reason === "max_reinforcements_reached", "should note reason");
});

test("stale session (>2hrs) allows stop", () => {
  const twoHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  writeState({
    active: true, current_phase: "phase_3_persistence",
    started_at: twoHoursAgo,
    last_checked_at: twoHoursAgo,
    reinforcement_count: 0,
  });
  const { output } = runScript("persistent-mode.cjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assert(!parsed?.decision || parsed.decision !== "block", "should allow stop for stale session");
});

// ---- POST TOOL VERIFIER ----

console.log("\n=== post-tool-verifier.mjs ===\n");

test("passes through when no active session", () => {
  resetState();
  const { output } = runScript("post-tool-verifier.mjs", { cwd: TEMP_DIR, tool_name: "Bash", tool_output: "all good" });
  const parsed = parseOutput(output);
  assert(parsed?.continue === true, "should pass through without session");
});

test("detects TypeScript errors", () => {
  writeState({ active: true, current_phase: "phase_6_execution", started_at: new Date().toISOString() });
  const { output } = runScript("post-tool-verifier.mjs", {
    cwd: TEMP_DIR, tool_name: "Bash",
    tool_output: "error TS2345: Argument of type string is not assignable...",
  });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "Tool failure detected", "TS error");
});

test("detects npm errors", () => {
  writeState({ active: true, current_phase: "phase_6_execution", started_at: new Date().toISOString() });
  const { output } = runScript("post-tool-verifier.mjs", {
    cwd: TEMP_DIR, tool_name: "Bash", tool_output: "npm ERR! code ERESOLVE\nnpm ERR! ERESOLVE unable to resolve dependency tree",
  });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "Tool failure detected", "npm error");
});

test("detects build failures", () => {
  writeState({ active: true, current_phase: "phase_6_execution", started_at: new Date().toISOString() });
  const { output } = runScript("post-tool-verifier.mjs", {
    cwd: TEMP_DIR, tool_name: "Bash", tool_output: "Build failed with 3 errors",
  });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "Tool failure detected", "build fail");
});

test("passes through successful Bash output", () => {
  writeState({ active: true, current_phase: "phase_6_execution", started_at: new Date().toISOString() });
  const { output } = runScript("post-tool-verifier.mjs", {
    cwd: TEMP_DIR, tool_name: "Bash", tool_output: "Tests passed: 42\nAll good!",
  });
  const parsed = parseOutput(output);
  assert(!parsed?.hookSpecificOutput?.additionalContext, "should pass through success");
});

test("tracks file modifications from Write tool", () => {
  writeState({ active: true, current_phase: "phase_6_execution", started_at: new Date().toISOString() });
  rmSync(join(TEMP_DIR, ".oh-my-beads", "state", "tool-tracking.json"), { force: true });
  runScript("post-tool-verifier.mjs", {
    cwd: TEMP_DIR, tool_name: "Write", tool_input: { file_path: "/tmp/test.ts" }, tool_output: "File written",
  });
  const tracking = JSON.parse(readFileSync(join(TEMP_DIR, ".oh-my-beads", "state", "tool-tracking.json"), "utf8"));
  assert(tracking.files_modified.includes("/tmp/test.ts"), "should track written file");
});

test("tracks file modifications from Edit tool", () => {
  writeState({ active: true, current_phase: "phase_6_execution", started_at: new Date().toISOString() });
  rmSync(join(TEMP_DIR, ".oh-my-beads", "state", "tool-tracking.json"), { force: true });
  runScript("post-tool-verifier.mjs", {
    cwd: TEMP_DIR, tool_name: "Edit", tool_input: { file_path: "/tmp/edit.ts" }, tool_output: "Edited",
  });
  const tracking = JSON.parse(readFileSync(join(TEMP_DIR, ".oh-my-beads", "state", "tool-tracking.json"), "utf8"));
  assert(tracking.files_modified.includes("/tmp/edit.ts"), "should track edited file");
});

test("increments failure counter in session state", () => {
  writeState({ active: true, current_phase: "phase_6_execution", started_at: new Date().toISOString(), failure_count: 2 });
  runScript("post-tool-verifier.mjs", {
    cwd: TEMP_DIR, tool_name: "Bash", tool_output: "SyntaxError: Unexpected token",
  });
  const state = readState();
  assert(state.failure_count === 3, `failure_count should be 3, got ${state.failure_count}`);
});

// ---- PRE-TOOL ENFORCER ----

console.log("\n=== pre-tool-enforcer.mjs ===\n");

test("allows tools for unknown roles", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", { tool_name: "Write" });
  const parsed = parseOutput(output);
  assertNotContains(parsed?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "unknown role");
});

test("blocks Write for reviewer", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", { tool_name: "Write" }, { OMB_AGENT_ROLE: "reviewer" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "reviewer Write");
  assert(parsed?.decision === "block", "should use native engine-level decision: block");
});

test("blocks Edit for master", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", { tool_name: "Edit" }, { OMB_AGENT_ROLE: "master" });
  assertContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "master Edit");
});

test("allows Read for reviewer", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", { tool_name: "Read" }, { OMB_AGENT_ROLE: "reviewer" });
  assertNotContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "reviewer Read");
});

test("blocks Agent for worker", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", { tool_name: "Agent" }, { OMB_AGENT_ROLE: "worker" });
  assertContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "worker Agent");
});

test("blocks done for worker", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", { tool_name: "mcp__beads-village__done" }, { OMB_AGENT_ROLE: "worker" });
  assertContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "worker done");
});

test("blocks Write for explorer", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", { tool_name: "Write" }, { OMB_AGENT_ROLE: "explorer" });
  assertContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "explorer Write");
});

test("blocks Edit for verifier", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", { tool_name: "Edit" }, { OMB_AGENT_ROLE: "verifier" });
  assertContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "verifier Edit");
});

test("blocks Write for code-reviewer", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", { tool_name: "Write" }, { OMB_AGENT_ROLE: "code-reviewer" });
  assertContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "code-reviewer Write");
});

test("blocks Write for security-reviewer", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", { tool_name: "Write" }, { OMB_AGENT_ROLE: "security-reviewer" });
  assertContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "security-reviewer Write");
});

test("allows Write for executor", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", { tool_name: "Write" }, { OMB_AGENT_ROLE: "executor" });
  assertNotContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "executor Write");
});

test("blocks Agent for executor", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", { tool_name: "Agent" }, { OMB_AGENT_ROLE: "executor" });
  assertContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "executor Agent");
});

test("blocks dangerous rm -rf /", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", {
    tool_name: "Bash", tool_input: { command: "rm -rf / " },
  });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "rm -rf /");
  assert(parsed?.decision === "block", "rm -rf should use native engine-level blocking");
});

test("blocks DROP DATABASE", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", {
    tool_name: "Bash", tool_input: { command: "psql -c 'DROP DATABASE production'" },
  });
  assertContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "DROP DATABASE");
});

test("warns on git push --force", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", {
    tool_name: "Bash", tool_input: { command: "git push --force origin main" },
  });
  assertContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "WARNING", "force push");
});

// ---- STATE BRIDGE ----

console.log("\n=== state-bridge.cjs ===\n");

test("write creates session state", () => {
  resetState();
  const result = runStateBridge(["write", "--phase", "bootstrap", "--active", "true", "--feature", "test-feat"]);
  assert(result?.success === true, "write should succeed");
  assert(result?.data?.current_phase === "bootstrap", "phase should be bootstrap");
  assert(result?.data?.feature_slug === "test-feat", "feature should be set");
});

test("read returns session state", () => {
  const result = runStateBridge(["read"]);
  assert(result?.success === true, "read should succeed");
  assert(result?.data?.current_phase === "bootstrap", "should read phase");
});

test("status returns comprehensive info", () => {
  const result = runStateBridge(["status"]);
  assert(result?.success === true, "status should succeed");
  assert(result?.active === true, "should be active");
  assert(result?.current_phase === "bootstrap", "should have phase");
  assert(typeof result?.reinforcement_count === "number", "should have reinforcement count");
});

test("list enumerates sessions", () => {
  const result = runStateBridge(["list"]);
  assert(result?.success === true, "list should succeed");
  assert(result?.sessions?.length > 0, "should have at least one session");
  assert(result?.active_count > 0, "should have active sessions");
});

test("clear removes state files", () => {
  const result = runStateBridge(["clear"]);
  assert(result?.success === true, "clear should succeed");
  assert(result?.cleared?.length > 0, "should clear files");
  assert(!existsSync(join(TEMP_DIR, ".oh-my-beads", "state", "session.json")), "session.json should be gone");
});

test("read after clear returns null data", () => {
  const result = runStateBridge(["read"]);
  assert(result?.success === true, "read should succeed");
  assert(result?.data === null, "data should be null after clear");
});

test("write with --data merges JSON", () => {
  resetState();
  const result = runStateBridge(["write", "--phase", "phase_1", "--data", '{"custom_field":"hello","failure_count":5}']);
  assert(result?.success === true, "write should succeed");
  assert(result?.data?.custom_field === "hello", "custom field");
  assert(result?.data?.failure_count === 5, "failure_count");
});

// ---- VERIFY DELIVERABLES ----

console.log("\n=== verify-deliverables.mjs ===\n");

test("scout verification fails without CONTEXT.md", () => {
  resetState();
  const { output } = runScript("verify-deliverables.mjs", JSON.stringify({
    agent_id: "scout-1", role: "scout", directory: TEMP_DIR,
  }));
  const parsed = parseOutput(output);
  assert(parsed?.verified === false, "should fail without CONTEXT.md");
});

test("scout verification passes with CONTEXT.md", () => {
  resetState();
  mkdirSync(join(TEMP_DIR, ".oh-my-beads", "history", "test-feature"), { recursive: true });
  writeFileSync(
    join(TEMP_DIR, ".oh-my-beads", "history", "test-feature", "CONTEXT.md"),
    "# Context\n\nD1 — Use REST API\nD2 — Use PostgreSQL\n"
  );
  const { output } = runScript("verify-deliverables.mjs", JSON.stringify({
    agent_id: "scout-1", role: "scout", directory: TEMP_DIR, feature_slug: "test-feature",
  }));
  const parsed = parseOutput(output);
  assert(parsed?.verified === true, "should pass with CONTEXT.md containing decisions");
});

test("architect verification fails without plan", () => {
  resetState();
  const { output } = runScript("verify-deliverables.mjs", JSON.stringify({
    agent_id: "arch-1", role: "architect", directory: TEMP_DIR,
  }));
  const parsed = parseOutput(output);
  assert(parsed?.verified === false, "should fail without plan.md");
});

test("architect verification passes with plan", () => {
  writeFileSync(join(TEMP_DIR, ".oh-my-beads", "plans", "plan.md"), "# Plan\n\n## Stories\n...");
  const { output } = runScript("verify-deliverables.mjs", JSON.stringify({
    agent_id: "arch-1", role: "architect", directory: TEMP_DIR,
  }));
  const parsed = parseOutput(output);
  assert(parsed?.verified === true, "should pass with plan.md");
});

test("unknown role passes (no expectations)", () => {
  const { output } = runScript("verify-deliverables.mjs", JSON.stringify({
    agent_id: "custom-1", role: "custom-agent", directory: TEMP_DIR,
  }));
  const parsed = parseOutput(output);
  assert(parsed?.verified === true, "unknown role should pass");
});

// ---- SUBAGENT TRACKER ----

console.log("\n=== subagent-tracker.mjs ===\n");

test("records subagent start", () => {
  resetState();
  const { output } = runScript("subagent-tracker.mjs", {
    cwd: TEMP_DIR, hook_event: "SubagentStart",
    agent_id: "scout-001", role: "scout",
  });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "Subagent started", "start message");
  const tracking = JSON.parse(readFileSync(join(TEMP_DIR, ".oh-my-beads", "state", "subagent-tracking.json"), "utf8"));
  assert(tracking.agents.length === 1, "should have 1 agent");
  assert(tracking.agents[0].role === "scout", "role should be scout");
  assert(tracking.agents[0].status === "running", "status should be running");
});

test("records subagent stop", () => {
  const { output } = runScript("subagent-tracker.mjs", {
    cwd: TEMP_DIR, hook_event: "SubagentStop",
    agent_id: "scout-001", role: "scout", exit_code: 0,
  });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "Subagent", "stop message");
  const tracking = JSON.parse(readFileSync(join(TEMP_DIR, ".oh-my-beads", "state", "subagent-tracking.json"), "utf8"));
  const agent = tracking.agents.find(a => a.id === "scout-001");
  assert(agent.status === "stopped", "status should be stopped");
});

// ---- PRE-COMPACT ----

console.log("\n=== pre-compact.mjs ===\n");

test("writes checkpoint on active session", () => {
  resetState();
  writeState({
    active: true, current_phase: "phase_6_execution",
    started_at: new Date().toISOString(), feature_slug: "compact-test",
  });
  const { output } = runScript("pre-compact.mjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "Pre-compaction checkpoint", "checkpoint msg");
  assert(existsSync(join(TEMP_DIR, ".oh-my-beads", "state", "checkpoint.json")), "checkpoint.json exists");
  const checkpoint = JSON.parse(readFileSync(join(TEMP_DIR, ".oh-my-beads", "state", "checkpoint.json"), "utf8"));
  assert(checkpoint.reason === "pre_compaction", "checkpoint reason");
  assert(checkpoint.session.feature_slug === "compact-test", "feature preserved");
});

test("skips checkpoint when no active session", () => {
  resetState();
  const { output } = runScript("pre-compact.mjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assert(!parsed?.hookSpecificOutput?.additionalContext, "no context when inactive");
});

test("writes handoff markdown", () => {
  resetState();
  writeState({ active: true, current_phase: "phase_4_decomposition", started_at: new Date().toISOString() });
  runScript("pre-compact.mjs", { cwd: TEMP_DIR });
  const handoffs = readdirSync(join(TEMP_DIR, ".oh-my-beads", "handoffs")).filter(f => f.startsWith("pre-compact-"));
  assert(handoffs.length > 0, "handoff file should exist");
  const content = readFileSync(join(TEMP_DIR, ".oh-my-beads", "handoffs", handoffs[0]), "utf8");
  assertContains(content, "phase_4_decomposition", "handoff contains phase");
});

// ---- SESSION START: POST-COMPACTION RESUME ----

console.log("\n=== session-start.mjs (Post-Compaction) ===\n");

test("post-compaction resume loads checkpoint context", () => {
  resetState();
  writeState({ active: true, current_phase: "phase_6_execution", started_at: new Date().toISOString(), feature_slug: "resume-test" });
  // Write a checkpoint (simulates pre-compact hook having run)
  writeFileSync(
    join(TEMP_DIR, ".oh-my-beads", "state", "checkpoint.json"),
    JSON.stringify({ checkpointed_at: new Date().toISOString(), phase: "phase_6_execution", feature: "resume-test", reinforcement_count: 3 })
  );
  const { output } = runScript("session-start.mjs", { cwd: TEMP_DIR, source: "compact" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "POST-COMPACTION RESUME", "should detect compact source");
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "phase_6_execution", "should include phase");
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "resume-test", "should include feature");
});

test("post-compaction resume loads latest handoff", () => {
  resetState();
  writeState({ active: true, current_phase: "phase_4_decomposition", started_at: new Date().toISOString() });
  writeFileSync(
    join(TEMP_DIR, ".oh-my-beads", "state", "checkpoint.json"),
    JSON.stringify({ checkpointed_at: new Date().toISOString(), phase: "phase_4_decomposition" })
  );
  writeFileSync(
    join(TEMP_DIR, ".oh-my-beads", "handoffs", "pre-compact-123.md"),
    "## Handoff\n\n**Phase:** phase_4_decomposition\nCritical info here."
  );
  const { output } = runScript("session-start.mjs", { cwd: TEMP_DIR, source: "compact" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "Last Handoff", "should include handoff");
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "Critical info here", "should include handoff content");
});

test("normal startup shows active session banner", () => {
  resetState();
  writeState({ active: true, current_phase: "phase_2_planning", mode: "mr.beads", started_at: new Date().toISOString() });
  const { output } = runScript("session-start.mjs", { cwd: TEMP_DIR, source: "startup" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "ACTIVE SESSION DETECTED", "should detect active session");
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "Mr.Beads", "should show mode");
});

test("normal startup with no session shows only banner", () => {
  resetState();
  const { output } = runScript("session-start.mjs", { cwd: TEMP_DIR, source: "startup" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "oh-my-beads plugin loaded", "should show banner");
  assert(!(parsed?.hookSpecificOutput?.additionalContext || "").includes("ACTIVE SESSION"), "should not show active session");
});

// ---- MR.FAST MODE: KEYWORD DETECTOR ----

console.log("\n=== keyword-detector.mjs (Mr.Fast) ===\n");

test("detects 'mr.fast' keyword and triggers invoke-fast", () => {
  resetState();
  const { output } = runScript("keyword-detector.mjs", { query: "mr.fast fix the login bug" });
  const parsed = parseOutput(output);
  assert(parsed, "output should be valid JSON");
  assert(parsed.continue === true, "should continue");
  assertContains(parsed.hookSpecificOutput?.additionalContext || "", "MAGIC KEYWORD: mr-fast", "mr.fast keyword");
});

test("detects 'mrfast' keyword", () => {
  resetState();
  const { output } = runScript("keyword-detector.mjs", { query: "mrfast find root cause of 500 error" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "MAGIC KEYWORD: mr-fast", "mrfast keyword");
});

test("mr.fast invokes correct skill", () => {
  resetState();
  const { output } = runScript("keyword-detector.mjs", { query: "mr.fast debug auth issue" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "oh-my-beads:mr-fast", "correct skill");
});

test("ignores informational queries about mr.fast", () => {
  const { output } = runScript("keyword-detector.mjs", { query: "what is mr.fast?" });
  const parsed = parseOutput(output);
  const ctx = parsed?.hookSpecificOutput?.additionalContext;
  assert(!ctx || !ctx.includes("MAGIC KEYWORD"), "should not trigger on informational mr.fast query");
});

test("handles cancel mrfast", () => {
  writeState({ active: true, current_phase: "fast_execution", mode: "mr.fast", started_at: new Date().toISOString() });
  const { output } = runScript("keyword-detector.mjs", { query: "cancel mrfast" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "cancel-omb", "cancel mrfast trigger");
  const state = readState();
  assert(state.active === false, "session should be deactivated");
});

test("detects 'mr.beads' keyword and triggers invoke", () => {
  resetState();
  const { output } = runScript("keyword-detector.mjs", { query: "mr.beads build a REST API" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "MAGIC KEYWORD: oh-my-beads", "mr.beads keyword");
});

test("mr.fast session state includes mode field", () => {
  resetState();
  runScript("keyword-detector.mjs", { query: "mr.fast fix bug" });
  const state = readState();
  assert(state, "session.json should exist");
  assert(state.mode === "mr.fast", `mode should be mr.fast, got ${state.mode}`);
  assert(state.current_phase === "fast_bootstrap", `phase should be fast_bootstrap, got ${state.current_phase}`);
});

test("omb keyword still works and includes mode field", () => {
  resetState();
  runScript("keyword-detector.mjs", { query: "omb build me a feature" });
  const state = readState();
  assert(state, "session.json should exist");
  assert(state.mode === "mr.beads", `mode should be mr.beads, got ${state.mode}`);
  assert(state.current_phase === "bootstrap", `phase should be bootstrap, got ${state.current_phase}`);
});

// ---- MR.FAST MODE: PERSISTENT MODE ----

console.log("\n=== persistent-mode.cjs (Mr.Fast) ===\n");

test("blocks stop during fast_scout phase", () => {
  writeState({
    active: true, current_phase: "fast_scout", mode: "mr.fast",
    started_at: new Date().toISOString(),
    last_checked_at: new Date().toISOString(),
    reinforcement_count: 0,
  });
  const { output } = runScript("persistent-mode.cjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assert(parsed?.decision === "block", "should block stop during fast_scout");
  assertContains(parsed?.reason || "", "Mr.Fast", "should mention Mr.Fast in block message");
});

test("blocks stop during fast_execution phase", () => {
  writeState({
    active: true, current_phase: "fast_execution", mode: "mr.fast",
    started_at: new Date().toISOString(),
    last_checked_at: new Date().toISOString(),
    reinforcement_count: 0,
  });
  const { output } = runScript("persistent-mode.cjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assert(parsed?.decision === "block", "should block stop during fast_execution");
});

test("allows stop for fast_complete phase", () => {
  writeState({ active: true, current_phase: "fast_complete", mode: "mr.fast", started_at: new Date().toISOString() });
  const { output } = runScript("persistent-mode.cjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assert(!parsed?.decision || parsed.decision !== "block", "should allow stop for fast_complete");
});

// ---- MR.FAST MODE: PRE-TOOL ENFORCER ----

console.log("\n=== pre-tool-enforcer.mjs (Mr.Fast) ===\n");

test("blocks Write for fast-scout", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", { tool_name: "Write" }, { OMB_AGENT_ROLE: "fast-scout" });
  assertContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "fast-scout Write");
});

test("allows Read for fast-scout", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", { tool_name: "Read" }, { OMB_AGENT_ROLE: "fast-scout" });
  assertNotContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "fast-scout Read");
});

test("blocks Agent for fast-scout", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", { tool_name: "Agent" }, { OMB_AGENT_ROLE: "fast-scout" });
  assertContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "fast-scout Agent");
});

// ---- MR.FAST MODE: VERIFY DELIVERABLES ----

console.log("\n=== verify-deliverables.mjs (Mr.Fast) ===\n");

test("fast-scout verification passes without CONTEXT.md", () => {
  resetState();
  const { output } = runScript("verify-deliverables.mjs", JSON.stringify({
    agent_id: "fast-scout-1", role: "fast-scout", directory: TEMP_DIR,
  }));
  const parsed = parseOutput(output);
  assert(parsed?.verified === true, "fast-scout should pass without CONTEXT.md");
});

// ---- AUDIT FIXES: PRE-TOOL ENFORCER HARDENING ----

console.log("\n=== pre-tool-enforcer.mjs (Audit Fixes) ===\n");

test("test-engineer can Write to absolute test path", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", {
    tool_name: "Write",
    tool_input: { file_path: "/home/user/project/test/helper.js" },
  }, { OMB_AGENT_ROLE: "test-engineer" });
  assertNotContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "test-engineer abs test path");
});

test("test-engineer blocked from writing non-test file", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", {
    tool_name: "Write",
    tool_input: { file_path: "/home/user/project/src/main.js" },
  }, { OMB_AGENT_ROLE: "test-engineer" });
  assertContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "test-engineer non-test");
});

test("test-engineer can Write to __tests__ directory", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", {
    tool_name: "Write",
    tool_input: { file_path: "/project/__tests__/foo.js" },
  }, { OMB_AGENT_ROLE: "test-engineer" });
  assertNotContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "test-engineer __tests__");
});

test("master can Write to .oh-my-beads/ state files", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", {
    tool_name: "Write",
    tool_input: { file_path: "/project/.oh-my-beads/state/session.json" },
  }, { OMB_AGENT_ROLE: "master" });
  assertNotContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "master .oh-my-beads write");
});

test("master blocked from writing source code", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", {
    tool_name: "Write",
    tool_input: { file_path: "/project/src/app.ts" },
  }, { OMB_AGENT_ROLE: "master" });
  assertContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "master source code");
});

test("scout can Write CONTEXT.md", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", {
    tool_name: "Write",
    tool_input: { file_path: "/project/.oh-my-beads/history/feature/CONTEXT.md" },
  }, { OMB_AGENT_ROLE: "scout" });
  assertNotContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "scout CONTEXT.md");
});

test("scout blocked from writing other files", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", {
    tool_name: "Write",
    tool_input: { file_path: "/project/src/auth.ts" },
  }, { OMB_AGENT_ROLE: "scout" });
  assertContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "scout source code");
});

test("architect can Write to plans directory", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", {
    tool_name: "Write",
    tool_input: { file_path: "/project/.oh-my-beads/plans/plan.md" },
  }, { OMB_AGENT_ROLE: "architect" });
  assertNotContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "architect plans");
});

test("architect blocked from writing source code", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", {
    tool_name: "Write",
    tool_input: { file_path: "/project/src/router.ts" },
  }, { OMB_AGENT_ROLE: "architect" });
  assertContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "architect source code");
});

test("blocks rm -rf /*", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", {
    tool_name: "Bash",
    tool_input: { command: "rm -rf /*" },
  });
  assertContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "rm -rf /*");
});

test("blocks --no-preserve-root", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", {
    tool_name: "Bash",
    tool_input: { command: "rm -rf --no-preserve-root /" },
  });
  assertContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "--no-preserve-root");
});

test("blocks find / -delete", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", {
    tool_name: "Bash",
    tool_input: { command: "find / -name '*.tmp' -delete" },
  });
  assertContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "find / -delete");
});

test("exact match prevents over-blocking (WriteFile not blocked by Write deny)", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", {
    tool_name: "WriteFile",
  }, { OMB_AGENT_ROLE: "reviewer" });
  // WriteFile is not in reviewer deny list (only "Write" is), so should NOT be blocked
  assertNotContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "WriteFile not blocked");
});

// ============================================================
// SUMMARY
// ============================================================

console.log(`\n${"=".repeat(50)}`);
console.log(`  TOTAL: ${total}  |  PASSED: ${passed}  |  FAILED: ${failed}`);
console.log(`${"=".repeat(50)}\n`);

teardown();
process.exit(failed > 0 ? 1 : 0);
