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
import { createHash } from "crypto";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(__dirname, "..", "scripts");
const TEMP_DIR = join(__dirname, "..", ".test-workspace");

// System-level state root for the test workspace.
// OMB_HOME overrides getSystemRoot() so all scripts write here instead of ~/.oh-my-beads/
const OMB_HOME = join(TEMP_DIR, ".omb-test-home");
const PROJECT_HASH = createHash("sha256").update(TEMP_DIR).digest("hex").slice(0, 8);
const STATE_DIR = join(OMB_HOME, "projects", PROJECT_HASH);
const HANDOFFS_DIR = join(STATE_DIR, "handoffs");

let passed = 0;
let failed = 0;
let total = 0;

// --- Test infrastructure ---

function setup() {
  rmSync(TEMP_DIR, { recursive: true, force: true });
  // System-level state dirs (scripts write here via OMB_HOME)
  mkdirSync(STATE_DIR, { recursive: true });
  mkdirSync(HANDOFFS_DIR, { recursive: true });
  // Legacy dirs still needed for scripts/tests that write artifacts (plans, history, handoffs)
  mkdirSync(join(TEMP_DIR, ".oh-my-beads", "state"), { recursive: true });
  mkdirSync(join(TEMP_DIR, ".oh-my-beads", "plans"), { recursive: true });
  mkdirSync(join(TEMP_DIR, ".oh-my-beads", "history"), { recursive: true });
  mkdirSync(join(TEMP_DIR, ".oh-my-beads", "handoffs"), { recursive: true });
}

function teardown() {
  rmSync(TEMP_DIR, { recursive: true, force: true });
}

function resetState() {
  // Clear system-level state files
  for (const f of ["session.json", "tool-tracking.json", "subagent-tracking.json", "checkpoint.json", "last-tool-error.json", "cancel-signal.json"]) {
    rmSync(join(STATE_DIR, f), { force: true });
  }
  // Clean system-level handoffs
  if (existsSync(HANDOFFS_DIR)) {
    for (const f of readdirSync(HANDOFFS_DIR)) {
      if (f !== ".gitkeep") rmSync(join(HANDOFFS_DIR, f), { force: true });
    }
  }
  // Also clear legacy state files (keyword-detector and persistent-mode read/write here)
  const legacyStateDir = join(TEMP_DIR, ".oh-my-beads", "state");
  for (const f of ["session.json", "tool-tracking.json", "subagent-tracking.json", "checkpoint.json", "last-tool-error.json", "cancel-signal.json"]) {
    rmSync(join(legacyStateDir, f), { force: true });
  }
  // Clean legacy handoffs
  const legacyHandoffsDir = join(TEMP_DIR, ".oh-my-beads", "handoffs");
  if (existsSync(legacyHandoffsDir)) {
    for (const f of readdirSync(legacyHandoffsDir)) {
      if (f !== ".gitkeep") rmSync(join(legacyHandoffsDir, f), { force: true });
    }
  }
}

function writeState(data) {
  // Write to system-level path (used by all resolveStateDir-based scripts)
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(join(STATE_DIR, "session.json"), JSON.stringify(data, null, 2));
  // Also write to legacy path (used by keyword-detector, persistent-mode, session-start fallback)
  mkdirSync(join(TEMP_DIR, ".oh-my-beads", "state"), { recursive: true });
  writeFileSync(join(TEMP_DIR, ".oh-my-beads", "state", "session.json"), JSON.stringify(data, null, 2));
}

function readState() {
  // Prefer system-level; fall back to legacy
  const systemPath = join(STATE_DIR, "session.json");
  if (existsSync(systemPath)) return JSON.parse(readFileSync(systemPath, "utf8"));
  const legacyPath = join(TEMP_DIR, ".oh-my-beads", "state", "session.json");
  return existsSync(legacyPath) ? JSON.parse(readFileSync(legacyPath, "utf8")) : null;
}

function runScript(scriptName, inputJson, env = {}) {
  const scriptPath = join(SCRIPTS_DIR, scriptName);
  const input = typeof inputJson === "string" ? inputJson : JSON.stringify(inputJson);
  try {
    const result = execFileSync(process.execPath, [scriptPath], {
      input,
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, OMB_HOME, ...env },
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
      env: { ...process.env, OMB_HOME },
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

test("ignores trailing question 'can I use omb?'", () => {
  const { output } = runScript("keyword-detector.mjs", { query: "can I use omb?" });
  const parsed = parseOutput(output);
  const ctx = parsed?.hookSpecificOutput?.additionalContext;
  assert(!ctx || !ctx.includes("MAGIC KEYWORD"), "should not trigger on question");
});

test("handles cancel omb", () => {
  writeState({ active: true, current_phase: "phase_2_planning", started_at: new Date().toISOString() });
  const { output } = runScript("keyword-detector.mjs", { query: "cancel omb" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "cancel-omb", "cancel trigger");
  const state = readState();
  assert(state.active === false, "session should be deactivated");
  assert(state.current_phase === "cancelled", "phase should be cancelled");
  // Verify cancel signal file was written (keyword-detector writes to system-level path)
  const signalPath = join(STATE_DIR, "cancel-signal.json");
  assert(existsSync(signalPath), "cancel-signal.json should exist");
  const signal = JSON.parse(readFileSync(signalPath, "utf8"));
  assert(signal.expires_at, "cancel signal should have expires_at");
  assert(new Date(signal.expires_at).getTime() > Date.now(), "cancel signal should not be expired");
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
  assert(state.awaiting_confirmation === true, "awaiting_confirmation should be true");
});

test("works with real CC 'prompt' field name", () => {
  resetState();
  // Claude Code sends `prompt`, not `query`
  const { output } = runScript("keyword-detector.mjs", { hook_event_name: "UserPromptSubmit", prompt: "omb build REST API" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "MAGIC KEYWORD: oh-my-beads", "prompt field");
  const state = readState();
  assert(state?.active === true, "should activate with prompt field");
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

test("blocks stop with real CC stop hook format (stop_hook_active)", () => {
  writeState({
    active: true, current_phase: "phase_6_execution",
    started_at: new Date().toISOString(),
    last_checked_at: new Date().toISOString(),
    reinforcement_count: 0,
  });
  // Real Claude Code Stop hook payload — only stop_hook_active + base fields
  const { output } = runScript("persistent-mode.cjs", {
    hook_event_name: "Stop",
    stop_hook_active: true,
    cwd: TEMP_DIR,
  });
  const parsed = parseOutput(output);
  assert(parsed?.decision === "block", "should block stop with real CC payload");
});

test("allows stop when cancel_requested is set", () => {
  writeState({ active: true, current_phase: "phase_6_execution", started_at: new Date().toISOString(), cancel_requested: true });
  const { output } = runScript("persistent-mode.cjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assert(!parsed?.decision || parsed.decision !== "block", "should allow stop on cancel_requested");
});

test("allows stop when cancel-signal.json has valid TTL", () => {
  writeState({
    active: true, current_phase: "phase_6_execution",
    started_at: new Date().toISOString(),
    last_checked_at: new Date().toISOString(),
    reinforcement_count: 0,
  });
  writeFileSync(
    join(TEMP_DIR, ".oh-my-beads", "state", "cancel-signal.json"),
    JSON.stringify({ cancelled_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30_000).toISOString() })
  );
  const { output } = runScript("persistent-mode.cjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assert(!parsed?.decision || parsed.decision !== "block", "should allow stop with valid cancel signal");
});

test("blocks stop when cancel-signal.json is expired", () => {
  writeState({
    active: true, current_phase: "phase_6_execution",
    started_at: new Date().toISOString(),
    last_checked_at: new Date().toISOString(),
    reinforcement_count: 0,
  });
  writeFileSync(
    join(TEMP_DIR, ".oh-my-beads", "state", "cancel-signal.json"),
    JSON.stringify({ cancelled_at: new Date(Date.now() - 60_000).toISOString(), expires_at: new Date(Date.now() - 30_000).toISOString() })
  );
  const { output } = runScript("persistent-mode.cjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assert(parsed?.decision === "block", "should block stop with expired cancel signal");
});

test("allows stop when awaiting_confirmation is true", () => {
  writeState({
    active: true, current_phase: "bootstrap",
    started_at: new Date().toISOString(),
    last_checked_at: new Date().toISOString(),
    reinforcement_count: 0,
    awaiting_confirmation: true,
  });
  const { output } = runScript("persistent-mode.cjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assert(!parsed?.decision || parsed.decision !== "block", "should allow stop while awaiting confirmation");
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
  rmSync(join(STATE_DIR, "tool-tracking.json"), { force: true });
  runScript("post-tool-verifier.mjs", {
    cwd: TEMP_DIR, tool_name: "Write", tool_input: { file_path: "/tmp/test.ts" }, tool_output: "File written",
  });
  const tracking = JSON.parse(readFileSync(join(STATE_DIR, "tool-tracking.json"), "utf8"));
  assert(tracking.files_modified.includes("/tmp/test.ts"), "should track written file");
});

test("tracks file modifications from Edit tool", () => {
  writeState({ active: true, current_phase: "phase_6_execution", started_at: new Date().toISOString() });
  rmSync(join(STATE_DIR, "tool-tracking.json"), { force: true });
  runScript("post-tool-verifier.mjs", {
    cwd: TEMP_DIR, tool_name: "Edit", tool_input: { file_path: "/tmp/edit.ts" }, tool_output: "Edited",
  });
  const tracking = JSON.parse(readFileSync(join(STATE_DIR, "tool-tracking.json"), "utf8"));
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
  assert(parsed?.hookSpecificOutput?.permissionDecision === "deny", "should use permissionDecision: deny for engine enforcement");
});

test("allows Edit for master (restricted to .oh-my-beads/)", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", { tool_name: "Edit" }, { OMB_AGENT_ROLE: "master" });
  assertNotContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "master Edit");
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
  assert(!existsSync(join(STATE_DIR, "session.json")), "session.json should be gone");
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
  const tracking = JSON.parse(readFileSync(join(STATE_DIR, "subagent-tracking.json"), "utf8"));
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
  const tracking = JSON.parse(readFileSync(join(STATE_DIR, "subagent-tracking.json"), "utf8"));
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
  assert(existsSync(join(STATE_DIR, "checkpoint.json")), "checkpoint.json exists");
  const checkpoint = JSON.parse(readFileSync(join(STATE_DIR, "checkpoint.json"), "utf8"));
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
  const handoffs = readdirSync(HANDOFFS_DIR).filter(f => f.startsWith("pre-compact-"));
  assert(handoffs.length > 0, "handoff file should exist");
  const content = readFileSync(join(HANDOFFS_DIR, handoffs[0]), "utf8");
  assertContains(content, "phase_4_decomposition", "handoff contains phase");
});

test("includes systemMessage for post-compaction re-injection", () => {
  resetState();
  writeState({
    active: true, current_phase: "phase_6_execution", mode: "mr.beads",
    started_at: new Date().toISOString(), feature_slug: "sysmsg-test",
  });
  const { output } = runScript("pre-compact.mjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assert(parsed?.systemMessage, "should include systemMessage");
  assertContains(parsed.systemMessage, "POST-COMPACTION CONTEXT", "systemMessage header");
  assertContains(parsed.systemMessage, "Mr.Beads", "systemMessage includes mode");
  assertContains(parsed.systemMessage, "sysmsg-test", "systemMessage includes feature");
});

// ---- SESSION START: POST-COMPACTION RESUME ----

console.log("\n=== session-start.mjs (Post-Compaction) ===\n");

test("post-compaction resume loads checkpoint context", () => {
  resetState();
  writeState({ active: true, current_phase: "phase_6_execution", started_at: new Date().toISOString(), feature_slug: "resume-test" });
  // Write a checkpoint (simulates pre-compact hook having run) to system-level path
  writeFileSync(
    join(STATE_DIR, "checkpoint.json"),
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
    join(STATE_DIR, "checkpoint.json"),
    JSON.stringify({ checkpointed_at: new Date().toISOString(), phase: "phase_4_decomposition" })
  );
  writeFileSync(
    join(HANDOFFS_DIR, "pre-compact-123.md"),
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
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "oh-my-beads v1.2.0 loaded", "should show banner");
  assert(!(parsed?.hookSpecificOutput?.additionalContext || "").includes("ACTIVE SESSION"), "should not show active session");
});

// ---- SESSION START: FIRST-RUN DETECTION ----

console.log("\n=== session-start.mjs (First-Run Detection) ===\n");

test("shows first-run banner when no setup.json exists", () => {
  resetState();
  // Ensure no setup.json at OMB_HOME level
  rmSync(join(OMB_HOME, "setup.json"), { force: true });
  const { output } = runScript("session-start.mjs", { cwd: TEMP_DIR, source: "startup" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "[FIRST RUN]", "should show first-run banner");
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "setup omb", "should suggest setup omb");
});

test("shows update banner when setupVersion is outdated", () => {
  resetState();
  // Write setup.json with old version
  writeFileSync(
    join(OMB_HOME, "setup.json"),
    JSON.stringify({ setupCompleted: new Date().toISOString(), setupVersion: "1.0.0" })
  );
  const { output } = runScript("session-start.mjs", { cwd: TEMP_DIR, source: "startup" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "[UPDATE]", "should show update banner");
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "setup omb", "should suggest setup omb");
  // Cleanup
  rmSync(join(OMB_HOME, "setup.json"), { force: true });
});

test("no first-run banner when setupVersion matches current", () => {
  resetState();
  // Write setup.json with current version
  writeFileSync(
    join(OMB_HOME, "setup.json"),
    JSON.stringify({ setupCompleted: new Date().toISOString(), setupVersion: "1.2.0" })
  );
  const { output } = runScript("session-start.mjs", { cwd: TEMP_DIR, source: "startup" });
  const parsed = parseOutput(output);
  const ctx = parsed?.hookSpecificOutput?.additionalContext || "";
  assertNotContains(ctx, "[FIRST RUN]", "should not show first-run when setup current");
  assertNotContains(ctx, "[UPDATE]", "should not show update when setup current");
  // Cleanup
  rmSync(join(OMB_HOME, "setup.json"), { force: true });
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
  assert(state.intent === "standard", `intent should be standard, got ${state.intent}`);
  assert(state.current_phase === "fast_scout", `phase should be fast_scout, got ${state.current_phase}`);
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

test("allows Write BRIEF.md for fast-scout", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", { tool_name: "Write", tool_input: { file_path: "/project/BRIEF.md" } }, { OMB_AGENT_ROLE: "fast-scout" });
  assertNotContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "fast-scout Write BRIEF.md");
});

test("blocks Write non-BRIEF for fast-scout", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", { tool_name: "Write", tool_input: { file_path: "/project/src/app.ts" } }, { OMB_AGENT_ROLE: "fast-scout" });
  assertContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "fast-scout Write src/app.ts");
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

test("master can write source code (prefers delegation)", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", {
    tool_name: "Write",
    tool_input: { file_path: "/project/src/app.ts" },
  }, { OMB_AGENT_ROLE: "master" });
  assertNotContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "master source code");
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

// ---- ROLE DETECTION: FALSE MATCH REGRESSION ----

console.log("\n=== pre-tool-enforcer.mjs (Role Detection) ===\n");

test("prompt text mentioning 'scout' does NOT trigger scout role", () => {
  // Master spawns Agent with prompt that mentions "Scout" — must NOT be blocked
  const { output } = runScript("pre-tool-enforcer.mjs", {
    tool_name: "Agent",
    tool_input: {
      prompt: "Spawn Scout agent to explore requirements for the feature",
      description: "Scout exploration",
      subagent_type: "oh-my-beads:scout",  // subagent_type refers to the SPAWNED agent, not caller
    },
  });
  // No OMB_AGENT_ROLE env → caller is Master/main session → should allow
  assertNotContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "prompt mentioning scout");
});

test("prompt text mentioning 'reviewer' does NOT trigger reviewer role", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", {
    tool_name: "Write",
    tool_input: {
      file_path: "/project/.oh-my-beads/handoffs/phase7.md",
      content: "Reviewer approved all beads",
    },
  });
  assertNotContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "prompt mentioning reviewer");
});

test("prompt text mentioning 'worker' does NOT trigger worker role", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", {
    tool_name: "Edit",
    tool_input: {
      file_path: "/project/.oh-my-beads/state/session.json",
      old_string: "phase_5",
      new_string: "phase_6",
    },
    description: "Update state after Worker completed bead",
  });
  assertNotContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "prompt mentioning worker");
});

test("env var OMB_AGENT_ROLE takes priority over all heuristics", () => {
  const { output } = runScript("pre-tool-enforcer.mjs", {
    tool_name: "Write",
    tool_input: { file_path: "/project/src/app.ts" },
    subagent_type: "master",  // even if subagent_type says master
  }, { OMB_AGENT_ROLE: "reviewer" });
  // env says reviewer → blocked (reviewer can't Write)
  assertContains(parseOutput(output)?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "env priority over heuristic");
});

// ---- PROMPT LEVERAGE: UNIT TESTS ----

console.log("\n=== prompt-leverage.mjs ===\n");

// Import prompt-leverage for direct unit testing
const { detectTask, inferIntensity, upgradePrompt } = await import(join(SCRIPTS_DIR, "prompt-leverage.mjs"));

test("detectTask identifies coding from 'fix bug'", () => {
  assert(detectTask("fix the login bug in auth.ts") === "coding", "should detect coding");
});

test("detectTask identifies research from 'research compare'", () => {
  assert(detectTask("research and compare database options") === "research", "should detect research");
});

test("detectTask identifies analysis from 'analyze root cause'", () => {
  assert(detectTask("analyze root cause of the 500 errors") === "analysis", "should detect analysis");
});

test("detectTask identifies planning from 'plan roadmap'", () => {
  assert(detectTask("plan the roadmap for Q3 release") === "planning", "should detect planning");
});

test("detectTask identifies review from 'audit'", () => {
  assert(detectTask("audit the authentication middleware") === "review", "should detect review");
});

test("detectTask defaults to analysis for ambiguous input", () => {
  assert(detectTask("make it better") === "analysis", "should default to analysis");
});

test("inferIntensity returns Deep for critical keywords", () => {
  assert(inferIntensity("careful deep analysis of security", "analysis") === "Deep", "should be Deep");
});

test("inferIntensity returns Standard for coding tasks", () => {
  assert(inferIntensity("fix the login bug", "coding") === "Standard", "should be Standard");
});

test("inferIntensity returns Light for writing tasks", () => {
  assert(inferIntensity("draft a changelog", "writing") === "Light", "should be Light");
});

test("upgradePrompt returns clean enhanced prompt with guardrails", () => {
  const { augmented, task, intensity } = upgradePrompt("implement a REST API endpoint");
  assert(task === "coding", `task should be coding, got ${task}`);
  assert(intensity === "Standard", `intensity should be Standard, got ${intensity}`);
  // Original text preserved
  assertContains(augmented, "implement a REST API endpoint", "augmented contains original");
  // Task-specific guardrails woven in (no framework labels)
  assertContains(augmented, "Inspect relevant files", "augmented has tool guidance");
  assertContains(augmented, "Verify", "augmented has verification");
  // No framework labels leaked
  assertNotContains(augmented, "Objective:", "no Objective label");
  assertNotContains(augmented, "Work Style:", "no Work Style label");
  assertNotContains(augmented, "Done Criteria:", "no Done Criteria label");
});

test("upgradePrompt caps intensity to Light in mr.fast mode", () => {
  const { intensity } = upgradePrompt("carefully debug the critical auth issue", { mode: "mr.fast" });
  assert(intensity === "Light", `mr.fast should cap at Light, got ${intensity}`);
});

test("upgradePrompt allows Deep in mr.beads mode", () => {
  const { intensity } = upgradePrompt("carefully debug the critical auth issue", { mode: "mr.beads" });
  assert(intensity === "Deep", `mr.beads should allow Deep, got ${intensity}`);
});

test("upgradePrompt preserves original text in output", () => {
  const { augmented } = upgradePrompt("fix login validation bug");
  assertContains(augmented, "fix login validation bug", "should preserve original text");
});

// ---- PROMPT LEVERAGE: INTEGRATION (keyword-detector output) ----

console.log("\n=== keyword-detector.mjs (Prompt Leverage Integration) ===\n");

test("omb keyword output includes augmented prompt", () => {
  resetState();
  const { output } = runScript("keyword-detector.mjs", { query: "omb build a REST API" });
  const parsed = parseOutput(output);
  const ctx = parsed?.hookSpecificOutput?.additionalContext || "";
  assertContains(ctx, "omb build a REST API", "should include original text");
  assertContains(ctx, "Inspect relevant files", "should include tool guidance from prompt-leverage");
});

test("mr.fast keyword output includes augmented prompt", () => {
  resetState();
  const { output } = runScript("keyword-detector.mjs", { query: "mr.fast fix the login bug" });
  const parsed = parseOutput(output);
  const ctx = parsed?.hookSpecificOutput?.additionalContext || "";
  assertContains(ctx, "mr.fast fix the login bug", "should include original text");
  assertContains(ctx, "Inspect relevant files", "should include tool guidance from prompt-leverage");
});

test("omb keyword output embeds original text in Objective", () => {
  resetState();
  const { output } = runScript("keyword-detector.mjs", { query: "omb research database options" });
  const parsed = parseOutput(output);
  const ctx = parsed?.hookSpecificOutput?.additionalContext || "";
  assertContains(ctx, "omb research database options", "should contain original text in Objective");
  assertNotContains(ctx, "User Request (original)", "should NOT have separate original section");
});

test("non-keyword prompts are NOT augmented", () => {
  const { output } = runScript("keyword-detector.mjs", { query: "fix the login bug" });
  const parsed = parseOutput(output);
  const ctx = parsed?.hookSpecificOutput?.additionalContext;
  assert(!ctx, "non-keyword prompts should have no additionalContext");
});

// ---- POST TOOL USE FAILURE ----

console.log("\n=== post-tool-use-failure.mjs ===\n");

test("tracks first failure for a tool", () => {
  resetState();
  const { output } = runScript("post-tool-use-failure.mjs", {
    cwd: TEMP_DIR, tool_name: "Bash", tool_error: "Error: command not found",
  });
  const parsed = parseOutput(output);
  assert(parsed?.continue === true, "should continue");
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "attempt 1", "first attempt");
  const errorState = JSON.parse(readFileSync(join(STATE_DIR, "last-tool-error.json"), "utf8"));
  assert(errorState.tool_name === "Bash", "should track tool name");
  assert(errorState.retry_count === 1, "retry_count should be 1");
  assert(errorState.escalated === false, "should not be escalated yet");
});

test("increments retry count for same tool within window", () => {
  // First failure already set by previous test, let's set it explicitly
  resetState();
  const now = new Date().toISOString();
  writeFileSync(
    join(STATE_DIR, "last-tool-error.json"),
    JSON.stringify({ tool_name: "Bash", retry_count: 3, last_failure_at: now, error_snippet: "err", escalated: false })
  );
  const { output } = runScript("post-tool-use-failure.mjs", {
    cwd: TEMP_DIR, tool_name: "Bash", tool_error: "Error: still failing",
  });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "attempt 4", "should increment");
  const errorState = JSON.parse(readFileSync(join(STATE_DIR, "last-tool-error.json"), "utf8"));
  assert(errorState.retry_count === 4, `retry_count should be 4, got ${errorState.retry_count}`);
});

test("resets retry count for different tool", () => {
  resetState();
  const now = new Date().toISOString();
  writeFileSync(
    join(STATE_DIR, "last-tool-error.json"),
    JSON.stringify({ tool_name: "Bash", retry_count: 4, last_failure_at: now, error_snippet: "err", escalated: false })
  );
  const { output } = runScript("post-tool-use-failure.mjs", {
    cwd: TEMP_DIR, tool_name: "Write", tool_error: "Permission denied",
  });
  const errorState = JSON.parse(readFileSync(join(STATE_DIR, "last-tool-error.json"), "utf8"));
  assert(errorState.tool_name === "Write", "should track new tool");
  assert(errorState.retry_count === 1, `retry_count should reset to 1, got ${errorState.retry_count}`);
});

test("escalates at threshold (5 retries)", () => {
  resetState();
  const now = new Date().toISOString();
  writeFileSync(
    join(STATE_DIR, "last-tool-error.json"),
    JSON.stringify({ tool_name: "Bash", retry_count: 4, last_failure_at: now, error_snippet: "err", escalated: false })
  );
  const { output } = runScript("post-tool-use-failure.mjs", {
    cwd: TEMP_DIR, tool_name: "Bash", tool_error: "Error: still broken",
  });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "systemic issue", "escalation message");
  const errorState = JSON.parse(readFileSync(join(STATE_DIR, "last-tool-error.json"), "utf8"));
  assert(errorState.escalated === true, "should be escalated");
  assert(errorState.retry_count === 5, `retry_count should be 5, got ${errorState.retry_count}`);
});

test("handles missing state directory gracefully", () => {
  rmSync(join(TEMP_DIR, ".oh-my-beads"), { recursive: true, force: true });
  mkdirSync(join(TEMP_DIR, ".oh-my-beads", "state"), { recursive: true });
  const { output, exitCode } = runScript("post-tool-use-failure.mjs", {
    cwd: TEMP_DIR, tool_name: "Read", tool_error: "File not found",
  });
  assert(exitCode === 0, "should not crash");
  const parsed = parseOutput(output);
  assert(parsed?.continue === true, "should continue");
  // Re-create dirs for subsequent tests
  mkdirSync(join(TEMP_DIR, ".oh-my-beads", "plans"), { recursive: true });
  mkdirSync(join(TEMP_DIR, ".oh-my-beads", "history"), { recursive: true });
  mkdirSync(join(TEMP_DIR, ".oh-my-beads", "handoffs"), { recursive: true });
});

// ---- SESSION END ----

console.log("\n=== session-end.mjs ===\n");

test("deactivates non-critical active session on end", () => {
  resetState();
  writeState({
    active: true, current_phase: "phase_2_planning",
    started_at: new Date().toISOString(),
  });
  const { output } = runScript("session-end.mjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assert(parsed?.continue === true, "should continue");
  const state = readState();
  assert(state.active === false, "should deactivate on session end");
  assert(state.deactivated_reason === "session_ended", "should note reason");
  assert(state.session_ended_at, "should have session_ended_at");
});

test("preserves critical phase session on end", () => {
  resetState();
  writeState({
    active: true, current_phase: "phase_6_execution",
    started_at: new Date().toISOString(),
  });
  runScript("session-end.mjs", { cwd: TEMP_DIR });
  const state = readState();
  assert(state.active === true, "should remain active for critical phase");
  assert(state.session_ended_at, "should still note session end time");
});

test("does nothing when no active session", () => {
  resetState();
  const { output } = runScript("session-end.mjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assert(parsed?.continue === true, "should continue");
  assert(!parsed?.hookSpecificOutput?.additionalContext, "no context for inactive session");
});

test("cleans up last-tool-error.json", () => {
  resetState();
  writeState({ active: true, current_phase: "phase_3_persistence", started_at: new Date().toISOString() });
  writeFileSync(
    join(STATE_DIR, "last-tool-error.json"),
    JSON.stringify({ tool_name: "Bash", retry_count: 3 })
  );
  runScript("session-end.mjs", { cwd: TEMP_DIR });
  const errorState = JSON.parse(readFileSync(join(STATE_DIR, "last-tool-error.json"), "utf8"));
  assert(errorState.reason === "session_end", "should clear error state");
});

// ---- CONTEXT GUARD STOP ----

console.log("\n=== context-guard-stop.mjs ===\n");

test("passes through when no active session", () => {
  resetState();
  const { output } = runScript("context-guard-stop.mjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assert(parsed?.continue === true, "should continue");
  assert(parsed?.suppressOutput === true, "should suppress output");
});

test("passes through for normal stop (no context pressure)", () => {
  resetState();
  writeState({
    active: true, current_phase: "phase_6_execution",
    started_at: new Date().toISOString(),
  });
  const { output } = runScript("context-guard-stop.mjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assert(parsed?.continue === true, "should pass through");
  assert(parsed?.suppressOutput === true, "should suppress output");
});

test("allows stop on inactive session", () => {
  resetState();
  writeState({ active: false, current_phase: "complete" });
  const { output } = runScript("context-guard-stop.mjs", { cwd: TEMP_DIR });
  const parsed = parseOutput(output);
  assert(parsed?.continue === true, "should allow stop");
});

// ---- UPDATE PLUGIN: KEYWORD DETECTOR ----

console.log("\n=== keyword-detector.mjs (Update Plugin) ===\n");

test("detects 'update omb' keyword", () => {
  resetState();
  const { output } = runScript("keyword-detector.mjs", { query: "update omb" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "MAGIC KEYWORD: update-omb", "update omb keyword");
});

test("detects 'omb update' keyword", () => {
  resetState();
  const { output } = runScript("keyword-detector.mjs", { query: "omb update" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "MAGIC KEYWORD: update-omb", "omb update keyword");
});

test("detects 'upgrade omb' keyword", () => {
  resetState();
  const { output } = runScript("keyword-detector.mjs", { query: "upgrade omb" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "MAGIC KEYWORD: update-omb", "upgrade omb keyword");
});

test("update invokes correct skill", () => {
  resetState();
  const { output } = runScript("keyword-detector.mjs", { query: "update omb" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "oh-my-beads:update-plugin", "correct skill");
});

test("ignores informational query about update omb", () => {
  const { output } = runScript("keyword-detector.mjs", { query: "what does update omb do?" });
  const parsed = parseOutput(output);
  const ctx = parsed?.hookSpecificOutput?.additionalContext;
  assert(!ctx || !ctx.includes("MAGIC KEYWORD"), "should not trigger on informational update query");
});

test("update does not write session state", () => {
  resetState();
  runScript("keyword-detector.mjs", { query: "update omb" });
  const state = readState();
  assert(!state || !state.active, "update should not activate a session");
});

// ---- WORKER GUARD: KEYWORD DETECTOR ----

console.log("\n=== keyword-detector.mjs (Worker Guard) ===\n");

test("skips keyword matching when OMB_AGENT_ROLE is set", () => {
  resetState();
  const { output } = runScript("keyword-detector.mjs", { query: "omb build feature" }, { OMB_AGENT_ROLE: "worker" });
  const parsed = parseOutput(output);
  const ctx = parsed?.hookSpecificOutput?.additionalContext;
  assert(!ctx || !ctx.includes("MAGIC KEYWORD"), "should not trigger keyword when OMB_AGENT_ROLE is set");
});

test("skips keyword matching when OMB_TEAM_WORKER is set", () => {
  resetState();
  const { output } = runScript("keyword-detector.mjs", { query: "mr.fast fix bug" }, { OMB_TEAM_WORKER: "true" });
  const parsed = parseOutput(output);
  const ctx = parsed?.hookSpecificOutput?.additionalContext;
  assert(!ctx || !ctx.includes("MAGIC KEYWORD"), "should not trigger keyword when OMB_TEAM_WORKER is set");
});

test("still detects keywords without worker env vars", () => {
  resetState();
  const { output } = runScript("keyword-detector.mjs", { query: "omb start feature" }, {});
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "MAGIC KEYWORD: oh-my-beads", "should detect without worker vars");
});

// ---- OUTPUT CLIPPING: POST-TOOL VERIFIER ----

console.log("\n=== post-tool-verifier.mjs (Output Clipping) ===\n");

test("clips output exceeding MAX_OUTPUT_CHARS", () => {
  writeState({ active: true, current_phase: "phase_6_execution", started_at: new Date().toISOString() });
  const bigOutput = "x".repeat(15000);
  const { output } = runScript("post-tool-verifier.mjs", { cwd: TEMP_DIR, tool_name: "Bash", tool_output: bigOutput });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "clipped", "should clip large output");
});

test("passes through output under MAX_OUTPUT_CHARS", () => {
  writeState({ active: true, current_phase: "phase_6_execution", started_at: new Date().toISOString() });
  const { output } = runScript("post-tool-verifier.mjs", { cwd: TEMP_DIR, tool_name: "Bash", tool_output: "All tests passed" });
  const parsed = parseOutput(output);
  assert(!parsed?.hookSpecificOutput?.additionalContext, "should not clip small output");
});

test("respects OMB_MAX_OUTPUT_CHARS env override", () => {
  writeState({ active: true, current_phase: "phase_6_execution", started_at: new Date().toISOString() });
  const mediumOutput = "y".repeat(600);
  const { output } = runScript("post-tool-verifier.mjs", { cwd: TEMP_DIR, tool_name: "Bash", tool_output: mediumOutput }, { OMB_MAX_OUTPUT_CHARS: "500" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "clipped", "should clip with custom threshold");
});

// ---- SESSION-SCOPED STATE: POST-TOOL VERIFIER ----

console.log("\n=== post-tool-verifier.mjs (Session-Scoped State) ===\n");

test("writes tracking to session-scoped path when session_id provided", () => {
  resetState();
  // With OMB_HOME set, session-scoped path is STATE_DIR/sessions/{sessionId}/
  const scopedDir = join(STATE_DIR, "sessions", "test-session-123");
  mkdirSync(scopedDir, { recursive: true });
  writeFileSync(
    join(scopedDir, "session.json"),
    JSON.stringify({ active: true, current_phase: "phase_6_execution", started_at: new Date().toISOString() })
  );
  runScript("post-tool-verifier.mjs", {
    cwd: TEMP_DIR, session_id: "test-session-123",
    tool_name: "Write", tool_input: { file_path: "/tmp/scoped-test.ts" }, tool_output: "Written",
  });
  const trackingPath = join(scopedDir, "tool-tracking.json");
  assert(existsSync(trackingPath), "session-scoped tool-tracking.json should exist");
  const tracking = JSON.parse(readFileSync(trackingPath, "utf8"));
  assert(tracking.files_modified.includes("/tmp/scoped-test.ts"), "should track file in scoped path");
});

test("falls back to legacy path without session_id", () => {
  resetState();
  writeState({ active: true, current_phase: "phase_6_execution", started_at: new Date().toISOString() });
  runScript("post-tool-verifier.mjs", {
    cwd: TEMP_DIR, tool_name: "Write", tool_input: { file_path: "/tmp/legacy-test.ts" }, tool_output: "Written",
  });
  // Without session_id, writes to STATE_DIR (system-level root for this project)
  const trackingPath = join(STATE_DIR, "tool-tracking.json");
  assert(existsSync(trackingPath), "tool-tracking.json should exist at system-level path");
});

// ---- STATUSLINE HUD ----

console.log("\n=== statusline.mjs (OMB Hub HUD) ===\n");

// Helper: run statusline with stdin JSON and optional env
function runStatusline(stdinJson, env = {}) {
  const scriptPath = join(SCRIPTS_DIR, "statusline.mjs");
  const input = typeof stdinJson === "string" ? stdinJson : JSON.stringify(stdinJson);
  try {
    const result = execFileSync(process.execPath, [scriptPath], {
      input,
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, OMB_HOME, ...env },
      cwd: TEMP_DIR,
    });
    // Replace non-breaking spaces back to regular spaces for assertion readability
    return result.replace(/\u00A0/g, " ").trim();
  } catch (err) {
    return (err.stdout || "").replace(/\u00A0/g, " ").trim();
  }
}

// Strip ANSI escape codes for clean text assertions
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

test("shows idle when no session exists", () => {
  resetState();
  const output = runStatusline({ cwd: TEMP_DIR });
  const clean = stripAnsi(output);
  assertContains(clean, "[OMB#", "should have OMB label");
  assertContains(clean, "idle", "should show idle");
});

test("shows Mr.Beads mode and phase", () => {
  resetState();
  writeState({
    active: true, mode: "mr.beads", current_phase: "phase_6_execution",
    started_at: new Date().toISOString(), reinforcement_count: 3, failure_count: 1,
  });
  const output = runStatusline({ cwd: TEMP_DIR });
  const clean = stripAnsi(output);
  assertContains(clean, "Mr.Beads", "should show Mr.Beads mode");
  assertContains(clean, "Phase 6: Execution", "should show phase");
  assertContains(clean, "reinforcements:3", "should show reinforcement count");
  assertContains(clean, "failures:1", "should show failure count");
});

test("shows Mr.Fast mode and phase", () => {
  resetState();
  writeState({
    active: true, mode: "mr.fast", current_phase: "fast_execution",
    started_at: new Date().toISOString(), failure_count: 0,
  });
  const output = runStatusline({ cwd: TEMP_DIR });
  const clean = stripAnsi(output);
  assertContains(clean, "Mr.Fast", "should show Mr.Fast mode");
  assertContains(clean, "Implementing", "should show fast_execution as Implementing");
  assertNotContains(clean, "reinforcements:", "Mr.Fast should not show reinforcement count");
  assertContains(clean, "failures:0", "should show failure count");
});

test("shows context window percentage from stdin", () => {
  resetState();
  writeState({
    active: true, mode: "mr.beads", current_phase: "phase_2_planning",
    started_at: new Date().toISOString(),
  });
  const output = runStatusline({
    cwd: TEMP_DIR,
    context_window: { used_percentage: 42 },
  });
  const clean = stripAnsi(output);
  assertContains(clean, "ctx:", "should have context element");
  assertContains(clean, "42%", "should show 42%");
});

test("shows context warning at 75%", () => {
  resetState();
  writeState({
    active: true, mode: "mr.beads", current_phase: "phase_6_execution",
    started_at: new Date().toISOString(),
  });
  const output = runStatusline({
    cwd: TEMP_DIR,
    context_window: { used_percentage: 75 },
  });
  const clean = stripAnsi(output);
  assertContains(clean, "75%", "should show 75%");
  // Yellow color (warning) should be present in raw output
  assertContains(output, "\x1b[33m", "should have yellow ANSI for warning");
});

test("shows COMPRESS? at 80%", () => {
  resetState();
  writeState({
    active: true, mode: "mr.beads", current_phase: "phase_6_execution",
    started_at: new Date().toISOString(),
  });
  const output = runStatusline({
    cwd: TEMP_DIR,
    context_window: { used_percentage: 82 },
  });
  const clean = stripAnsi(output);
  assertContains(clean, "COMPRESS?", "should show COMPRESS? at 82%");
});

test("shows CRITICAL at 90%", () => {
  resetState();
  writeState({
    active: true, mode: "mr.beads", current_phase: "phase_6_execution",
    started_at: new Date().toISOString(),
  });
  const output = runStatusline({
    cwd: TEMP_DIR,
    context_window: { used_percentage: 90 },
  });
  const clean = stripAnsi(output);
  assertContains(clean, "CRITICAL", "should show CRITICAL at 90%");
  assertContains(output, "\x1b[31m", "should have red ANSI for critical");
});

test("shows session duration", () => {
  resetState();
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  writeState({
    active: true, mode: "mr.beads", current_phase: "phase_6_execution",
    started_at: fiveMinAgo,
  });
  const output = runStatusline({ cwd: TEMP_DIR });
  const clean = stripAnsi(output);
  assertContains(clean, "session:", "should have session element");
  assertContains(clean, "5m", "should show ~5m duration");
});

test("shows beads progress when beads_created > 0", () => {
  resetState();
  writeState({
    active: true, mode: "mr.beads", current_phase: "phase_6_execution",
    started_at: new Date().toISOString(), beads_created: 8, beads_closed: 3,
  });
  const output = runStatusline({ cwd: TEMP_DIR });
  const clean = stripAnsi(output);
  assertContains(clean, "beads:3/8", "should show beads progress");
});

test("hides beads when beads_created is 0", () => {
  resetState();
  writeState({
    active: true, mode: "mr.beads", current_phase: "phase_2_planning",
    started_at: new Date().toISOString(), beads_created: 0,
  });
  const output = runStatusline({ cwd: TEMP_DIR });
  const clean = stripAnsi(output);
  assertNotContains(clean, "beads:", "should not show beads when none created");
});

test("shows active agents from subagent-tracking.json", () => {
  resetState();
  writeState({
    active: true, mode: "mr.beads", current_phase: "phase_6_execution",
    started_at: new Date().toISOString(),
  });
  writeFileSync(
    join(TEMP_DIR, ".oh-my-beads", "state", "subagent-tracking.json"),
    JSON.stringify({
      agents: [
        { id: "w1", role: "worker", status: "running", model: "sonnet" },
        { id: "r1", role: "reviewer", status: "running", model: "opus" },
        { id: "e1", role: "explorer", status: "stopped", model: "haiku" },
      ],
    })
  );
  const output = runStatusline({ cwd: TEMP_DIR });
  const clean = stripAnsi(output);
  assertContains(clean, "agents:", "should have agents element");
  assertContains(clean, "W", "should show worker code");
  assertContains(clean, "R", "should show reviewer code");
  assertNotContains(clean, "agents:WRe", "should not include stopped agent");
});

test("shows files count from tool-tracking.json", () => {
  resetState();
  writeState({
    active: true, mode: "mr.beads", current_phase: "phase_6_execution",
    started_at: new Date().toISOString(),
  });
  writeFileSync(
    join(TEMP_DIR, ".oh-my-beads", "state", "tool-tracking.json"),
    JSON.stringify({ files_modified: ["/a.ts", "/b.ts", "/c.ts"] })
  );
  const output = runStatusline({ cwd: TEMP_DIR });
  const clean = stripAnsi(output);
  assertContains(clean, "files:3", "should show files modified count");
});

test("shows context even when idle", () => {
  resetState();
  const output = runStatusline({
    cwd: TEMP_DIR,
    context_window: { used_percentage: 25 },
  });
  const clean = stripAnsi(output);
  assertContains(clean, "idle", "should show idle");
  assertContains(clean, "ctx:", "should still show context when idle");
  assertContains(clean, "25%", "should show context percentage");
});

test("includes OMB version label", () => {
  resetState();
  const output = runStatusline({ cwd: TEMP_DIR });
  const clean = stripAnsi(output);
  assertContains(clean, "[OMB#", "should have version label");
  assertContains(clean, "]", "should close version label");
});

test("uses ANSI colors for mode display", () => {
  resetState();
  writeState({
    active: true, mode: "mr.beads", current_phase: "bootstrap",
    started_at: new Date().toISOString(),
  });
  const output = runStatusline({ cwd: TEMP_DIR });
  // Mr.Beads should use magenta
  assertContains(output, "\x1b[35m", "Mr.Beads should use magenta ANSI");

  writeState({
    active: true, mode: "mr.fast", current_phase: "fast_scout",
    started_at: new Date().toISOString(),
  });
  const output2 = runStatusline({ cwd: TEMP_DIR });
  // Mr.Fast should use cyan
  assertContains(output2, "\x1b[36m", "Mr.Fast should use cyan ANSI");
});

test("gate phases show as yellow", () => {
  resetState();
  writeState({
    active: true, mode: "mr.beads", current_phase: "gate_2_pending",
    started_at: new Date().toISOString(),
  });
  const output = runStatusline({ cwd: TEMP_DIR });
  const clean = stripAnsi(output);
  assertContains(clean, "Gate 2: Awaiting User", "should display gate phase");
  assertContains(output, "\x1b[33m", "gate should use yellow ANSI");
});

test("uses non-breaking spaces in raw output", () => {
  resetState();
  writeState({
    active: true, mode: "mr.beads", current_phase: "phase_6_execution",
    started_at: new Date().toISOString(),
  });
  // Run without stripping non-breaking spaces
  const scriptPath = join(SCRIPTS_DIR, "statusline.mjs");
  const result = execFileSync(process.execPath, [scriptPath], {
    input: JSON.stringify({ cwd: TEMP_DIR }),
    encoding: "utf8",
    timeout: 10_000,
    cwd: TEMP_DIR,
  }).trim();
  assertContains(result, "\u00A0", "should use non-breaking spaces for alignment");
});

// ---- SHARED HELPERS MODULE ----

console.log("\n=== helpers.mjs (Shared Helpers) ===\n");

// Import shared helpers for direct unit testing
const helpers = await import(join(SCRIPTS_DIR, "helpers.mjs"));

test("readJson returns parsed JSON for valid file", () => {
  const testFile = join(TEMP_DIR, "test-valid.json");
  writeFileSync(testFile, JSON.stringify({ hello: "world", count: 42 }));
  const result = helpers.readJson(testFile);
  assert(result !== null, "should return object");
  assert(result.hello === "world", `hello should be 'world', got ${result.hello}`);
  assert(result.count === 42, `count should be 42, got ${result.count}`);
});

test("readJson returns null for missing file", () => {
  const result = helpers.readJson(join(TEMP_DIR, "nonexistent-file.json"));
  assert(result === null, "should return null for missing file");
});

test("readJson returns null for invalid JSON", () => {
  const testFile = join(TEMP_DIR, "test-invalid.json");
  writeFileSync(testFile, "{ this is not valid json");
  const result = helpers.readJson(testFile);
  assert(result === null, "should return null for invalid JSON");
});

test("writeJsonAtomic writes valid JSON file", () => {
  const testFile = join(TEMP_DIR, "test-write.json");
  helpers.writeJsonAtomic(testFile, { key: "value", num: 99 });
  assert(existsSync(testFile), "file should exist after write");
  const content = JSON.parse(readFileSync(testFile, "utf8"));
  assert(content.key === "value", `key should be 'value', got ${content.key}`);
  assert(content.num === 99, `num should be 99, got ${content.num}`);
});

test("writeJsonAtomic creates parent directories", () => {
  const testFile = join(TEMP_DIR, "nested", "deep", "test-nested.json");
  helpers.writeJsonAtomic(testFile, { nested: true });
  assert(existsSync(testFile), "file should exist in nested dir");
  const content = JSON.parse(readFileSync(testFile, "utf8"));
  assert(content.nested === true, "nested should be true");
});

test("hookOutput produces correct JSON structure without systemMessage", () => {
  // Capture stdout by temporarily replacing process.stdout.write
  let captured = "";
  const origWrite = process.stdout.write;
  process.stdout.write = (data) => { captured += data; };
  helpers.hookOutput("TestEvent", "some context");
  process.stdout.write = origWrite;
  const parsed = JSON.parse(captured);
  assert(parsed.continue === true, "should have continue: true");
  assert(parsed.hookSpecificOutput.hookEventName === "TestEvent", "should have correct event name");
  assert(parsed.hookSpecificOutput.additionalContext === "some context", "should have additionalContext");
  assert(!parsed.systemMessage, "should not have systemMessage when not provided");
});

test("hookOutput produces correct JSON with systemMessage", () => {
  let captured = "";
  const origWrite = process.stdout.write;
  process.stdout.write = (data) => { captured += data; };
  helpers.hookOutput("PreCompact", "checkpoint saved", "System context for re-injection");
  process.stdout.write = origWrite;
  const parsed = JSON.parse(captured);
  assert(parsed.continue === true, "should have continue: true");
  assert(parsed.systemMessage === "System context for re-injection", "should have systemMessage");
  assert(parsed.hookSpecificOutput.hookEventName === "PreCompact", "should have correct event name");
  assert(parsed.hookSpecificOutput.additionalContext === "checkpoint saved", "should have additionalContext");
});

test("hookOutput omits additionalContext when null", () => {
  let captured = "";
  const origWrite = process.stdout.write;
  process.stdout.write = (data) => { captured += data; };
  helpers.hookOutput("SessionStart", null);
  process.stdout.write = origWrite;
  const parsed = JSON.parse(captured);
  assert(parsed.continue === true, "should have continue: true");
  assert(parsed.hookSpecificOutput.hookEventName === "SessionStart", "should have event name");
  assert(!parsed.hookSpecificOutput.additionalContext, "should not have additionalContext when null");
});

// ---- DEAD CODE REMOVAL: SYSTEM-LEVEL-ONLY WRITES ----

console.log("\n=== Dead Code Removal: System-Level-Only Writes ===\n");

test("keyword-detector writes session state to system-level only (not legacy)", () => {
  resetState();
  // Remove any pre-existing legacy state
  const legacySession = join(TEMP_DIR, ".oh-my-beads", "state", "session.json");
  rmSync(legacySession, { force: true });
  // Trigger keyword detection
  runScript("keyword-detector.mjs", { query: "omb build feature X" });
  // Verify system-level state exists
  const systemSession = join(STATE_DIR, "session.json");
  assert(existsSync(systemSession), "system-level session.json should exist after keyword detection");
  const sysData = JSON.parse(readFileSync(systemSession, "utf8"));
  assert(sysData.active === true, "system-level session should be active");
  assert(sysData.mode === "mr.beads", "mode should be mr.beads");
  // Verify legacy path was NOT written
  assert(!existsSync(legacySession), "legacy session.json should NOT exist (no dual-write)");
});

test("keyword-detector cancel writes signal to system-level only (not legacy)", () => {
  resetState();
  // Set up active session at system-level
  writeFileSync(
    join(STATE_DIR, "session.json"),
    JSON.stringify({ active: true, current_phase: "phase_2_planning", started_at: new Date().toISOString() })
  );
  // Remove any legacy cancel signal
  const legacySignal = join(TEMP_DIR, ".oh-my-beads", "state", "cancel-signal.json");
  rmSync(legacySignal, { force: true });
  // Trigger cancel
  runScript("keyword-detector.mjs", { query: "cancel omb" });
  // Verify system-level cancel signal exists
  const systemSignal = join(STATE_DIR, "cancel-signal.json");
  assert(existsSync(systemSignal), "system-level cancel-signal.json should exist");
  // Verify legacy cancel signal was NOT written
  assert(!existsSync(legacySignal), "legacy cancel-signal.json should NOT exist (no dual-write)");
});

test("state-bridge write command writes to system-level only (not legacy)", () => {
  resetState();
  // Remove any legacy state
  const legacySession = join(TEMP_DIR, ".oh-my-beads", "state", "session.json");
  rmSync(legacySession, { force: true });
  // Use state-bridge to write
  const result = runStateBridge(["write", "--phase", "phase_1_exploration", "--active", "true"]);
  assert(result?.success === true, "state-bridge write should succeed");
  // Verify system-level state exists
  const systemSession = join(STATE_DIR, "session.json");
  assert(existsSync(systemSession), "system-level session.json should exist after state-bridge write");
  const sysData = JSON.parse(readFileSync(systemSession, "utf8"));
  assert(sysData.current_phase === "phase_1_exploration", "phase should be phase_1_exploration");
  // Verify legacy path was NOT written
  assert(!existsSync(legacySession), "legacy session.json should NOT exist (no dual-write from state-bridge)");
});

// ---- DEAD CODE REMOVAL: LEGACY READ FALLBACK ----

console.log("\n=== Dead Code Removal: Legacy Read Fallback ===\n");

test("resolveStateDir returns legacyDir for legacy read fallback", () => {
  // resolveStateDir is already imported at top of file via resolve-state-dir.mjs exports
  // We test it by checking the resolvePath behavior in state-bridge (which uses same logic)
  // The resolveStateDir function returns { stateDir, sessionId, legacyDir, projectRoot }
  // We verify legacy read works by writing to legacy and reading via state-bridge
  resetState();
  // Write state ONLY to legacy path (no system-level)
  const legacyDir = join(TEMP_DIR, ".oh-my-beads", "state");
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(join(legacyDir, "session.json"), JSON.stringify({
    active: true, current_phase: "phase_2_planning",
    started_at: new Date().toISOString(), feature_slug: "legacy-read-test",
  }));
  // System-level should NOT have state
  assert(!existsSync(join(STATE_DIR, "session.json")), "system-level should be empty");
  // Read via state-bridge — should find legacy data via read fallback
  const result = runStateBridge(["read"]);
  assert(result?.success === true, "state-bridge read should succeed");
  assert(result?.data !== null, "should read data from legacy path");
  assert(result?.data?.feature_slug === "legacy-read-test", "should read correct legacy data");
  assert(result?.data?.current_phase === "phase_2_planning", "should read correct legacy phase");
});

test("state-bridge reads from legacy path when system-level is empty", () => {
  resetState();
  // Write state ONLY to legacy path (simulating old session)
  const legacySession = join(TEMP_DIR, ".oh-my-beads", "state", "session.json");
  mkdirSync(join(TEMP_DIR, ".oh-my-beads", "state"), { recursive: true });
  writeFileSync(legacySession, JSON.stringify({
    active: true, current_phase: "phase_6_execution",
    started_at: new Date().toISOString(), feature_slug: "legacy-feature",
  }));
  // Verify system-level does NOT have state
  assert(!existsSync(join(STATE_DIR, "session.json")), "system-level should be empty for this test");
  // Read via state-bridge — should find legacy data
  const result = runStateBridge(["read"]);
  assert(result?.success === true, "state-bridge read should succeed");
  assert(result?.data !== null, "should read data from legacy fallback");
  assert(result?.data?.feature_slug === "legacy-feature", "should read correct legacy data");
});

// ---- INACTIVE SESSION EARLY-RETURN: PRE-TOOL ENFORCER & POST-TOOL VERIFIER ----

console.log("\n=== Inactive Session Optimization ===\n");

test("pre-tool-enforcer early-returns for inactive session (no role checks)", () => {
  resetState();
  // No active session exists and no OMB_AGENT_ROLE set.
  // The enforcer should early-return with {continue:true} without even
  // reading role restrictions — the inactive session optimization.
  const { output } = runScript("pre-tool-enforcer.mjs", {
    tool_name: "Write",
    tool_input: { file_path: "/project/src/app.ts" },
    cwd: TEMP_DIR,
  });
  const parsed = parseOutput(output);
  assert(parsed?.continue === true, "should continue");
  // No additionalContext — pure pass-through
  assert(!parsed?.hookSpecificOutput?.additionalContext, "should have no additionalContext for inactive session");
});

test("post-tool-verifier early-returns for inactive session (no tracking)", () => {
  resetState();
  // No active session. The verifier should return {continue:true} without updating tool-tracking.json.
  rmSync(join(STATE_DIR, "tool-tracking.json"), { force: true });
  const { output } = runScript("post-tool-verifier.mjs", {
    cwd: TEMP_DIR, tool_name: "Write",
    tool_input: { file_path: "/tmp/test.ts" }, tool_output: "Written",
  });
  const parsed = parseOutput(output);
  assert(parsed?.continue === true, "should continue");
  // tool-tracking.json should NOT be created (no tracking for inactive sessions)
  assert(!existsSync(join(STATE_DIR, "tool-tracking.json")), "tool-tracking.json should not be created for inactive session");
});

// ---- CONSOLIDATED SUBAGENT-STOP ----

console.log("\n=== Consolidated SubagentStop (subagent-stop.mjs) ===\n");

test("consolidated SubagentStop updates tracking on stop", () => {
  resetState();
  // First, create a running agent entry in tracking
  writeFileSync(join(STATE_DIR, "subagent-tracking.json"), JSON.stringify({
    agents: [{ id: "worker-001", role: "worker", started_at: new Date().toISOString(), status: "running" }],
  }, null, 2));
  const { output } = runScript("subagent-stop.mjs", {
    cwd: TEMP_DIR, hook_event_name: "SubagentStop",
    agent_id: "worker-001", role: "worker", exit_code: 0,
  });
  const parsed = parseOutput(output);
  assert(parsed?.continue === true, "should continue");
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "Subagent", "should have subagent message");
  // Verify tracking was updated
  const tracking = JSON.parse(readFileSync(join(STATE_DIR, "subagent-tracking.json"), "utf8"));
  const agent = tracking.agents.find(a => a.id === "worker-001");
  assert(agent.status === "stopped", "agent status should be stopped");
  assert(agent.stopped_at, "should have stopped_at timestamp");
});

test("consolidated SubagentStop verifies scout deliverables", () => {
  resetState();
  // Scout without CONTEXT.md should trigger a warning
  const { output } = runScript("subagent-stop.mjs", {
    cwd: TEMP_DIR, hook_event_name: "SubagentStop",
    agent_id: "scout-001", role: "scout", exit_code: 0,
  });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "WARNINGS", "should warn about missing deliverables");
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "CONTEXT.md", "should mention CONTEXT.md");
});

test("consolidated SubagentStop passes for unknown role", () => {
  resetState();
  const { output } = runScript("subagent-stop.mjs", {
    cwd: TEMP_DIR, hook_event_name: "SubagentStop",
    agent_id: "custom-001", role: "custom-agent", exit_code: 0,
  });
  const parsed = parseOutput(output);
  assert(parsed?.continue === true, "should continue");
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "completed", "should report completion for unknown role");
  assertNotContains(parsed?.hookSpecificOutput?.additionalContext || "", "WARNINGS", "should not warn for unknown role");
});

// ---- OMB_QUIET LEVELS ----

console.log("\n=== OMB_QUIET Levels ===\n");

test("OMB_QUIET=0 (default) includes informational output in post-tool-verifier", () => {
  writeState({ active: true, current_phase: "phase_6_execution", started_at: new Date().toISOString() });
  const bigOutput = "x".repeat(15000);
  const { output } = runScript("post-tool-verifier.mjs", {
    cwd: TEMP_DIR, tool_name: "Bash", tool_output: bigOutput,
  }, { OMB_QUIET: "0" });
  const parsed = parseOutput(output);
  // At quiet=0, clipping message should be present
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "clipped", "should show clipping info at quiet=0");
});

test("OMB_QUIET=1 suppresses informational output in post-tool-verifier", () => {
  writeState({ active: true, current_phase: "phase_6_execution", started_at: new Date().toISOString() });
  const bigOutput = "x".repeat(15000);
  const { output } = runScript("post-tool-verifier.mjs", {
    cwd: TEMP_DIR, tool_name: "Bash", tool_output: bigOutput,
  }, { OMB_QUIET: "1" });
  const parsed = parseOutput(output);
  // At quiet=1, informational clipping message should be suppressed
  assert(!parsed?.hookSpecificOutput?.additionalContext, "should suppress clipping info at quiet=1");
});

test("OMB_QUIET=2 suppresses warning output in pre-tool-enforcer", () => {
  writeState({ active: true, current_phase: "phase_6_execution", started_at: new Date().toISOString() });
  // git push --force normally produces a WARNING
  const { output } = runScript("pre-tool-enforcer.mjs", {
    tool_name: "Bash", tool_input: { command: "git push --force origin main" },
    cwd: TEMP_DIR,
  }, { OMB_QUIET: "2" });
  const parsed = parseOutput(output);
  // At quiet=2, warnings should be suppressed
  assert(!parsed?.hookSpecificOutput?.additionalContext, "should suppress warning at quiet=2");
});

test("OMB_QUIET=2 still emits blocks in pre-tool-enforcer (critical)", () => {
  writeState({ active: true, current_phase: "phase_6_execution", started_at: new Date().toISOString() });
  // rm -rf / should ALWAYS be blocked regardless of quiet level
  const { output } = runScript("pre-tool-enforcer.mjs", {
    tool_name: "Bash", tool_input: { command: "rm -rf / " },
    cwd: TEMP_DIR,
  }, { OMB_QUIET: "2" });
  const parsed = parseOutput(output);
  // Blocks are critical — never suppressed
  assert(parsed?.decision === "block", "should still block dangerous commands at quiet=2");
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "BLOCKED", "should still show BLOCKED at quiet=2");
});

// ---- MR.FAST INTENT CLASSIFICATION ----

console.log("\n=== keyword-detector.mjs (Mr.Fast Intent Classification) ===\n");

test("turbo intent for explicit file+line prompt", () => {
  resetState();
  const { output } = runScript("keyword-detector.mjs", { query: "mr.fast fix typo on line 42 of auth.ts" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "MAGIC KEYWORD: mr-fast", "should trigger mr-fast");
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "Intent: turbo", "should classify as turbo");
  const state = readState();
  assert(state.intent === "turbo", `intent should be turbo, got ${state.intent}`);
});

test("turbo intent for file:linenum pattern", () => {
  resetState();
  const { output } = runScript("keyword-detector.mjs", { query: "mr.fast fix src/auth.ts:42" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "Intent: turbo", "should classify file:linenum as turbo");
  const state = readState();
  assert(state.intent === "turbo", `intent should be turbo, got ${state.intent}`);
});

test("turbo intent for fix X in file.ext pattern", () => {
  resetState();
  const { output } = runScript("keyword-detector.mjs", { query: "mr.fast fix the import in utils.mjs" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "Intent: turbo", "should classify fix-in-file as turbo");
});

test("standard intent for moderate fix without file+line", () => {
  resetState();
  const { output } = runScript("keyword-detector.mjs", { query: "mr.fast fix the login validation bug" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "MAGIC KEYWORD: mr-fast", "should trigger mr-fast");
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "Intent: standard", "should classify as standard");
  const state = readState();
  assert(state.intent === "standard", `intent should be standard, got ${state.intent}`);
});

test("standard intent for ambiguous prompt (defaults to standard)", () => {
  resetState();
  const { output } = runScript("keyword-detector.mjs", { query: "mr.fast make it better" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "Intent: standard", "ambiguous should default to standard");
  const state = readState();
  assert(state.intent === "standard", `intent should be standard, got ${state.intent}`);
});

test("complex intent for 'refactor entire' keyword", () => {
  resetState();
  const { output } = runScript("keyword-detector.mjs", { query: "mr.fast refactor entire auth module" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "MAGIC KEYWORD: mr-fast", "should trigger mr-fast");
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "too complex for Mr.Fast", "should suggest Mr.Beads");
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "omb", "should suggest omb command");
});

test("complex intent for 'redesign' keyword", () => {
  resetState();
  const { output } = runScript("keyword-detector.mjs", { query: "mr.fast redesign the database layer" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "too complex for Mr.Fast", "redesign should be complex");
});

test("complex intent for 'new system' keyword", () => {
  resetState();
  const { output } = runScript("keyword-detector.mjs", { query: "mrfast build a new system for notifications" });
  const parsed = parseOutput(output);
  assertContains(parsed?.hookSpecificOutput?.additionalContext || "", "too complex for Mr.Fast", "new system should be complex");
});

test("complex intent does NOT set active=true", () => {
  resetState();
  runScript("keyword-detector.mjs", { query: "mr.fast refactor entire auth module" });
  const state = readState();
  assert(state, "session.json should exist");
  assert(state.active === false, `active should be false for complex intent, got ${state.active}`);
  assert(state.intent === "complex", `intent should be complex, got ${state.intent}`);
  assert(state.mode === "mr.fast", `mode should be mr.fast, got ${state.mode}`);
});

// ---- MR.FAST TURBO SESSION STATE ----

console.log("\n=== keyword-detector.mjs (Mr.Fast Turbo Session State) ===\n");

test("turbo sets current_phase to fast_turbo", () => {
  resetState();
  runScript("keyword-detector.mjs", { query: "mr.fast fix typo on line 10 of app.ts" });
  const state = readState();
  assert(state, "session.json should exist");
  assert(state.current_phase === "fast_turbo", `phase should be fast_turbo, got ${state.current_phase}`);
  assert(state.mode === "mr.fast", `mode should be mr.fast, got ${state.mode}`);
  assert(state.intent === "turbo", `intent should be turbo, got ${state.intent}`);
  assert(state.active === true, `active should be true for turbo, got ${state.active}`);
});

test("standard sets current_phase to fast_scout", () => {
  resetState();
  runScript("keyword-detector.mjs", { query: "mr.fast fix the routing issue" });
  const state = readState();
  assert(state, "session.json should exist");
  assert(state.current_phase === "fast_scout", `phase should be fast_scout, got ${state.current_phase}`);
  assert(state.mode === "mr.fast", `mode should be mr.fast, got ${state.mode}`);
  assert(state.intent === "standard", `intent should be standard, got ${state.intent}`);
  assert(state.active === true, `active should be true for standard, got ${state.active}`);
});

test("turbo session state has awaiting_confirmation", () => {
  resetState();
  runScript("keyword-detector.mjs", { query: "mr.fast remove unused import in server.ts" });
  const state = readState();
  assert(state.awaiting_confirmation === true, "turbo should have awaiting_confirmation");
  assert(state.reinforcement_count === 0, "should start with 0 reinforcements");
});

// ---- PROMPT-LEVERAGE LIGHT INTENSITY CAP ----

console.log("\n=== prompt-leverage.mjs (Light Intensity Cap for Mr.Fast) ===\n");

test("mr.fast caps Standard coding intensity to Light", () => {
  // "fix the login bug" → coding task → normally Standard → Mr.Fast caps to Light
  const { intensity, task } = upgradePrompt("fix the login bug", { mode: "mr.fast" });
  assert(task === "coding", `task should be coding, got ${task}`);
  assert(intensity === "Light", `mr.fast coding should cap at Light, got ${intensity}`);
});

test("mr.fast Light produces shorter output than Standard", () => {
  const prompt = "fix the login bug in auth.ts";
  const { augmented: lightOutput } = upgradePrompt(prompt, { mode: "mr.fast" });
  const { augmented: standardOutput } = upgradePrompt(prompt, { mode: "mr.beads" });
  // Mr.Fast (Light) should produce shorter output than Mr.Beads (Standard)
  assert(
    lightOutput.length < standardOutput.length,
    `Light output (${lightOutput.length} chars) should be shorter than Standard output (${standardOutput.length} chars)`
  );
});

test("mr.fast Light omits first-principles reasoning block", () => {
  const { augmented } = upgradePrompt("fix the login bug", { mode: "mr.fast" });
  assertNotContains(augmented, "Understand the problem broadly first", "Light should omit deep-reasoning block");
});

test("mr.beads Standard includes first-principles reasoning block", () => {
  const { augmented } = upgradePrompt("fix the login bug", { mode: "mr.beads" });
  assertContains(augmented, "Understand the problem broadly first", "Standard should include deep-reasoning block");
});

// ---- SESSION START: MR.FAST RESUME ----

console.log("\n=== session-start.mjs (Mr.Fast Resume) ===\n");

test("session-start detects interrupted mr.fast session and offers resume", () => {
  resetState();
  writeState({ active: true, current_phase: "fast_execution", mode: "mr.fast", started_at: new Date().toISOString(), failure_count: 1, feature_slug: "login-fix" });
  const { output } = runScript("session-start.mjs", { cwd: TEMP_DIR, source: "startup" });
  const parsed = parseOutput(output);
  const ctx = parsed?.hookSpecificOutput?.additionalContext || "";
  assertContains(ctx, "ACTIVE Mr.Fast SESSION", "should detect active Mr.Fast session");
  assertContains(ctx, "fast_execution", "should show current phase");
  assertContains(ctx, "Resume", "should offer resume option");
  assertContains(ctx, "Cancel", "should offer cancel option");
});

test("session-start mr.fast resume shows failure count", () => {
  resetState();
  writeState({ active: true, current_phase: "fast_scout", mode: "mr.fast", started_at: new Date().toISOString(), failure_count: 2 });
  const { output } = runScript("session-start.mjs", { cwd: TEMP_DIR, source: "startup" });
  const parsed = parseOutput(output);
  const ctx = parsed?.hookSpecificOutput?.additionalContext || "";
  assertContains(ctx, "Retries: 2", "should show failure count");
});

test("session-start mr.fast resume shows feature slug", () => {
  resetState();
  writeState({ active: true, current_phase: "fast_turbo", mode: "mr.fast", started_at: new Date().toISOString(), failure_count: 0, feature_slug: "auth-bug" });
  const { output } = runScript("session-start.mjs", { cwd: TEMP_DIR, source: "startup" });
  const parsed = parseOutput(output);
  const ctx = parsed?.hookSpecificOutput?.additionalContext || "";
  assertContains(ctx, "Task: auth-bug", "should show feature slug");
  assertContains(ctx, "fast_turbo", "should show turbo phase in resume");
});

// ============================================================
// SUMMARY
// ============================================================

console.log(`\n${"=".repeat(50)}`);
console.log(`  TOTAL: ${total}  |  PASSED: ${passed}  |  FAILED: ${failed}`);
console.log(`${"=".repeat(50)}\n`);

teardown();
process.exit(failed > 0 ? 1 : 0);
