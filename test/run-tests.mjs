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
  assertContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "reviewer Write");
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
  assertContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "rm -rf /");
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

// ============================================================
// SUMMARY
// ============================================================

console.log(`\n${"=".repeat(50)}`);
console.log(`  TOTAL: ${total}  |  PASSED: ${passed}  |  FAILED: ${failed}`);
console.log(`${"=".repeat(50)}\n`);

teardown();
process.exit(failed > 0 ? 1 : 0);
