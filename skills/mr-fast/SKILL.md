---
name: mr-fast
description: >-
  Mr.Fast mode bootstrap — lightweight workflow for quick bug fixes, small code changes,
  and root cause analysis. Spawns Fast Scout for rapid analysis, then Executor for
  implementation. No planning, no reviewer, no HITL gates. Uses beads_village lite
  (reserve/release only).
level: 3
---

<Purpose>
Mr.Fast is the lightweight mode of Oh-My-Beads. While Mr.Beads provides a thorough 8-step
workflow with 3 HITL gates for complex features, Mr.Fast is designed for quick fixes: bug fixes,
small code changes, root cause analysis, and minor refactors. It skips planning, decomposition,
and formal review — focusing on speed and directness.
</Purpose>

<Use_When>
- User says "mr.fast", "mrfast", or invokes `/oh-my-beads:mr-fast`
- Task is a bug fix, small code change, or root cause investigation
- Task touches 1-5 files and doesn't need architectural planning
- User wants fast results without HITL gates
</Use_When>

<Do_Not_Use_When>
- Task requires architectural planning or multi-story decomposition (use Mr.Beads)
- Task has complex cross-cutting concerns or dependencies
- User explicitly wants formal review and approval gates
</Do_Not_Use_When>

<Why_This_Exists>
The full Mr.Beads workflow (8 steps, 3 gates, 5 agents) is overkill for fixing a login bug
or renaming a function. Mr.Fast provides the right tool for small tasks: quick analysis
followed by direct execution.
</Why_This_Exists>

<Execution_Policy>
- Two phases only: Fast Scout → Executor
- No HITL gates (user approved by triggering Mr.Fast)
- beads_village used only for file locking (reserve/release)
- Session state tracked in .oh-my-beads/state/session.json with mode: "mr.fast"
- Autonomous until completion — Stop hook enforces continuation
- Max 1 retry if Executor fails (then escalate to user)
</Execution_Policy>

<Steps>
1. **Pre-Flight: Validate beads_village**
   ```
   Call: mcp__beads-village__status()
   ```
   If fails: WARN but continue (file locking won't be available, but Mr.Fast can still work).

2. **Check for Active Session**
   Read `.oh-my-beads/state/session.json`:
   - If `active: true` and `mode: "mr.beads"`: STOP. Tell user to cancel Mr.Beads first or wait.
   - If `active: true` and `mode: "mr.fast"`: Ask — Resume or Restart?
   - Otherwise: proceed.

3. **Initialize Session State**
   Write `state/session.json`:
   ```json
   {
     "active": true,
     "mode": "mr.fast",
     "current_phase": "fast_scout",
     "started_at": "<ISO-8601>",
     "reinforcement_count": 0,
     "failure_count": 0
   }
   ```

4. **Init beads_village** (lite mode)
   ```
   mcp__beads-village__init(team="oh-my-beads-fast")
   ```

5. **Spawn Fast Scout**
   ```
   Agent(
     description="Fast Scout analysis",
     prompt="<oh-my-beads:fast-scout skill content>\n\n## User Request\n<original request>",
     model="sonnet"
   )
   ```
   Fast Scout returns an analysis summary with:
   - Root cause / change scope
   - Affected files
   - Recommended approach

6. **Update Phase to Execution**
   Update `state/session.json`: `current_phase: "fast_execution"`

7. **Spawn Executor**
   ```
   Agent(
     description="Mr.Fast executor",
     prompt="You are an Executor in Oh-My-Beads Mr.Fast mode.\n\n## Analysis Summary\n<fast scout output>\n\n## User Request\n<original request>\n\n## Instructions\n1. Lock files: mcp__beads-village__reserve(paths=[affected files])\n2. Implement the fix following the recommended approach\n3. Run build/test verification\n4. Release locks: mcp__beads-village__release()\n5. Report results with file:line citations",
     model="sonnet"
   )
   ```

8. **Handle Executor Result**
   - **Success:** Update phase to `fast_complete`, set `active: false`
   - **Failure (first attempt):** Re-spawn Executor with error context (1 retry)
   - **Failure (second attempt):** Set phase to `failed`, report to user

9. **Report Results**
   Present summary:
   ```
   Mr.Fast complete.
   - Files modified: <list>
   - Verification: Build PASS/FAIL, Tests PASS/FAIL
   - Mode: mr.fast (no formal review — verify manually if needed)
   ```

10. **Cleanup**
    Update `state/session.json`: `active: false`, `current_phase: "fast_complete"`
    Release any remaining beads_village locks.
</Steps>

<Tool_Usage>
- **mcp__beads-village__status()** — validate MCP availability
- **mcp__beads-village__init()** — initialize lite workspace
- **mcp__beads-village__reserve/release** — file locking (via Executor)
- **Agent** — spawn Fast Scout and Executor
- **Read/Write** — session state files only
- **NEVER:** Edit source code directly (Executor does that)
</Tool_Usage>

<Examples>
<Good>
User: "mr.fast fix the login validation bug in auth.ts"
Why good: Clear, scoped task. Fast Scout identifies the bug location, Executor fixes it.
</Good>

<Good>
User: "mrfast find root cause of the 500 error on /api/users"
Why good: Root cause analysis. Fast Scout investigates, Executor implements the fix.
</Good>

<Bad>
User: "mr.fast redesign the entire auth system to use OAuth2"
Why bad: This is an architectural change requiring Mr.Beads. Suggest switching modes.
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- Executor fails twice: escalate to user with error details
- Task turns out to be larger than expected: suggest switching to Mr.Beads
- beads_village unavailable: continue without file locking (warn user)
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] Fast Scout returned analysis summary
- [ ] Executor implemented and verified changes
- [ ] File locks released
- [ ] session.json set to active: false
- [ ] Results reported to user
</Final_Checklist>
