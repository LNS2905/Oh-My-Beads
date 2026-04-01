---
name: mr-fast
description: >-
  Mr.Fast mode bootstrap — lightweight workflow for quick bug fixes, small code changes,
  and root cause analysis. Spawns Fast Scout for rapid analysis, then Executor for
  implementation, then a lightweight reviewer for safety. No planning, no HITL gates.
  Uses beads_village lite (reserve/release only).
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
- Three phases: Fast Scout → Executor → Quick Review
- No HITL gates (user approved by triggering Mr.Fast)
- beads_village used only for file locking (reserve/release)
- Session state tracked in .oh-my-beads/state/session.json with mode: "mr.fast"
- Autonomous until completion — Stop hook enforces continuation
- Max 1 retry if Executor fails (then escalate to user)
- Quick Review: lightweight haiku-model reviewer checks for obvious bugs, security issues, test pass
- If reviewer says FAIL: one retry of Executor with review feedback, then complete with warning
- Total target time: under 5 minutes
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

---

## Phase 1: Fast Scout

5. **Spawn Fast Scout**
   ```
   Agent(
     description="Fast Scout analysis",
     prompt="<oh-my-beads:fast-scout skill content>\n\n## User Request\n<original request>",
     model="sonnet"
   )
   ```
   Fast Scout writes **BRIEF.md** to the working directory containing:
   - Root cause / change scope
   - Affected files with line references
   - Fix plan (step-by-step, specific enough for mechanical execution)
   - Interactions & risks

---

## Phase 2: Execution

6. **Update Phase to Execution**
   Update `state/session.json`: `current_phase: "fast_execution"`

7. **Spawn Executor**
   ```
   Agent(
     description="Mr.Fast executor",
     prompt="You are an Executor in Oh-My-Beads Mr.Fast mode.\n\n## BRIEF.md\nRead BRIEF.md first — it contains the complete analysis and fix plan.\n\n## User Request\n<original request>\n\n## Instructions\n1. Read BRIEF.md for the fix plan\n2. Lock files: mcp__beads-village__reserve(paths=[affected files from BRIEF])\n3. Follow the Fix Plan step by step — apply each edit mechanically\n4. Run build/test verification\n5. Release locks: mcp__beads-village__release()\n6. Report results with file:line citations\n\nIMPORTANT: Follow the Fix Plan from BRIEF.md. Do not re-derive the fixes.",
     model="sonnet"
   )
   ```

8. **Handle Executor Result**
   - **Success:** Proceed to Phase 3 (Quick Review)
   - **Failure (first attempt):** Re-spawn Executor with error context (1 retry)
   - **Failure (second attempt):** Set phase to `failed`, report to user, skip review

---

## Phase 3: Quick Review

9. **Update Phase to Review**
   Update `state/session.json`: `current_phase: "fast_review"`

10. **Spawn Lightweight Reviewer**
    ```
    Agent(
      subagent_type="oh-my-claudecode:code-reviewer",
      description="Mr.Fast quick review",
      prompt="Quick review of changes made by Executor in Mr.Fast mode.\n\n## Executor Report\n<executor output summary>\n\n## Changed Files\n<list of modified files from executor>\n\n## Review Checklist\n1. Obvious bugs or logic errors\n2. Security issues (injection, auth bypass, secrets)\n3. Tests pass (if executor ran them)\n\n## Verdict\nRespond with exactly one of:\n- PASS: No issues found\n- MINOR: Minor suggestions but acceptable to ship\n- FAIL: Significant issue found — include specific description and fix suggestion\n\nKeep review fast — this is a lightweight check, not a full audit.\nTarget: under 60 seconds.",
      model="haiku"
    )
    ```

11. **Handle Review Result**
    - **PASS or MINOR:** Proceed to completion. If MINOR, include reviewer notes in final summary.
    - **FAIL (first time, retry_count < 1):**
      1. Update `state/session.json`: `current_phase: "fast_execution"`, increment `failure_count`
      2. Re-spawn Executor with review feedback:
         ```
         Agent(
           description="Mr.Fast executor (retry with review feedback)",
           prompt="You are an Executor in Oh-My-Beads Mr.Fast mode.\n\n## Previous Review Feedback (FAIL)\n<reviewer FAIL details>\n\n## Original Analysis\n<fast scout output>\n\n## Instructions\n1. Fix the specific issue identified by the reviewer\n2. Re-verify build/tests\n3. Report results",
           model="sonnet"
         )
         ```
      3. After retry Executor completes, re-run reviewer (step 10) once more.
    - **FAIL (after retry, retry_count >= 1):**
      Complete the workflow with a warning:
      ```
      WARNING: Reviewer flagged issues that persist after 1 retry.
      Review feedback: <reviewer details>
      Manual verification recommended.
      ```

---

## Completion

12. **Report Results**
    Present summary:
    ```
    Mr.Fast complete.
    - Files modified: <list>
    - Verification: Build PASS/FAIL, Tests PASS/FAIL
    - Review: PASS | MINOR (notes) | FAIL (warning — manual check needed)
    - Mode: mr.fast | Total time: <elapsed>
    ```

13. **Cleanup**
    Update `state/session.json`: `active: false`, `current_phase: "fast_complete"`
    Release any remaining beads_village locks.
</Steps>

<Tool_Usage>
- **mcp__beads-village__status()** — validate MCP availability
- **mcp__beads-village__init()** — initialize lite workspace
- **mcp__beads-village__reserve/release** — file locking (via Executor)
- **Agent** — spawn Fast Scout, Executor, and Quick Reviewer
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
- Reviewer says FAIL after retry: complete with warning, recommend manual review
- Task turns out to be larger than expected: suggest switching to Mr.Beads
- beads_village unavailable: continue without file locking (warn user)
- Total elapsed > 5 minutes: log warning but continue to completion
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] Fast Scout wrote BRIEF.md with analysis and fix plan
- [ ] Executor followed BRIEF.md fix plan and verified changes
- [ ] Quick Reviewer completed review (PASS/MINOR/FAIL)
- [ ] If FAIL: retry attempted (max 1), warning included if still failing
- [ ] File locks released
- [ ] session.json set to active: false
- [ ] Results reported to user with review verdict
</Final_Checklist>
