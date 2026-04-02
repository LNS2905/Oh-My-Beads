---
name: mr-fast
description: >-
  Mr.Fast mode reference — lightweight workflow for quick fixes and small changes.
  Two execution paths: Turbo (single Executor) and Standard (Fast Scout → Executor).
  No mandatory review agent — Executor self-verifies. beads_village used only for
  file locking when needed.
  NOTE: keyword-detector now routes directly to oh-my-beads:executor (turbo) or
  oh-my-beads:fast-scout (standard). This skill is no longer the entry point but
  can still be invoked manually via /oh-my-beads:mr-fast.
level: 3
---

<Purpose>
Mr.Fast is the lightweight mode of Oh-My-Beads. While Mr.Beads provides a thorough
multi-phase workflow with HITL gates for complex features, Mr.Fast targets quick fixes:
bug fixes, small code changes, root cause analysis, and minor refactors.

**Routing:** The keyword-detector routes directly to the appropriate skill:
- **Turbo** intent → `oh-my-beads:executor` (single Executor, no analysis phase)
- **Standard** intent → `oh-my-beads:fast-scout` (Fast Scout analysis → Executor)
- **Complex** intent → Suggests Mr.Beads instead (no session activated)

This skill (`oh-my-beads:mr-fast`) is retained for manual invocation but is no longer
the automatic entry point from keyword detection.
</Purpose>

<Use_When>
- User says "mr.fast", "mrfast", or invokes `/oh-my-beads:mr-fast`
- Task is a bug fix, small code change, or root cause investigation
- Task touches 1-5 files and doesn't need architectural planning
</Use_When>

<Do_Not_Use_When>
- Task requires architectural planning or multi-story decomposition → use Mr.Beads
- Intent classified as `complex` by keyword-detector → user already received Mr.Beads suggestion
</Do_Not_Use_When>

<Execution_Policy>
- No HITL gates — user approved by triggering Mr.Fast
- No mandatory review agent — Executor self-verifies (build/lint/test)
- Session state tracked at system-level with `mode: "mr.fast"`
- Autonomous until completion — Stop hook enforces continuation
- Max 1 Executor retry on failure, then escalate to user
- Total target time: under 5 minutes
</Execution_Policy>

<Steps>

## Step 0: Read Intent

Read the intent from keyword-detector output (passed in spawn prompt):
- `turbo` → go to **Turbo Path**
- `standard` → go to **Standard Path**

If intent is missing or unclear, default to **Standard Path**.

---

## Turbo Path

For explicit file+approach prompts (e.g., "mr.fast fix typo on line 42 of auth.ts").
Single Executor, no Fast Scout, no beads_village init.

### T1. Spawn Executor Directly

No analysis phase. The user's prompt IS the brief.

```
Agent(
  description="Mr.Fast turbo executor",
  prompt="You are an Executor in Oh-My-Beads Mr.Fast Turbo mode.

## Task Classification: Trivial
The user provided explicit file and approach. Execute mechanically.

## User Request
<original request>

## Instructions
1. Read the target file(s) mentioned in the request
2. Apply the specific change described
3. If file locking needed: mcp__beads-village__reserve(paths=[...]) before edits
4. Verify: run lint/build/test on changed files
5. Release locks if reserved: mcp__beads-village__release()
6. Report results with file:line citations

Do NOT re-analyze or expand scope. Execute exactly what was requested.",
  model="sonnet"
)
```

### T2. Handle Result

- **Success:** go to Completion
- **Failure (first attempt):** re-spawn Executor with error context (1 retry)
- **Failure (second attempt):** set phase to `failed`, report to user

### T3. Update Phase

Update session state: `current_phase: "fast_complete"`

---

## Standard Path

For moderate fixes where analysis is needed before implementation.
Fast Scout → Executor, Executor self-verifies.

### S1. Init beads_village (lite mode)

```
mcp__beads-village__init(team="oh-my-beads-fast")
```

If init fails: WARN but continue. File locking unavailable but Mr.Fast can still work.

### S2. Update Phase

Update session state: `current_phase: "fast_scout"`

### S3. Spawn Fast Scout

```
Agent(
  description="Fast Scout analysis",
  prompt="<oh-my-beads:fast-scout skill content>

## User Request
<original request>",
  model="sonnet"
)
```

Fast Scout writes **BRIEF.md** with root cause, affected files, and fix plan.

### S4. Update Phase to Execution

Update session state: `current_phase: "fast_execution"`

### S5. Spawn Executor

```
Agent(
  description="Mr.Fast executor",
  prompt="You are an Executor in Oh-My-Beads Mr.Fast mode.

## Task Classification: Scoped
Analysis was performed by Fast Scout. Follow the fix plan.

## BRIEF.md
Read BRIEF.md first — it contains the complete analysis and fix plan.

## User Request
<original request>

## Instructions
1. Read BRIEF.md for the fix plan
2. Lock files: mcp__beads-village__reserve(paths=[affected files from BRIEF])
3. Follow the Fix Plan step by step — apply each edit mechanically
4. Self-verify: run build/lint/test on changed files
5. Release locks: mcp__beads-village__release()
6. Report results with file:line citations

IMPORTANT: Follow the Fix Plan from BRIEF.md. Do not re-derive the fixes.",
  model="sonnet"
)
```

### S6. Handle Executor Result

- **Success:** go to Completion
- **Failure (first attempt):** re-spawn Executor with error context (1 retry)
- **Failure (second attempt):** set phase to `failed`, report to user

---

## Completion (Both Paths)

### C1. Report Results

```
Mr.Fast complete.
- Path: Turbo | Standard
- Files modified: <list>
- Verification: Build PASS/FAIL, Tests PASS/FAIL
- Mode: mr.fast | Total time: <elapsed>
```

### C2. Cleanup

Update session state: `active: false`, `current_phase: "fast_complete"`
Release any remaining beads_village locks.

</Steps>

<Tool_Usage>
- **mcp__beads-village__init()** — Standard path only (NOT turbo)
- **mcp__beads-village__reserve/release** — file locking via Executor (both paths, when needed)
- **Agent** — spawn Fast Scout (standard only) and Executor
- **Read/Write** — session state files only
- **NEVER:** Edit source code directly (Executor does that)
</Tool_Usage>

<Escalation_And_Stop_Conditions>
- Executor fails twice → escalate to user with error details
- Task larger than expected → suggest switching to Mr.Beads
- beads_village unavailable → continue without file locking (warn user)
</Escalation_And_Stop_Conditions>
