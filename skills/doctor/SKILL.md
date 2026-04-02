---
name: doctor
description: >-
  Full diagnostic suite for Oh-My-Beads — install verification, session health,
  beads_village connectivity, file locks, subagent tracking, and guided self-repair.
level: 4
---

<Purpose>
Diagnose and repair Oh-My-Beads workspace issues. Three diagnostic sections:
1. **Install Diagnostics** — verify hooks, MCP, directory structure, config, scripts, setup state
2. **Session Diagnostics** — check runtime state, locks, subagents, artifacts
3. **Auto-Repair** — offer to invoke `/oh-my-beads:setup` for fixable issues
</Purpose>

<Use_When>
- Something seems stuck or broken
- User wants to check workspace health
- Before resuming a potentially stale session
- After initial setup to verify installation
- After plugin update to verify integrity
</Use_When>

<Steps>

## Section A: Install Diagnostics

### Step A0: Check Setup Completion State

Read `~/.oh-my-beads/setup.json` (or `$OMB_HOME/setup.json`):
- If file exists and `setupCompleted` is set:
  - Read plugin version from `.claude-plugin/plugin.json`
  - If `setupVersion` matches: PASS — "Setup complete (v{version}, configured {date})"
  - If `setupVersion` is older: WARN — "Setup outdated (v{old} → v{new}). Run 'setup omb' to update."
- If file does not exist: WARN — "Setup not completed. Run 'setup omb' for guided installation."

### Step A1: Check Node.js Version

```bash
node --version
```

- If >= 18: PASS
- If < 18: ERROR — "Node.js {version} detected, requires >= 18"

### Step A2: Check Hooks Registration

Read `.claude/settings.json` (project-level):
- Verify oh-my-beads hooks are registered for all expected events:
  - `UserPromptSubmit` → keyword-detector.mjs
  - `SessionStart` → session-start.mjs
  - `PreToolUse` → pre-tool-enforcer.mjs
  - `PostToolUse` → post-tool-verifier.mjs
  - `PostToolUseFailure` → post-tool-use-failure.mjs
  - `Stop` → persistent-mode.cjs, context-guard-stop.mjs
  - `PreCompact` → pre-compact.mjs
  - `SubagentStart` → subagent-tracker.mjs
  - `SubagentStop` → subagent-tracker.mjs, verify-deliverables.mjs
  - `SessionEnd` → session-end.mjs
- Also check `hooks/hooks.json` for consistency with settings.json
- Count: X/10 events wired

**Self-repair:** If hooks are missing:
```
Hooks missing (X/10 wired). Run 'setup omb' to auto-register all hooks.
```

### Step A3: Check beads_village MCP Reachable

```
mcp__beads-village__status()
```

- If succeeds: PASS — "MCP server responding"
- If fails: ERROR — report the error message

**Self-repair:** If unreachable:
```
1. Check .mcp.json for beads-village entry
2. Run 'setup omb' to configure .mcp.json
3. Restart Claude Code to reload MCP connections
```

### Step A4: Check .mcp.json Configuration

Read `.mcp.json` (project root):
- If file exists and has `beads-village` in `mcpServers`: PASS
- If file exists but no beads-village: WARN — "beads-village not configured in .mcp.json"
- If file missing: WARN — ".mcp.json not found"

**Self-repair:** Run 'setup omb' to create/update .mcp.json.

### Step A5: Check System-Level Runtime Directories

Verify `~/.oh-my-beads/` (or `$OMB_HOME`) exists:
- `~/.oh-my-beads/projects/` — project state root

Note: Per-project directories under `projects/{hash}/` are auto-created by SessionStart.
No manual creation needed.

- If exists: PASS
- If missing: WARN — "Runtime directory missing. Will be auto-created on next session start."

### Step A6: Check Project-Level Artifact Directories

Verify these directories exist under project root:
- `{cwd}/.oh-my-beads/plans/` — plan storage (committed)
- `{cwd}/.oh-my-beads/history/` — execution history (committed)

Note: Runtime state is at system-level (`~/.oh-my-beads/projects/{hash}/`), NOT
at `{cwd}/.oh-my-beads/state/`. The `state/` directory is legacy.

- If all exist: PASS
- If missing: WARN — "Artifact directories missing. Run 'setup omb' or they will be auto-created."

### Step A7: Check CLAUDE.md Has OMB Section

Read the project `CLAUDE.md`:
- Look for `<!-- OMB:START -->` marker (managed section)
- Or search for "Oh-My-Beads" or "oh-my-beads" section header
- Check it references correct mode names ("Mr.Beads", "Mr.Fast")

- If markers found: PASS — "Managed OMB section present"
- If content but no markers: WARN — "OMB content found without merge markers. Run 'setup omb' to add markers."
- If missing: WARN — "No OMB section in CLAUDE.md"

**Self-repair:** Run 'setup omb' to add/update the OMB section with idempotent markers.

### Step A8: Check Scripts Syntax

Run `node --check` on all hook scripts to verify no syntax errors:
```bash
node --check scripts/keyword-detector.mjs
node --check scripts/persistent-mode.cjs
node --check scripts/post-tool-verifier.mjs
node --check scripts/pre-tool-enforcer.mjs
node --check scripts/pre-compact.mjs
node --check scripts/session-start.mjs
node --check scripts/context-guard-stop.mjs
node --check scripts/post-tool-use-failure.mjs
node --check scripts/session-end.mjs
node --check scripts/prompt-leverage.mjs
node --check scripts/state-tools/state-bridge.cjs
```

- Report PASS for each, or the specific syntax error

### Step A9: Check Plugin/Marketplace Version Match

Read `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`:
- Both should exist
- `plugin.json.version` must equal `marketplace.json.version`
- `marketplace.json.plugins[0].version` must also match
- Report the current version

**Self-repair:** If versions mismatch:
```
Version mismatch: plugin.json={a}, marketplace.json={b}. Update both to match.
```

---

## Section B: Session Diagnostics

### Step B1: Check Session State

Read session state from system-level path:
```
~/.oh-my-beads/projects/{hash}/session.json
```
where `{hash}` is SHA-256(project cwd) first 8 hex chars.

Also check legacy fallback at `{cwd}/.oh-my-beads/state/session.json`.

- Does it exist? Is it valid JSON?
- Is `active` true but `started_at` older than 2 hours? (stale)
- Is `reinforcement_count` approaching 50? (circuit breaker risk)
- Is `current_phase` valid for the mode?
  - Mr.Beads phases: bootstrap, phase_1_exploration, phase_2_planning, phase_3_persistence, phase_4_decomposition, phase_5_validation, phase_6_execution, phase_7_review, phase_8_summary, complete, cancelled, failed
  - Mr.Fast phases: fast_bootstrap, fast_scout, fast_execution, fast_review, fast_complete, failed, cancelled

Report findings.

**Self-repair:** If stale session detected:
```
Session stale (>2 hours). Run 'cancel omb' to deactivate, or start fresh.
```

### Step B2: Check beads_village Health

```
mcp__beads-village__doctor()
```

Report any issues found.

### Step B3: Check File Locks

```
mcp__beads-village__reservations()
```

Look for:
- Stale reservations (no active Worker)
- Conflicting locks on the same file

### Step B4: Check Subagent Tracking

Read subagent tracking from system-level path:
```
~/.oh-my-beads/projects/{hash}/subagent-tracking.json
```

Also check legacy at `{cwd}/.oh-my-beads/state/subagent-tracking.json`.

- Are there agents stuck in "running" state?
- Do stopped agents have verified deliverables?

### Step B5: Check Tool Error State

Read from system-level path:
```
~/.oh-my-beads/projects/{hash}/last-tool-error.json
```

- If `escalated` is true: WARN — "Tool failure escalated (retry_count={N})"
- If `retry_count` > 3: WARN — "High retry count for {tool_name}"

---

## Step Final: Report & Recommend

Present a structured health report:

```
## Oh-My-Beads Health Report

### Install Diagnostics
| # | Check | Status | Details |
|---|-------|--------|---------|
| A0 | Setup state | OK/WARN | <details> |
| A1 | Node.js | OK/ERROR | <details> |
| A2 | Hooks registered | OK/WARN | X/10 events |
| A3 | beads_village MCP | OK/ERROR | <details> |
| A4 | .mcp.json | OK/WARN | <details> |
| A5 | Runtime dirs | OK/WARN | <details> |
| A6 | Artifact dirs | OK/WARN | <details> |
| A7 | CLAUDE.md OMB section | OK/WARN | <details> |
| A8 | Scripts syntax | OK/ERROR | <details> |
| A9 | Version consistency | OK/WARN | v{version} |

### Session Diagnostics
| # | Check | Status | Details |
|---|-------|--------|---------|
| B1 | Session state | OK/WARN | <details> |
| B2 | beads_village health | OK/WARN | <details> |
| B3 | File locks | OK/WARN | <details> |
| B4 | Subagent tracking | OK/WARN | <details> |
| B5 | Tool error state | OK/WARN | <details> |

### Recommendations
1. <action to fix issues>
2. ...
```

**Auto-repair offer:** If 2+ install checks are WARN/ERROR:
```
Multiple install issues detected. Would you like to run 'setup omb' to auto-repair?
1. Yes — run setup wizard (Recommended)
2. No — I'll fix manually
```

If critical session issues found, recommend `cancel omb` as last resort for session issues.

</Steps>

<Tool_Usage>
- Read: Check state files, CLAUDE.md, plugin.json, marketplace.json, settings.json, .mcp.json, setup.json
- Glob: Verify directory structure, find scripts
- Bash: Run `node --check` on scripts, `node --version`
- mcp__beads-village__status: Test MCP connectivity
- mcp__beads-village__doctor: beads_village health check
- mcp__beads-village__reservations: Check file locks
- AskUserQuestion: Offer auto-repair via setup wizard
</Tool_Usage>
