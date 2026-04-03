---
name: debugging
description: >-
  Systematic debugging for blocked Workers, test failures, build errors, runtime crashes,
  and integration issues. Invoked standalone ("debug this error") or by other skills
  (Reviewer spawns debugger on failure, Swarming invokes on blocker). Reads
  critical-patterns.md to avoid re-solving known issues. Writes debug notes for
  compounding to capture.
level: 3
---

<Purpose>
Resolve blockers and failures systematically. Do not guess — triage first, then reproduce,
then diagnose, then fix. This skill is the debugger-of-last-resort for the OMB ecosystem:
when a Worker fails, a build breaks, a test goes red, or an integration snaps, debugging
provides the structured protocol to find and fix the root cause.

The compounding flywheel matters here too: 30-40% of recurring failures are already documented
in critical-patterns.md. Check before investigating.
</Purpose>

<Use_When>
- A build fails (compilation, type error, missing dependency)
- A test fails (assertion mismatch, flaky test, timeout)
- A runtime crash or exception occurs
- An integration breaks (API mismatch, env config, auth)
- A Worker is stuck (circular dependency, conflicting changes, unresolvable blocker)
- Reviewer or Swarming hands off with a failure that needs root cause analysis
- User says "debug this", "why is this failing", "fix this error"
</Use_When>

<Do_Not_Use_When>
- The issue is a requirements question (use Scout)
- The issue is a planning problem (use Architect)
- The fix is obvious and trivial (just fix it directly)
</Do_Not_Use_When>

<Why_This_Exists>
Unstructured debugging wastes time. Developers (and agents) jump to solutions before understanding
the problem, fix symptoms instead of root causes, and don't check if the failure is already known.
This skill enforces: triage → reproduce → diagnose → fix → learn.
</Why_This_Exists>

<Execution_Policy>
- Follow the 5 steps in order. Do not skip to Fix before Diagnose.
- Check critical-patterns.md FIRST — before any investigation.
- Write a one-sentence root cause before implementing any fix.
- Verify the fix with the exact command that originally failed.
- Report decision violations — do not silently patch around locked decisions.
</Execution_Policy>

<Steps>
## Step 1: Triage — Classify the Issue

Classify before investigating. Misclassifying wastes time.

| Type | Signals |
|---|---|
| **Build failure** | Compilation error, type error, missing module, bundler failure |
| **Test failure** | Assertion mismatch, snapshot diff, timeout, flaky intermittent pass |
| **Runtime error** | Crash, uncaught exception, segfault, undefined behavior |
| **Integration failure** | HTTP 4xx/5xx, env variable missing, API schema mismatch, auth error |
| **Blocker** | Stuck Worker, circular bead dependency, conflicting file reservations |

**Output of triage:** A one-line classification: `[TYPE] in [component]: [symptom]`

Example: `Build failure in src/auth: TS2345 type mismatch in jwt.ts`

## Step 2: Reproduce — Isolate the Failure

**Check known patterns first** — before any investigation:

```
Read .oh-my-beads/history/learnings/critical-patterns.md (if exists)
Grep for keywords from classification
```

If a known pattern matches → jump directly to Step 4 (Fix), using the documented resolution.

**If not a known pattern, reproduce it:**

1. Run the exact command that failed — do not paraphrase it:
   ```bash
   # Whatever the Worker/CI ran — run it verbatim
   npm run build 2>&1 | tee /tmp/debug-output.txt
   # or: pytest tests/specific_test.py -v 2>&1 | tee /tmp/debug-output.txt
   ```

2. Capture error output verbatim. Do not summarize. Exact line numbers and messages matter.

3. Identify the minimal reproduction case:
   - Can you trigger the failure with one file change? One command?
   - Does it fail in isolation or only in combination with other changes?
   - Is it environment-specific?

4. Confirm reproducibility:
   - Run twice. If intermittent → classify as **flaky test**, not a deterministic failure.
   - Flaky tests require a different approach: check for shared state, race conditions, test ordering.

## Step 3: Diagnose — Root Cause Analysis

Work through these checks in order. Stop when you find the cause.

### 3a. Read the relevant source files

```
Grep for the error symbol or function name in the codebase
Read exactly the files implicated by the error output
```

Do not read the entire codebase. Read exactly the files mentioned in the error.

### 3b. Check git blame for recent changes

```bash
git log --oneline -20          # What changed recently?
git blame <file> -L <line>,<line>  # Who changed the failing line?
git diff HEAD~3 -- <file>      # What did it look like before?
```

If a recent commit introduced the failure → the fix is likely reverting or adjusting that change.

### 3c. Check bead context (if in OMB session)

```
mcp__beads-village__show(id=<bead-id>)
```

Verify: does the failure indicate the bead was implemented against the wrong spec, or that
the spec was wrong?

### 3d. Check CONTEXT.md for decision violations

```
Read .oh-my-beads/history/<feature>/CONTEXT.md
```

Was a locked decision (D1, D2...) violated by the implementation? Decision violations are a
frequent root cause — the code does something "reasonable" that was explicitly excluded.

### 3e. Check beads_village messages for related blockers (if in swarm)

```
mcp__beads-village__inbox(unread=true)
```

Another Worker may have already reported the same issue or a related conflict. Avoid duplicate debugging.

### 3f. Narrow to root cause

After checks 3a-3e, write a one-sentence root cause:

> Root cause: `<file>:<line>` — `<what is wrong and why>`

**If you cannot write this sentence, you do not have the root cause yet. Do not proceed to Fix.**

## Step 4: Fix — Apply and Verify

### Fix size determines approach

**Small fix** (1-3 files, obvious change, low risk):
- Implement directly
- Run verification immediately

**Substantial fix** (cross-cutting change, logic redesign, multiple files):
- Create a fix bead before implementing:
  ```
  mcp__beads-village__add(
    title="Fix: <root cause summary>",
    typ="bug", pri=0,
    desc="## Root Cause\n<from Step 3f>\n## Fix\n<approach>\n## Verification\n<command>"
  )
  ```
- Implement in the fix bead's scope
- The fix bead's acceptance criteria must pass

**Decision violation** (CONTEXT.md decision ignored):
- Do NOT silently fix — the decision may need to be revisited
- Report via beads_village messaging before implementing:
  ```
  mcp__beads-village__msg(
    subj="Decision violation found: <decision-id>",
    body="Bead <id> violated decision <D#>: <what was done vs what was decided>. Proposed fix: <approach>.",
    to="master",
    importance="high"
  )
  ```
- Wait for response or implement the conservative fix (honor the locked decision)

### Verify the fix

Run the exact command that originally failed. It must pass cleanly — not "mostly pass":

```bash
# Rerun original failing command
<original-failing-command>

# Also run broader test suite to check for regressions
npm test   # or language equivalent
```

If verification fails → do not report success. Return to Step 3 with new information.

### Report the fix

```
mcp__beads-village__msg(
  subj="Fix applied: <classification from Step 1>",
  body="Root cause: <sentence from 3f>.\nFix: <what was changed>.\nVerification: passed.",
  to="master"
)
```

## Step 5: Learn — Capture the Pattern

### If this is a new failure pattern

Write a debug note for compounding to capture later:

```markdown
## Debug Note: <date> — <classification>

**Root cause**: <root cause sentence>
**Trigger**: <what causes this>
**Fix**: <what resolves it>
**Signal**: <how to recognize this pattern in future>
```

Write to `.oh-my-beads/history/debug-notes.md` (appended, project-level, committed to repo).

Tell the user: "New failure pattern found. Run compounding skill to promote this to learnings."

### If this matches a known pattern from critical-patterns.md

Verify the existing advice still works:
- Did following the documented resolution solve it? → no action needed
- If the documented resolution failed or is outdated → flag it:

```
Append to .oh-my-beads/history/learnings/critical-patterns.md:
"Pattern '<name>' resolution no longer accurate as of <date> — <what changed>"
```
</Steps>

<Tool_Usage>
- **Read, Glob, Grep** — Read source code, error output, learnings files
- **Bash** — Run builds, tests, git blame, reproduction commands
- **mcp__beads-village__show** — Read bead context (if in OMB session)
- **mcp__beads-village__inbox** — Check for related blocker reports
- **mcp__beads-village__msg** — Report fixes and decision violations
- **mcp__beads-village__add** — Create fix beads for substantial fixes
- **Edit, Write** — Apply code fixes + write debug notes
- **NEVER:** reserve, release, claim (Worker's job), Agent, AskUserQuestion
</Tool_Usage>

<Examples>
<Good>
Debugger classifies: "Test failure in src/auth/jwt.test.ts: expected 401 got 200".
Checks critical-patterns.md — no match. Reproduces: test fails consistently.
Reads jwt.test.ts and jwt.ts. Git blame shows a commit 2 hours ago changed the
token expiry check. Root cause: "jwt.ts:45 — expiry comparison uses `<` instead
of `<=`, allowing tokens expiring at exactly the current second to pass."
Fixes the comparison. Reruns test — passes. Runs full suite — no regressions.
Reports fix via msg(). Writes debug note for compounding.
Why good: Systematic, reproduced, root-caused with file:line, verified, documented.
</Good>

<Bad>
Debugger sees "test failed" and immediately changes the test assertion to match
the current (wrong) behavior. Does not check root cause or CONTEXT.md decisions.
Why bad: Fixed the test, not the bug. Possible decision violation uncaught.
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- Cannot reproduce after 3 attempts: report as environment-specific, ask user for more context
- Root cause points to a CONTEXT.md decision conflict: report to Master, do not silently fix
- Fix creates regressions in other tests: revert, diagnose further
- Stuck after 15 minutes: write what you know, escalate to user with classification + findings
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] Issue classified (Step 1 one-liner)
- [ ] critical-patterns.md checked for known patterns
- [ ] Failure reproduced (or confirmed as known pattern)
- [ ] Root cause identified with file:line (Step 3f one-sentence)
- [ ] Fix applied and verified with exact failing command
- [ ] No regressions in broader test suite
- [ ] Fix reported (msg to Master if in OMB session)
- [ ] Debug note written for compounding (if new pattern)
</Final_Checklist>

<Advanced>
## Blocker-Specific Protocol

When a Worker is stuck (cannot make progress, not a code error):

1. Check bead dependencies:
   ```
   mcp__beads-village__bv_insights()   # Check for cycles
   mcp__beads-village__ls(status="in_progress")   # What's active?
   ```

2. Check file reservations:
   ```
   mcp__beads-village__reservations()   # Who holds what?
   ```

3. Determine: **waiting for another Worker** or **genuinely blocked**?

**Waiting for another Worker** → report to orchestrator and yield:
```
mcp__beads-village__msg(
  subj="Blocked: waiting on <bead-id>",
  body="<bead-id> cannot proceed until <dependency> completes. Pausing.",
  to="master"
)
```

**Genuinely blocked** (circular dep, impossible constraint, conflicting decisions):
```
mcp__beads-village__msg(
  subj="Hard blocker: <description>",
  body="Cannot resolve: <what is impossible and why>. Options: <A> or <B>. Needs human decision.",
  to="master",
  importance="high"
)
```

Do not spin. One report, then pause and let the orchestrator escalate.

## Quick Reference

| Situation | First action |
|---|---|
| Build fails | `git log --oneline -10` — check recent changes |
| Test fails | Run test verbatim, capture exact assertion output |
| Flaky test | Run 5x — if intermittent, check shared state/ordering |
| Runtime crash | Read stack trace top-to-bottom, find first line in your code |
| Integration error | Check env vars, then API response body (not just status code) |
| Worker stuck | Check bead deps with `bv_insights()`, then `inbox()` for conflicts |
| Recurring issue | Check `critical-patterns.md` first |

## Integration Points

| Invoker | When | What debugging receives |
|---------|------|----------------------|
| **Reviewer** (Phase 7) | Bead fails review with test/build error | Classification + error output + bead ID |
| **Swarming** (Phase 6) | Worker reports BLOCKED | Blocker description + bead ID |
| **Worker** | Self-verify fails | Error output + bead context |
| **User** | "debug this error" | Error description or output |
| **Master** | Post-execution build fails | Full error log |
</Advanced>
