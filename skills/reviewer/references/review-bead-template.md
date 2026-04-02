# Review Bead Template

Review findings are beads, not markdown files. Every finding from review agents
becomes a beads_village issue with full detail in the bead body.

Referenced by: `skills/reviewer/references/review-agent-prompts.md`, `skills/reviewer/SKILL.md`

---

## Severity → Priority Mapping

| Severity | Priority | Merge Impact | Bead Relationship |
|----------|----------|-------------|-------------------|
| **P1** | pri=1 | **Blocking** — must fix before feature closes | Same feature, deps on parent bead |
| **P2** | pri=2 | **Non-blocking** — follow-up work | Standalone, labeled for tracking |
| **P3** | pri=3 | **Non-blocking** — low priority improvement | Standalone, labeled for tracking |

---

## Labels

Every review bead MUST have these tags:
- `review` — identifies it as a review finding
- `review-p1`, `review-p2`, or `review-p3` — severity tag
- Source agent tag: `code-architecture`, `security-tests`, or `learnings-candidate`

Optional additional tags:
- `known-pattern` — matches an entry in critical-patterns.md
- `breaking-change` — introduces breaking change to existing behavior
- `migration-risk` — requires data migration or schema change
- `needs-human-review` — cannot be resolved by automated agents

---

## Title Pattern

```
Review P<severity>: <concise problem title>
```

Examples:
- `Review P1: SQL injection in user search endpoint`
- `Review P2: Missing error boundary in dashboard component`
- `Review P3: Unused helper function in utils.ts`

---

## Description Template

```markdown
## Problem
<Clear statement of what is wrong and where>

## Evidence
**File:** <path/to/file>
**Lines:** <start-end>
**Code:**
```
<relevant code snippet>
```
**Why it matters:** <impact — user-facing, security, performance, maintainability>

## Proposed Solutions

### Option A: <name> (Recommended)
<description>
- Effort: <Small / Medium / Large>
- Risk: <Low / Medium / High>

### Option B: <name>
<description>
- Effort: <Small / Medium / Large>
- Risk: <Low / Medium / High>

## Acceptance Criteria
- [ ] <specific, verifiable criterion>
- [ ] <specific, verifiable criterion>
- [ ] No regressions in existing tests
```

---

## beads_village Create Commands

### P1 Finding (Blocking)

```
mcp__beads-village__add(
  title="Review P1: <problem title>",
  typ="bug",
  pri=1,
  desc="## Problem\n<description>\n\n## Evidence\n**File:** <path>\n**Lines:** <N-M>\n\n## Proposed Fix\n<specific fix>\n\n## Acceptance Criteria\n- [ ] <criterion>",
  tags=["review", "review-p1", "<source-agent>"]
)
```

Source agent tags: `code-architecture`, `security-tests`

P1 beads block the feature from closing. They must be resolved during Phase 6
before the Master can proceed to Phase 7.

### P2 Finding (Non-blocking follow-up)

```
mcp__beads-village__add(
  title="Review P2: <problem title>",
  typ="bug",
  pri=2,
  desc="## Problem\n<description>\n\n## Evidence\n**File:** <path>\n**Lines:** <N-M>\n\n## Proposed Fix\n<specific fix>\n\n## Acceptance Criteria\n- [ ] <criterion>",
  tags=["review", "review-p2", "<source-agent>"]
)
```

### P3 Finding (Non-blocking, low priority)

```
mcp__beads-village__add(
  title="Review P3: <problem title>",
  typ="chore",
  pri=3,
  desc="## Problem\n<description>\n\n## Evidence\n**File:** <path>\n**Lines:** <N-M>\n\n## Proposed Fix\n<specific fix>",
  tags=["review", "review-p3", "<source-agent>"]
)
```

### Learnings Candidate

```
mcp__beads-village__add(
  title="Learning candidate: <pattern name>",
  typ="chore",
  pri=3,
  desc="## Pattern\n<what keeps happening>\n\n## Evidence\n<review beads>\n\n## Prevention Rule\n<how to catch earlier>\n\n## Compounding Action\n<what to add to critical-patterns.md>",
  tags=["review", "learnings-candidate"]
)
```

---

## Review Bead Lifecycle

```
Agent creates bead via add()
  → P1: Must be resolved before feature closes
     → Worker re-spawned to fix → Reviewer re-verifies → done()
  → P2/P3: Tracked as follow-up work
     → Remain open after feature closes
     → Can be claimed in future sessions
```

---

## Deprecation Note

Per-finding markdown files (`.md` in a findings/ directory) are retired.
Review issues are now beads with full detail in the bead body.
The only markdown artifact allowed is the learnings-synthesizer's
session-level summary reported via `mcp__beads-village__msg()`.
