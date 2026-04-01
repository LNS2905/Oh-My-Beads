---
name: doctor
description: >-
  Full diagnostic suite for Oh-My-Beads — install verification, session health,
  beads_village connectivity, file locks, subagent tracking, and guided self-repair.
level: 4
---

<Purpose>
Diagnose and repair Oh-My-Beads workspace issues. Two diagnostic sections:
1. **Install Diagnostics** — verify hooks, MCP, directory structure, config, scripts
2. **Session Diagnostics** — check runtime state, locks, subagents, artifacts
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

### Step A1: Check Hooks Registration

Read the Claude Code settings.json (typically `~/.claude/settings.json` or project `.claude/settings.json`):
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

**Self-repair:** If hooks are missing, suggest:
```
Copy hooks from hooks/hooks.json into your settings.json, or run:
/oh-my-beads:setup to auto-register hooks.
```

### Step A2: Check beads_village MCP Reachable

```
mcp__beads-village__init(team="oh-my-beads-doctor-check")
```

- If succeeds: MCP is reachable, report OK
- If fails: Report the error message

**Self-repair:** If unreachable, suggest:
```
1. Verify beads_village MCP server is running
2. Check .mcp.json or MCP config for correct server path
3. Restart Claude Code to reload MCP connections
```

### Step A3: Check Directory Structure

Verify these directories exist under project root:
- `.oh-my-beads/` — runtime root
- `.oh-my-beads/state/` — session state
- `.oh-my-beads/plans/` — plan storage
- `.oh-my-beads/handoffs/` — handoff documents
- `.oh-my-beads/history/` — execution history

Also verify plugin directories:
- `scripts/` — hook scripts
- `agents/` — agent definitions
- `skills/` — skill definitions
- `hooks/` — hook configuration

**Self-repair:** If directories missing, suggest:
```
mkdir -p .oh-my-beads/state .oh-my-beads/plans .oh-my-beads/handoffs .oh-my-beads/history
```

### Step A4: Check CLAUDE.md Has OMB Section

Read the project `CLAUDE.md`:
- Search for "Oh-My-Beads" or "oh-my-beads" section header
- Verify it contains at least: project overview, architecture section, hook events table
- Check it references the correct mode names ("Mr.Beads", "Mr.Fast")

**Self-repair:** If missing or incomplete, suggest:
```
The project CLAUDE.md is missing Oh-My-Beads documentation.
Run /oh-my-beads:setup to regenerate it, or manually add the OMB section
from the plugin's template.
```

### Step A5: Check Scripts Syntax

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

**Self-repair:** If syntax errors found, suggest:
```
Script <name> has a syntax error at line <N>: <error>
Fix the syntax error or restore from the plugin source:
  git checkout -- scripts/<name>
```

### Step A6: Check Plugin/Marketplace Version Match

Read `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`:
- Both should exist
- `plugin.json.version` must equal `marketplace.json.version`
- `marketplace.json.plugins[0].version` must also match
- Report the current version

**Self-repair:** If versions mismatch, suggest:
```
Version mismatch detected:
  plugin.json: <version_a>
  marketplace.json: <version_b>
Update both files to the same version, or run /oh-my-beads:setup.
```

---

## Section B: Session Diagnostics

### Step B1: Check Session State

Read `.oh-my-beads/state/session.json`:
- Does it exist? Is it valid JSON?
- Is `active` true but `started_at` older than 2 hours? (stale)
- Is `reinforcement_count` approaching 50? (circuit breaker risk)
- Is `current_phase` valid for the mode?
  - Mr.Beads phases: bootstrap, phase_1_scout, phase_2_planning, phase_3_persistence, phase_4_decomposition, phase_5_validation, phase_6_execution, phase_7_review, phase_8_summary
  - Mr.Fast phases: fast_scout, fast_execution, fast_review, fast_complete, failed

Report findings.

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

Read `.oh-my-beads/state/subagent-tracking.json`:
- Are there agents stuck in "running" state?
- Do stopped agents have verified deliverables?

### Step B5: Check Artifacts

Verify expected directories exist and are writable:
- `.oh-my-beads/state/`
- `.oh-my-beads/plans/`
- `.oh-my-beads/handoffs/`
- `.oh-my-beads/history/`

---

## Step Final: Report & Recommend

Present a structured health report:

```
## Oh-My-Beads Health Report

### Install Diagnostics
| Check | Status | Details |
|-------|--------|---------|
| Hooks registered | OK/WARN/ERROR | <details> |
| beads_village MCP | OK/WARN/ERROR | <details> |
| Directory structure | OK/WARN/ERROR | <details> |
| CLAUDE.md OMB section | OK/WARN/ERROR | <details> |
| Scripts syntax | OK/WARN/ERROR | <details> |
| Version consistency | OK/WARN/ERROR | <details> |

### Session Diagnostics
| Check | Status | Details |
|-------|--------|---------|
| Session State | OK/WARN/ERROR | <details> |
| beads_village | OK/WARN/ERROR | <details> |
| File Locks | OK/WARN/ERROR | <details> |
| Subagent Tracking | OK/WARN/ERROR | <details> |
| Artifacts | OK/WARN/ERROR | <details> |

### Recommendations
1. <action to fix issues>
2. ...
```

If critical issues found, recommend `/oh-my-beads:cancel --force` as last resort for session issues,
or `/oh-my-beads:setup` for install issues.

</Steps>

<Tool_Usage>
- Read: Check state files, CLAUDE.md, plugin.json, marketplace.json, settings.json
- Glob: Verify directory structure, find scripts
- Bash: Run `node --check` on scripts for syntax verification
- mcp__beads-village__init: Test MCP connectivity
- mcp__beads-village__doctor: beads_village health check
- mcp__beads-village__reservations: Check file locks
- mcp__beads-village__ls: Check open/stale beads
</Tool_Usage>
