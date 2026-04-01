# Discovery Template — Scout Output

This template is used by the Scout skill in Phase 4 to write CONTEXT.md.
It is read by the Architect (planning), Validating skill, and all downstream agents.

**Save to:** `.oh-my-beads/history/<feature-slug>/CONTEXT.md`

**Rules:**
- Be concrete: "Card layout, not timeline" — not "modern and clean"
- Every locked decision must have a stable ID (D1, D2...)
- Code context must cite actual file paths found during the scout
- Do not leave placeholder sections — remove unused sections instead

---

## Template

```markdown
# CONTEXT.md — <Feature Name>

**Feature slug:** <kebab-case-slug>
**Date:** YYYY-MM-DD
**Domain:** <SEE | CALL | RUN | READ | ORGANIZE>
**Scope:** Standard | Deep

---

## Request Summary

[One clear sentence: what this feature delivers and where it ends.
This is the scope anchor — planning must not exceed it.]

---

## Domain Classification

**Primary:** <domain type(s)>

[If multi-domain, list all that apply with brief rationale.]

---

## Locked Decisions

These are fixed. Planning must implement them exactly. No creative reinterpretation.

### <Category>

- **D1** [Specific, concrete decision — not a preference]
  *Rationale: [Why the user chose this]*
  *Rejected: [alternatives that were not chosen]*

- **D2** [Specific, concrete decision]
  *Rationale: [optional]*

### Agent's Discretion

[Areas where the user said "you decide" — list what was delegated and constraints.
Mark as "Scout-defaulted: [rationale]".]

---

## Scope Boundaries

### IN (what's included)
- [Capability or behavior that IS part of this feature]

### OUT (what's excluded)
- [Capability or behavior that is NOT part of this feature]
- [Adjacent feature explicitly deferred]

---

## Existing Code Context

From the quick codebase scout during exploring.
Downstream agents: read these files before planning to avoid reinventing existing patterns.

### Reusable Assets
- `path/to/file.ts` — [what it does, how it applies]

### Established Patterns
- [Pattern name]: [where it's used, what it means for new work]

### Integration Points
- [Where new code connects to existing system — file path + what to call/extend]

---

## Institutional Learnings Applied

[Findings from critical-patterns.md and domain-specific learnings files.]

- **[Learning title]** (from `<source-file>`): [How it applies to this feature]
- Or: "No prior learnings for this domain."

---

## Deferred Questions

### Resolve Before Planning
[Product decisions that must be answered before the planner can start.]

- [ ] [Question] — [Why it blocks planning]

### Deferred to Planning
[Technical questions better answered with codebase research.]

- [ ] [Question] — [What investigation will answer it]

---

## Deferred Ideas

[Out-of-scope ideas that surfaced during exploration. Each is a future work item.]

- [Idea] — [Brief note on why it was deferred]

---

## Handoff Note

CONTEXT.md is the single source of truth for this feature.

- **Architect** reads: locked decisions, code context, deferred-to-planning questions
- **Validating** reads: locked decisions (to verify plan-checker coverage)
- **Reviewer** reads: locked decisions (for decision compliance review)

Decision IDs (D1, D2...) are stable. Reference them by ID in all downstream artifacts.
```
