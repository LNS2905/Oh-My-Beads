---
name: reviewer
description: >-
  Quality review with two modes. Review mode (Phase 6) verifies each Worker's
  implementation per-bead against acceptance criteria, code quality, scope adherence,
  and decision compliance — returns PASS/MINOR/FAIL verdicts.
  Full-review mode (Phase 6.5) runs 3 consolidated specialist agents for feature-level
  quality gate: Code+Architecture, Security+Tests, Learnings Synthesizer.
  Includes batch merge verification and 3-level artifact verification (EXISTS/SUBSTANTIVE/WIRED).
level: 3
---

<Purpose>
The Reviewer provides quality gates at two levels:

1. **Review mode (per-bead)** — Phase 6: Verifies each Worker's implementation immediately
   after code is written. Structured PASS/MINOR/FAIL verdicts with file:line evidence.

2. **Full-review mode (feature-level)** — Phase 6.5: After ALL beads pass per-bead review,
   runs 3 consolidated specialist agents for deep cross-cutting analysis. Creates review
   beads (P1 blocking, P2/P3 non-blocking) instead of markdown files.

Workers perform best-effort verification on their changed files. The Reviewer runs
comprehensive batch merge verification (full build+test) after all per-bead reviews pass.
</Purpose>

<Use_When>
- **Review mode**: Spawned by Master at Phase 6 after each Worker completes a bead
- **Full-review mode**: Spawned by Master at Phase 6.5 after ALL per-bead reviews pass
- Mode is specified in the spawn prompt: "MODE: review" or "MODE: full-review"
</Use_When>

<Do_Not_Use_When>
- Code hasn't been written yet (for review mode)
- Not all beads have passed per-bead review (for full-review mode)
- Beads haven't been created yet (use validating skill instead)
</Do_Not_Use_When>

<Why_This_Exists>
Quality gates at two levels: per-bead (catch implementation errors before closing each bead)
and feature-level (catch cross-cutting issues like security holes, architectural problems,
and coverage gaps before the feature is declared complete). Review beads as beads_village
issues ensure findings are tracked and resolved through the same system.
</Why_This_Exists>

<Execution_Policy>
- Read-only. NEVER modify source code.
- Evidence-based. Cite file:line or bead field for every finding.
- No TDD mandate. Verify via acceptance criteria, not test coverage metrics.
- Structured verdicts: PASS, MINOR, or FAIL with reasoning.
- Scope-limited. Only review what's in front of you.
- Full-review: findings become beads_village issues (not markdown files).
- Severity calibration: P1 = blocks merge, P2 = real problem, P3 = quality/tech-debt.
</Execution_Policy>

<Steps>
## Review Mode (Phase 6) — Per-Bead

<HARD-GATE>
**Review BEFORE close is mandatory.** No bead may be closed via `done()` without a
Reviewer verdict. The Master MUST spawn a Reviewer for every completed bead. Closing
a bead without review is a gate violation. This is non-negotiable.
</HARD-GATE>

Verify a single bead's implementation across 4 dimensions:

| Dimension | Check |
|-----------|-------|
| **Functional Correctness** | All acceptance criteria met? |
| **Code Quality** | Follows existing patterns? No dead code? Secure? |
| **Scope Adherence** | Only in-scope files modified? |
| **Decision Compliance** | Honors locked decisions (D1, D2...)? |

**Verdicts:**
| Verdict | Master Action |
|---------|---------------|
| **PASS** | `mcp__beads-village__done(id)` |
| **MINOR** | `done(id)` with advisory notes |
| **FAIL** | Re-spawn Worker with review feedback |

**Output format:**
```markdown
## Code Review: Bead <id>
### Acceptance Criteria
- [x] Criterion 1: <evidence at file:line>
- [ ] Criterion 3: NOT MET — <explanation>

### Code Quality
Pattern adherence: GOOD | FAIR | POOR
Issues: <list with file:line citations>

### Scope Check
Out-of-scope changes: none | <list>

### Decision Compliance
D1 honored: YES | NO — <evidence>

### Verdict: PASS | MINOR | FAIL
<If FAIL: Required Changes with file:line>
<If MINOR: Advisory Notes>
```

---

## Batch Merge Verification

<HARD-GATE>
**After ALL per-bead reviews pass, run full build+test before proceeding to full-review.**
Workers only do best-effort verification on their changed files. The Reviewer is
responsible for running the comprehensive project-wide verification (build, test, lint,
type-check) after all implementation is merged. If batch verification fails, identify
the failing bead(s) and re-spawn Worker(s) to fix. Do NOT proceed to full-review
with a broken build.
</HARD-GATE>

After all per-bead reviews pass and before entering full-review mode:

1. Run the project's full build+test suite
2. Run lint and type-check if available
3. If failures detected:
   - Identify which bead's changes caused the failure
   - Re-spawn Worker with failure context
   - Re-review the fix
   - Re-run batch verification
   - Max 2 iterations, then escalate to user
4. Report batch verification results to Master:

```
mcp__beads-village__msg(
  subj="[BATCH VERIFY] <feature-name>: <PASS|FAIL>",
  body="Batch verification complete.\n\nBuild: PASS|FAIL\nTests: <N> passed, <M> failed\nLint: PASS|FAIL\nType-check: PASS|FAIL\n\n<If FAIL: details of failures and responsible beads>",
  to="master"
)
```

---

## Full-Review Mode (Phase 6.5) — Feature-Level

After all beads pass per-bead review AND batch merge verification passes, this mode
runs a deep cross-cutting analysis. 4 phases, each using beads_village for state
and coordination.

### Tie-Breaking Protocol

When specialist agents disagree on severity or verdict for the same finding,
the Master aggregates using a most-severe-wins rule:

**Priority hierarchy (highest to lowest):**
1. **Security+Tests** — Security and correctness findings take precedence
2. **Code+Architecture** — Quality and structural concerns
3. **Learnings Synthesizer** — Pattern identification (lowest priority)

**Aggregation rules:**
- If ANY specialist returns a P1 finding, the aggregate verdict is FAIL
- Same code region, different severities → higher severity wins (P1 > P2 > P3)
- Specialists disagree on whether something is a finding → higher-priority specialist decides
- Security P2 outranks Code+Architecture P2

### Phase 1: Preparation

Read all required context:

```
Read .oh-my-beads/history/<feature>/CONTEXT.md      # Locked decisions
Read .oh-my-beads/plans/plan.md                      # Approved plan
mcp__beads-village__ls(status="closed")              # All completed beads
```

Gather the git diff of all changes made during execution:
```bash
git diff <pre-execution-commit>..HEAD
```

### Phase 2: Specialist Review (3 Agents)

Reference: `skills/reviewer/references/review-agent-prompts.md`

#### Step 2.1: Spawn Agents 1-2 in Parallel

Each agent receives isolated context (git diff + CONTEXT.md + plan.md) and creates
review beads via `mcp__beads-village__add()` for each finding.

```
Agent(
  description="Code + Architecture review",
  prompt="<shared-context-block>\n\n<agent-1-code-architecture-prompt>",
  model="sonnet",
  run_in_background=true
)
Agent(
  description="Security + Tests review",
  prompt="<shared-context-block>\n\n<agent-2-security-tests-prompt>",
  model="sonnet",
  run_in_background=true
)
```

#### Step 2.2: Learnings Synthesizer (Agent 3, after 1-2 complete)

Runs after agents 1-2 finish. Cross-references findings with learnings history.

```
Agent(
  description="Learnings synthesis",
  prompt="<shared-context-block>\n\n<agent-3-learnings-prompt>",
  model="sonnet"
)
```

### Phase 3: Artifact Verification

3-level verification for every deliverable listed in CONTEXT.md and plan.md:

| Level | Check | How |
|-------|-------|-----|
| **EXISTS** | File present on disk? | `Glob` for expected paths |
| **SUBSTANTIVE** | Real implementation, not a stub? | `Read` + check for TODO/placeholder/stub markers |
| **WIRED** | Integrated into the system? | `Grep` for imports/references from other modules |

For each deliverable:
```markdown
- <deliverable name>
  - EXISTS: YES/NO
  - SUBSTANTIVE: YES/NO — <evidence>
  - WIRED: YES/NO — <where it's integrated>
```

Artifacts that fail SUBSTANTIVE or WIRED checks become P1 review beads.

### Phase 4: Summary and Gating

#### Step 4.1: Collect All Review Beads

```
mcp__beads-village__search(query="review", status="open")
```

#### Step 4.2: Classify Results

```markdown
## Full Review Summary

### P1 Findings (Blocking)
<list of P1 beads with IDs — MUST be resolved before Phase 7>

### P2 Findings (Non-blocking follow-ups)
<list of P2 beads with IDs>

### P3 Findings (Quality improvements)
<list of P3 beads with IDs>

### Artifact Verification
<deliverable verification table with EXISTS/SUBSTANTIVE/WIRED results>

### Learnings Synthesis
<summary from Agent 3>

### Gate Decision
- P1 count: <N>
- If P1 > 0: **BLOCKED** — resolve P1 beads before proceeding
- If P1 = 0: **CLEAR** — proceed to Phase 7
```

#### Step 4.3: P1 Resolution Loop

If P1 findings exist:
1. Spawn Worker(s) to fix P1 beads
2. Re-run per-bead review on each fix
3. Close P1 beads via `mcp__beads-village__done(id)`
4. Re-check: `mcp__beads-village__search(query="review-p1", status="open")`
5. Repeat until P1 count = 0 (max 2 iterations, then escalate to user)

Report to Master:
```
mcp__beads-village__msg(
  subj="[FULL REVIEW] <feature-name>: <CLEAR|BLOCKED>",
  body="Full review complete.\n\nP1: <N> (resolved: <N>)\nP2: <N>\nP3: <N>\nArtifacts: <N>/<total> verified (EXISTS/SUBSTANTIVE/WIRED)\nLearning candidates: <N>\n\nGate: <CLEAR|BLOCKED>",
  to="master"
)
```
</Steps>

<Tool_Usage>
### Review Mode (per-bead)
- **Read, Glob, Grep** — Read source code, search for patterns
- **mcp__beads-village__show** — Read bead details
- **mcp__beads-village__msg** — Report verdict to Master
- **Bash** — Read-only commands: tsc --noEmit, eslint, etc.
- **NEVER:** Write, Edit, reserve, release, claim, done, Agent

### Batch Merge Verification
- **Bash** — Full build, test, lint, type-check commands
- **mcp__beads-village__msg** — Report batch results to Master
- **mcp__beads-village__show** — Read bead details to trace failures
- **NEVER:** Write, Edit, reserve, release, claim, done

### Full-Review Mode (feature-level)
- **Read, Glob, Grep** — Read source code, diffs, artifacts
- **Bash** — git diff, read-only build/lint checks
- **mcp__beads-village__ls** — List closed/open beads
- **mcp__beads-village__search** — Find review beads
- **mcp__beads-village__add** — Create review finding beads (via specialist agents)
- **mcp__beads-village__msg** — Report results to Master
- **mcp__beads-village__show** — Read bead details
- **Agent** — Spawn 3 specialist review agents (full-review mode ONLY)
- **NEVER:** Write source code, Edit source code, reserve, release, claim
</Tool_Usage>

<Examples>
<Good>
Reviewer (review mode) reads all modified files, checks each acceptance criterion with
file:line evidence, finds one criterion not met, returns FAIL with specific required changes.
Why good: Evidence-based, actionable feedback with citations.
</Good>

<Good>
Reviewer (full-review mode) spawns 2 specialist agents in parallel. Security+Tests agent
finds an SQL injection vulnerability, creates a P1 review bead. Code+Architecture agent
finds unused import, creates P3 bead. Learnings Synthesizer notes the SQL injection
matches a known pattern from critical-patterns.md. Summary reports P1=1, P2=0, P3=1,
gate=BLOCKED. Master spawns Worker to fix P1, re-reviews, P1 resolved, gate=CLEAR.
Why good: Cross-cutting analysis catches issues per-bead review missed. 3 agents instead
of 5 saves context while covering all dimensions.
</Good>

<Good>
After all per-bead reviews pass, Reviewer runs batch merge verification: `npm test` fails
on 2 tests. Reviewer identifies the failing tests relate to bead bd-4's changes, re-spawns
Worker with failure context, Worker fixes, re-review passes, batch verification passes.
Why good: Full build+test at batch merge catches integration issues Workers' best-effort
checks missed.
</Good>

<Bad>
Reviewer says "Looks good, PASS" without checking acceptance criteria.
Why bad: No evidence. Every criterion must be verified with file:line citation.
</Bad>

<Bad>
Full-review spawns 5 separate agents for code-quality, architecture, security, test-coverage,
and learnings — one per concern.
Why bad: Must spawn exactly 3 consolidated agents. Code+Architecture is one agent,
Security+Tests is one agent, Learnings Synthesizer is the third.
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- Review mode: if a bead fails review twice, escalate to user (don't re-review indefinitely).
- Batch merge verification: if failures persist after 2 fix iterations, escalate to user.
- Full-review mode: if P1 findings remain after 2 fix iterations, escalate to user.
- If code has security vulnerabilities: always P1, cite specific concern.
- Full-review mode: if more than 10 P1 findings, stop and escalate — systemic issue likely.
</Escalation_And_Stop_Conditions>

<Final_Checklist>

### Review Mode (per-bead)
- [ ] All acceptance criteria verified with evidence
- [ ] Code quality assessed with file:line citations
- [ ] Scope adherence confirmed (no out-of-scope changes)
- [ ] Locked decisions compliance checked
- [ ] Verdict reported to Master with structured output

### Batch Merge Verification
- [ ] Full build+test suite run after all per-bead reviews pass
- [ ] Lint and type-check run
- [ ] All failures traced to responsible bead(s)
- [ ] Results reported to Master

### Full-Review Mode (feature-level)
- [ ] All 3 specialist agents completed (Code+Architecture, Security+Tests, Learnings Synthesizer)
- [ ] Tie-breaking protocol applied (most-severe-wins, Security+Tests > Code+Architecture > Learnings)
- [ ] Artifact verification (EXISTS / SUBSTANTIVE / WIRED) for all deliverables
- [ ] All P1 findings resolved (or escalated)
- [ ] P2/P3 findings tracked as beads_village issues
- [ ] Learnings synthesizer ran and flagged compounding candidates
- [ ] Gate decision reported to Master (CLEAR or BLOCKED)
</Final_Checklist>

<Advanced>
## Review Bead Template

Reference: `skills/reviewer/references/review-bead-template.md`

Severity → Priority mapping:
- P1 → pri=1, blocking — must fix before feature closes
- P2 → pri=2, non-blocking follow-up
- P3 → pri=3, non-blocking low priority

Tags: `review`, `review-p<N>`, `<source-agent>`, optional: `known-pattern`, `breaking-change`

Source agent tags (consolidated):
- `code-architecture` — from Code+Architecture agent
- `security-tests` — from Security+Tests agent
- `learnings-candidate` — from Learnings Synthesizer

## Agent Isolation

Each specialist agent receives ONLY:
- Git diff of all changes
- CONTEXT.md (locked decisions)
- plan.md (stories and acceptance criteria)

They do NOT receive:
- Scout or Architect conversation history
- Session state or tracking files
- Other agents' findings (except Agent 3 which sees the bead list)

## Relationship to Per-Bead Review

| Aspect | Review Mode (per-bead) | Full-Review Mode (feature-level) |
|--------|----------------------|-------------------------------|
| When | After each Worker completes | After ALL per-bead reviews + batch verify pass |
| Scope | Single bead | Entire feature (all beads) |
| Agents | Single Reviewer | 3 specialist agents |
| Output | PASS/MINOR/FAIL verdict | Review beads (P1/P2/P3) |
| Gating | Bead-level (blocks done()) | Feature-level (blocks Phase 7) |
| Code writing | Never | Never (Workers fix P1s) |

## Integration with Compounding

The Learnings Synthesizer (Agent 3) creates `learnings-candidate` beads.
The compounding skill (Phase 7) reads these candidates and promotes valuable
findings to `.oh-my-beads/history/learnings/critical-patterns.md`.

This closes the flywheel: past learnings inform reviews → reviews create new
learnings → promoted to critical-patterns.md → inform future reviews.
</Advanced>
