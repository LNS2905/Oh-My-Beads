# Phase Contract: Phase <N> — <Phase Name>

**Date**: <YYYY-MM-DD>
**Feature**: <feature-slug>
**Plan Reference**: `.oh-my-beads/plans/plan.md`
**Based on**:
- `.oh-my-beads/history/<feature>/CONTEXT.md`
- `.oh-my-beads/plans/plan.md`

---

## 1. What This Phase Changes

> Explain in practical terms. Someone should picture what is different after this lands.

<2-4 sentences describing the real-world or system change this phase delivers.>

---

## 2. Why This Phase Exists Now

- <why this phase comes at this point in the sequence>
- <what would be blocked or riskier if this phase were skipped>

---

## 3. Entry State

> What is true before this phase starts?

- <observable truth 1>
- <observable truth 2>
- <constraint or dependency already satisfied>

---

## 4. Exit State

> What must be true when this phase is complete?

- <observable truth 1>
- <observable truth 2>
- <integration or system-level truth>

**Rule:** every exit-state line must be testable or demonstrable.

---

## 5. Demo Walkthrough

> The simplest walkthrough that proves this phase is real.

<In one short paragraph: "A user can now..." or "The system can now...">

### Demo Checklist

- [ ] <step 1>
- [ ] <step 2>
- [ ] <step 3>

---

## 6. Stories in This Phase

| Story | What Happens | Why Now | Unlocks | Done Looks Like |
|-------|-------------|---------|---------|-----------------|
| Story 1: <name> | <outcome> | <why first> | <what it enables> | <observable> |
| Story 2: <name> | <outcome> | <why next> | <what it enables> | <observable> |
| Story 3: <name> | <outcome> | <why last> | <what it enables> | <observable> |

---

## 7. Out Of Scope

- <thing intentionally not solved in this phase>
- <adjacent idea deferred to a later phase>

---

## 8. Success Signals

- <how we know this phase genuinely worked>
- <what reviewers should specifically confirm>

---

## 9. Failure / Pivot Signals

> If any of these happen, do not blindly continue to later phases.

- <signal that means the phase design is wrong>
- <signal that means the approach should pivot>

---

## 10. is_final_phase

> Is this the last phase of the feature?

**is_final_phase**: `true` | `false`

If `false`: next phase is **Phase <N+1> — <Name>**.
If `true`: after this phase completes, proceed to summary and compounding.
