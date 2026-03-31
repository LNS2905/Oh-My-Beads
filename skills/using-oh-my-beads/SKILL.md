---
name: using-oh-my-beads
description: >-
  Bootstrap and entry point for the Oh-My-Beads plugin. Initializes the Master
  Orchestrator, handles session resume, validates prerequisites (beads_village MCP),
  and routes to the 8-step workflow. Invoke this skill to start any Oh-My-Beads session.
level: 4
---

<Purpose>
Oh-My-Beads is a multi-agent orchestration plugin for Claude Code. It uses beads_village
as the single source of truth for task tracking, dependency management, and concurrency safety.
This bootstrap skill validates prerequisites, checks for active sessions, and hands off to the
Master Orchestrator for the strict 8-step workflow.
</Purpose>

<Use_When>
- User says "oh-my-beads", "omb", "mr.beads", "mrbeads", or invokes `/oh-my-beads:using-oh-my-beads`
- User wants to start the full Mr.Beads workflow (8-step, multi-agent orchestration)
- User wants to resume a previous Mr.Beads session
- User has a non-trivial feature request that benefits from structured decomposition
</Use_When>

<Do_Not_Use_When>
- User wants a quick single-file fix (use Mr.Fast mode: keyword "mr.fast")
- User is asking a question or exploring options (respond conversationally)
- beads_village MCP server is not installed
</Do_Not_Use_When>

<Why_This_Exists>
Complex features require coordinated phases: requirements gathering, planning, decomposition,
parallel implementation, per-task review, and compounding learnings. Oh-My-Beads orchestrates
all phases through specialized agents (Scout, Architect, Worker, Reviewer) under a Master
Orchestrator, with beads_village providing concurrency-safe task tracking.
</Why_This_Exists>

<Execution_Policy>
- All 3 HITL gates are mandatory and blocking
- The 8-step sequence is strict: no skipping, no reordering
- beads_village is the ONLY source of truth for task state
- All work on the primary directory (no git worktrees)
- Sub-agents get isolated context (only what they need)
</Execution_Policy>

<Steps>
1. **Pre-Flight: Validate beads_village**
   ```
   Call: mcp__beads-village__status()
   ```
   If fails: STOP. Tell user to install beads_village MCP server.

2. **Check for Active Session**
   Read `.oh-my-beads/state/session.json`:
   - If `active: true`: Ask user — Resume, Restart, or Cancel?
   - If no active session or `active: false`: proceed to new session.

3. **Create Runtime Directories** (if missing)
   ```
   .oh-my-beads/state/
   .oh-my-beads/plans/
   .oh-my-beads/handoffs/
   .oh-my-beads/history/
   ```

4. **Initialize Session State**
   Write `state/session.json`:
   ```json
   {
     "active": true,
     "current_phase": "phase_1_exploration",
     "feature_slug": "<slug-from-request>",
     "team_name": "oh-my-beads",
     "execution_mode": null,
     "beads_created": 0,
     "beads_closed": 0,
     "started_at": "<ISO-8601>",
     "phase_history": ["bootstrap:<ISO-8601>"]
   }
   ```

5. **Init beads_village**
   ```
   mcp__beads-village__init(team="oh-my-beads", leader=true)
   ```

6. **Hand Off to Master**
   Load the `oh-my-beads:master` skill to begin the 8-step workflow.
   Pass the user's original request and the feature slug.
</Steps>

<Tool_Usage>
- `mcp__beads-village__status()` — validate MCP availability
- `mcp__beads-village__init()` — initialize the team workspace
- `mcp__beads-village__doctor()` — if init fails, diagnose and retry
- `Read` / `Write` — session state files only
- `Skill` — load oh-my-beads:master for handoff
- `AskUserQuestion` — session resume decisions
</Tool_Usage>

<Examples>
<Good>
User: "omb: add user authentication with JWT"
Why good: Clear feature request. Bootstrap validates MCP, creates session, hands to Master.
</Good>

<Good>
User: "oh-my-beads resume"
Why good: Detects active session, loads state, asks user to resume or restart.
</Good>

<Bad>
User: "fix the typo on line 42"
Why bad: Trivial fix. Oh-My-Beads is overkill — just fix it directly.
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- beads_village MCP not found: STOP, report installation instructions
- Corrupt session.json: Delete file, warn user, start fresh
- init() fails after doctor() retry: STOP, report to user
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] beads_village MCP responds to status()
- [ ] Session state written to .oh-my-beads/state/session.json
- [ ] beads_village initialized with team="oh-my-beads"
- [ ] Master skill loaded with user request context
</Final_Checklist>

<Advanced>
## Skill Registry

| Skill | Phase | Purpose |
|-------|-------|---------|
| `oh-my-beads:using-oh-my-beads` | Bootstrap | Entry point, pre-flight |
| `oh-my-beads:mr-fast` | Bootstrap | Mr.Fast entry point |
| `oh-my-beads:master` | All | 8-step state machine |
| `oh-my-beads:scout` | 1 | Socratic requirements |
| `oh-my-beads:fast-scout` | Mr.Fast | Rapid analysis |
| `oh-my-beads:architect` | 2-4 | Planning, decomposition |
| `oh-my-beads:worker` | 6 | Implementation |
| `oh-my-beads:reviewer` | 5, 7 | Validation, code review |
| `oh-my-beads:cancel` | Any | Session cancellation |
| `oh-my-beads:doctor` | Any | Workspace diagnostics |

## Error Recovery

| Error | Action |
|-------|--------|
| beads_village not found | Stop. Tell user to install. |
| Corrupt session.json | Delete, start fresh, warn user. |
| Missing directories | Create silently. |
| init() fails | `doctor()` → retry → report if still fails. |

## Resume Flow

1. Read `state/session.json` for current phase
2. Read latest `handoffs/<phase>.md`
3. Re-init beads_village
4. Query bead status: `mcp__beads-village__ls(status="all")`
5. Hand off to Master with resume context
</Advanced>
