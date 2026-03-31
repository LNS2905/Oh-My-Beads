---
name: doctor
description: >-
  Diagnose Oh-My-Beads session health — checks for corrupt state, stale locks,
  orphaned beads, and provides guided remediation.
level: 4
---

<Purpose>
Diagnose and repair Oh-My-Beads workspace issues. Checks session state integrity,
beads_village health, file lock staleness, and subagent tracking consistency.
</Purpose>

<Use_When>
- Something seems stuck or broken
- User wants to check workspace health
- Before resuming a potentially stale session
</Use_When>

<Steps>

## Step 1: Check Session State

Read `.oh-my-beads/state/session.json`:
- Does it exist? Is it valid JSON?
- Is `active` true but `started_at` older than 2 hours? (stale)
- Is `reinforcement_count` approaching 50? (circuit breaker risk)
- Is `current_phase` valid?

Report findings.

## Step 2: Check beads_village Health

```
mcp__beads-village__doctor()
```

Report any issues found.

## Step 3: Check File Locks

```
mcp__beads-village__reservations()
```

Look for:
- Stale reservations (no active Worker)
- Conflicting locks on the same file

## Step 4: Check Subagent Tracking

Read `.oh-my-beads/state/subagent-tracking.json`:
- Are there agents stuck in "running" state?
- Do stopped agents have verified deliverables?

## Step 5: Check Artifacts

Verify expected directories exist and are writable:
- `.oh-my-beads/state/`
- `.oh-my-beads/plans/`
- `.oh-my-beads/handoffs/`
- `.oh-my-beads/history/`

## Step 6: Report & Recommend

Present a structured health report:

```
## Oh-My-Beads Health Report

### Session State: OK | WARN | ERROR
<details>

### beads_village: OK | WARN | ERROR
<details>

### File Locks: OK | WARN | ERROR
<details>

### Subagent Tracking: OK | WARN | ERROR
<details>

### Recommendations
1. <action to fix issues>
2. ...
```

If critical issues found, recommend `/oh-my-beads:cancel --force` as last resort.

</Steps>

<Tool_Usage>
- Read: Check state files
- Glob: Verify directory structure
- mcp__beads-village__doctor: beads_village health check
- mcp__beads-village__reservations: Check file locks
- mcp__beads-village__ls: Check open/stale beads
</Tool_Usage>
