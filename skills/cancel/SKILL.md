---
name: cancel
description: >-
  Cancel the active Oh-My-Beads session. Clears session state, stops the
  persistent-mode stop hook from blocking, cleans up subagent tracking,
  and optionally clears beads_village state.
level: 4
---

<Purpose>
Cancel any active Oh-My-Beads workflow session (Mr.Beads or Mr.Fast). This is the safe
shutdown mechanism that clears session.json (stopping persistent-mode from blocking),
removes tracking state, and reports what was cleaned up.
</Purpose>

<Use_When>
- User says "cancel omb", "stop omb", "cancel mrfast", "cancel mr.beads", or "/oh-my-beads:cancel"
- Workflow is stuck or user wants to abort
- Session needs cleanup after an error
</Use_When>

<Steps>

## Step 1: Detect Active Session

Read `.oh-my-beads/state/session.json` to check for active session:

```
Read: .oh-my-beads/state/session.json
```

If no active session exists, report: "No active Oh-My-Beads session found." and stop.

## Step 2: Record Cancellation

Update session.json:
```json
{
  "active": false,
  "current_phase": "cancelled",
  "cancelled_at": "<ISO timestamp>",
  "cancel_reason": "user_requested"
}
```

Write this via Edit tool to `.oh-my-beads/state/session.json`.

## Step 3: Clean Up Tracking State

Remove or reset these files if they exist:
- `.oh-my-beads/state/tool-tracking.json` — delete
- `.oh-my-beads/state/subagent-tracking.json` — mark all agents as cancelled

## Step 4: Release beads_village Locks

If beads_village is available:
```
mcp__beads-village__release()
```

This releases any file locks held by the current session.

## Step 5: Report

Present a summary to the user:
```
Oh-My-Beads session cancelled.
- Mode: <mr.beads|mr.fast>
- Phase at cancellation: <phase>
- Feature: <slug>
- Beads open: <count from ls(status="open") if available>
- Files were released

To resume, say "omb" (Mr.Beads) or "mr.fast" (Mr.Fast) to start a new session.
To clean up beads_village issues: mcp__beads-village__cleanup()
```

</Steps>

<Force_Mode>
If the user says "cancel omb --force" or "force cancel omb":

1. Delete `.oh-my-beads/state/session.json` entirely
2. Delete `.oh-my-beads/state/tool-tracking.json`
3. Delete `.oh-my-beads/state/subagent-tracking.json`
4. Call `mcp__beads-village__release()` if available
5. Call `mcp__beads-village__cleanup()` if available
6. Report: "All Oh-My-Beads state force-cleared."
</Force_Mode>

<Tool_Usage>
- Read: Check session state
- Edit/Write: Update session.json
- Bash: rm state files in force mode
- mcp__beads-village__release: Release file locks
- mcp__beads-village__ls: Check open beads count
- mcp__beads-village__cleanup: Optional cleanup in force mode
</Tool_Usage>

<Final_Checklist>
- [ ] session.json set to active: false (or deleted in force mode)
- [ ] Tracking files cleaned up
- [ ] File locks released
- [ ] Summary reported to user
</Final_Checklist>
