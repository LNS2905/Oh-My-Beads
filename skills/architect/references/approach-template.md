# Approach: <Feature Name>

**Date**: <YYYY-MM-DD>
**Feature**: <feature-slug>
**Based on**:
- `.oh-my-beads/history/<feature>/CONTEXT.md`
- Critical patterns: `.oh-my-beads/history/learnings/critical-patterns.md`

---

## 1. Gap Analysis

> What exists vs. what the feature requires.

| Component | Have | Need | Gap Size |
|-----------|------|------|----------|
| <e.g., User entity> | `src/models/user.ts` | `Subscription` entity | New — model after User |
| <e.g., Stripe SDK> | None | Stripe integration | New — external dep |
| <e.g., Webhook route> | None | `/api/webhooks/stripe` | New — novel pattern |

---

## 2. Recommended Approach

> Specific strategy — not "here are options", a concrete recommendation.

<Description of recommended approach in 3-5 sentences. Include the key architectural
decision and why it's the right call for this codebase.>

### Why This Approach

- <Reason 1> — connects to existing pattern at `<file>`
- <Reason 2> — honors locked decision D<N> from CONTEXT.md
- <Reason 3> — avoids known pitfall from learnings

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| <e.g., State management> | <e.g., Zustand> | <e.g., Locked in CONTEXT.md D3> |
| <e.g., Error strategy> | <e.g., Result type> | <e.g., Matches existing pattern> |

---

## 3. Alternatives Considered

### Option A: <Name>
- Why considered: <why it seemed reasonable>
- Why rejected: <specific technical reason>

### Option B: <Name>
- Why considered: <why it seemed reasonable>
- Why rejected: <specific technical reason>

---

## 4. Risk Assessment

| Component | Risk Level | Reason | Action |
|-----------|------------|--------|--------|
| <component> | **HIGH** | New external dep, no pattern | Flag for spike in validation |
| <component> | **MEDIUM** | Variation of existing pattern | Proceed with caution |
| <component> | **LOW** | Follows existing pattern exactly | Proceed |

### Risk Classification Reference

```
Pattern in codebase?     → YES = LOW base
External dependency?     → YES = HIGH
Blast radius > 5 files?  → YES = HIGH
Otherwise                → MEDIUM
```

---

## 5. AI-Slop Check Results

| Flag | Status | Notes |
|------|--------|-------|
| Scope inflation | CLEAN / FLAGGED | <what was removed or why it's clean> |
| Premature abstraction | CLEAN / FLAGGED | <what was inlined or why it's clean> |
| Over-validation | CLEAN / FLAGGED | <what was simplified or why it's clean> |

---

## 6. Phase Breakdown

> How the feature decomposes into execution phases. Each phase is a meaningful
> slice that delivers an observable capability.

| Phase | What Changes | Stories | Complexity |
|-------|-------------|---------|------------|
| Phase A: <name> | <observable outcome> | <N> stories | Low / Medium / High |
| Phase B: <name> | <observable outcome> | <N> stories | Low / Medium / High |
| Phase C: <name> | <observable outcome> | <N> stories | Low / Medium / High |

---

## 7. Story Map

### Phase A: <Name>

#### Story 1: <Name>
**Acceptance criteria:**
- [ ] <concrete, verifiable criterion>
- [ ] <concrete, verifiable criterion>
**File scope:** <file> (new/modify), <file> (new/modify)
**Dependencies:** None
**Complexity:** Low | Medium | High

#### Story 2: <Name>
...

### Phase B: <Name>
...

---

## 8. Institutional Learnings Applied

| Learning Source | Key Insight | How Applied |
|-----------------|-------------|-------------|
| `history/learnings/<file>` | <gotcha or pattern> | <how plan accounts for it> |

_If none: "No prior learnings relevant to this feature."_

---

## 9. Scope Boundary Check

**IN scope:**
- <what's included, tied to user request>

**OUT of scope:**
- <what's excluded and why>

**Removed during AI-slop check:**
- <items removed for scope inflation, premature abstraction, or over-validation>
- _Or: "Nothing removed — plan is clean."_

---

## 10. Verification Strategy

- <how to verify the feature works end-to-end>
- <what tests to run>
- <what to demo>
