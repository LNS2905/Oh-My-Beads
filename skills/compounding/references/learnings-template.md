# Learnings File Template

Use this template when writing `.oh-my-beads/history/learnings/YYYYMMDD-<slug>.md`.

One file per feature. Multiple learnings in a single file — separate with `---` dividers.

---

## YAML Frontmatter (required, line 1)

```yaml
---
date: YYYY-MM-DD
feature: <feature-name>
categories: [pattern, decision, failure, exit-audit]   # include only categories present
severity: critical | standard              # use "critical" if ANY entry is critical
tags: [tag1, tag2, tag3]                   # domains covered
# --- Optional fields (omit if not applicable) ---
phase_origin: <phase name>                 # e.g., "phase_6_execution", "phase_7_review"
story_context: <story name from plan.md>   # e.g., "Story 2: Token Refresh Endpoint"
decisions_referenced: [D1, D3]             # which locked decisions are relevant
---
```

The last three fields (`phase_origin`, `story_context`, `decisions_referenced`) are optional.
Existing learnings files without these fields remain valid.

---

## Learning Entry Format

Repeat for each distinct learning. Separate entries with `---`.

```markdown
# Learning: <Concise Title>

**Category:** pattern | decision | failure
**Severity:** critical | standard
**Tags:** [tag1, tag2]
**Applicable-when:** <one sentence — under what conditions should future agents use this?>

## What Happened

<2-4 sentences describing the situation: what was built, what went wrong or right.
Be specific — name files, functions, tools, or commands involved.>

## Root Cause / Key Insight

<Why this happened. For failures: what assumption was wrong. For patterns: why this
approach is better. For decisions: what information made this the right call.>

## Recommendation for Future Work

<Imperative advice. Start with a verb: "Always...", "Never...", "When X, do Y...",
"Check Z before starting...". Specific enough for a future agent to follow without
additional context.>

## Execution Context (optional)

**Phase origin:** <which phase produced this learning (e.g., Phase 6: Execution, Phase 7: Review)>
**Story context:** <which story from plan.md this relates to, if applicable>
**Decisions referenced:** <which locked decisions (D1, D2...) are relevant>
**Retry count:** <how many Worker retries were needed, if applicable (0 = first attempt)>
**Review feedback:** <key Reviewer feedback that led to this learning, if applicable>
**Execution mode:** <Sequential or Parallel>

This section may be omitted entirely if no execution metadata is relevant.
```

---

## Example

```markdown
---
date: 2026-03-15
feature: user-auth-refresh
categories: [pattern, failure]
severity: critical
tags: [auth, database, testing]
phase_origin: phase_6_execution
story_context: "Story 2: Token Refresh Endpoint"
decisions_referenced: [D3]
---

# Learning: Token Refresh Race Condition

**Category:** failure
**Severity:** critical
**Tags:** [auth, concurrency]
**Applicable-when:** Implementing any token refresh or session renewal with parallel requests

## What Happened

Two simultaneous requests both passed the "token not yet expired" check, both issued
new tokens, and both invalidated the old token. Discovered during load testing, not unit tests.

## Root Cause / Key Insight

The check-then-act was not atomic. Database read + write in two separate operations with
no locking. Unit tests mock the DB and never simulate concurrency.

## Recommendation for Future Work

When implementing any token rotation, use a database-level atomic operation (SELECT FOR UPDATE
or optimistic locking). Always add a concurrency integration test with 10 parallel requests.

## Execution Context

**Phase origin:** Phase 6 — Worker implementation
**Story context:** Story 2: Token Refresh Endpoint
**Decisions referenced:** D3 (JWT stateless auth)
**Retry count:** 1 (first attempt missed concurrency case)
**Review feedback:** Reviewer flagged missing atomic operation in token rotation
**Execution mode:** Sequential

---

# Learning: API Route + Zod Schema + Test Triad

**Category:** pattern
**Severity:** standard
**Tags:** [api, testing]
**Applicable-when:** Creating any new CRUD endpoint

## What Happened

Established pattern: each API route has co-located Zod schema and test file. Reduced
bugs from schema mismatches and made test coverage consistent.

## Root Cause / Key Insight

Co-location prevents drift between validation rules and tests. Schema changes immediately
surface failing tests in the same directory.

## Recommendation for Future Work

Always create route + schema + test as a triad. Never create an API route without its
corresponding Zod schema and test file in the same directory.
```

---

## Slug Naming Rules

- Format: `YYYYMMDD-<primary-topic>-<secondary-topic>`
- Lowercase, hyphens only
- Primary topic = most important domain (`auth`, `database`, `api`, `testing`)
- Secondary topic = specific problem or pattern (`token-refresh`, `scope-isolation`)
- Examples: `20260315-auth-token-refresh.md`, `20260320-bead-scope-isolation.md`

---

## critical-patterns.md Entry Format

When promoting to `.oh-my-beads/history/learnings/critical-patterns.md`:

```markdown
## [YYYYMMDD] <Learning Title>
**Category:** pattern | decision | failure
**Feature:** <feature-name>
**Tags:** [tag1, tag2]

<2-4 sentence summary. What happened, root cause, and what to do differently.
Enough that a reader can act on it without opening the full file.>

**Full entry:** history/learnings/YYYYMMDD-<slug>.md
```
