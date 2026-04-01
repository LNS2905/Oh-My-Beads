---
name: validating
description: >-
  Critical pre-execution gate with configurable depth. Verifies plan, beads, and
  dependencies across 8 structural dimensions. Adapts verification intensity based
  on feature size and Master-set depth (light/standard/deep). Monitors context budget
  at 65% threshold with handoff. Phase 4 of the 7-phase workflow.
level: 3
---

<Purpose>
The Validator ensures execution-readiness by verifying structural integrity of the plan,
beads, and their dependencies. It prevents the most expensive failure in agentic delivery:
launching execution against a plan that was never clear enough to deserve execution.

Validation depth adapts to feature complexity: small features (< 5 beads) get a lighter,
faster path; large or critical features get deep verification with extended spike analysis.
</Purpose>

<Use_When>
- Spawned by Master at Phase 4 (after Architect decomposition, before execution)
- All beads for the current phase have been created via Architect decomposition (Phase 3)
- Plan is persisted at `.oh-my-beads/plans/plan.md`
</Use_When>

<Do_Not_Use_When>
- Beads haven't been created yet (Architect must run first)
- Plan hasn't been approved by user (Gate 2 must pass)
</Do_Not_Use_When>

<HARD-GATE>
**Validation is a mandatory pre-execution gate. NEVER skip it.** Every feature —
regardless of size, complexity, or user request — must pass through this validation
before any Worker is spawned. The approval gate (Phase 5) is blocking: no execution
without explicit user approval. If a user asks to skip validation, explain that it
is a non-negotiable quality gate and proceed with the appropriate depth level instead.
</HARD-GATE>

## Depth Configuration

The Master sets the validation depth when spawning. If not specified, auto-detect from bead count.

| Depth | When Used | Dimensions | Max Iterations | Spikes | Polishing | Fresh-Eyes |
|-------|-----------|------------|----------------|--------|-----------|------------|
| **light** | < 5 beads or simple features | 4 key dimensions (2, 4, 5, 7) | 2 | Skip | Graph health + dedup only | Skip |
| **standard** | 5-15 beads, typical features | All 8 dimensions | 3 | HIGH-risk only | Full (6 rounds) | Yes |
| **deep** | > 15 beads or critical/high-risk features | All 8 dimensions | 4 | All risk levels | Full + cross-phase coherence | Yes + second pass |

**Auto-detection rules (when Master doesn't set depth):**
- Bead count < 5 → `light`
- Bead count 5-15 → `standard`
- Bead count > 15 → `deep`

Accept the depth parameter from the Master's spawn prompt. Log the depth in session state.

<Steps>

## Phase 0: Context Budget Baseline

<HARD-GATE>
**Monitor context budget throughout validation.** Before starting, note the current
context usage. If context usage reaches 65% at any point during validation, immediately
trigger the context budget handoff protocol (see Context Budget Monitoring section below).
Do NOT continue validation past 65% — write a handoff and stop.
</HARD-GATE>

Establish context baseline:
1. Note current context consumption estimate
2. Set 65% as the hard ceiling for validation work
3. If starting above 50%, prefer `light` depth regardless of Master's setting

## Phase 1: Structural Verification

**Maximum iterations determined by depth level. Nothing advances until this passes.**

### Step 1.1 — Determine Dimensions to Check

**Light depth (< 5 beads):** Check 4 key dimensions only:

| # | Dimension | Question |
|---|-----------|----------|
| 2 | **Story coverage** | Does every story map to at least one bead? |
| 4 | **Dependency correctness** | Is the graph acyclic with no missing or dangling deps? |
| 5 | **File scope isolation** | Can parallel-ready beads execute without file collisions? |
| 7 | **Verification completeness** | Does every bead have concrete acceptance criteria? |

**Standard/deep depth:** Check all 8 dimensions:

| # | Dimension | Question |
|---|-----------|----------|
| 1 | **Plan coherence** | Does the plan have clear stories with verifiable acceptance criteria? |
| 2 | **Story coverage** | Does every story map to at least one bead? |
| 3 | **Decision coverage** | Do locked decisions (D1, D2...) from CONTEXT.md map to beads? |
| 4 | **Dependency correctness** | Is the graph acyclic with no missing or dangling deps? |
| 5 | **File scope isolation** | Can parallel-ready beads execute without file collisions? |
| 6 | **Context budget** | Does every bead fit in one Worker context (< 2000 chars)? |
| 7 | **Verification completeness** | Does every bead have concrete acceptance criteria? |
| 8 | **Exit-state completeness** | If all beads close, is the feature actually delivered? |

### Step 1.2 — Spawn plan-checker

Load `skills/validating/references/plan-checker-prompt.md`. Spawn an isolated subagent:

```
Agent(
  description="Plan checker verification",
  prompt="<plan-checker-prompt.md content>\n\n## Depth: <light|standard|deep>\n## Dimensions to check: <list>\n\n## Inputs\n<all bead descriptions from ls()>\n<CONTEXT.md>\n<plan.md>",
  model="sonnet"
)
```

For **light** depth, instruct the plan-checker to only verify dimensions 2, 4, 5, 7.

### Step 1.3 — Triage results

**If all checked dimensions PASS:** proceed to Phase 2.

**If any dimension FAILS:**

1. Fix the specific issue:
   - Story/bead mapping → update beads via Master (`add()` or close duplicates)
   - Dependencies → add/remove deps via Master
   - File scope → split beads or add dependency ordering
   - Verification → add acceptance criteria to beads
   - (Standard/deep only) Plan coherence → revise `plan.md`
   - (Standard/deep only) Decision coverage → update bead descriptions
   - (Standard/deep only) Context budget → split oversized beads
   - (Standard/deep only) Exit-state → revise plan or add missing beads
2. Re-run the checker (counts as next iteration)

**Iteration limits by depth:**
- **light:** max 2 iterations → escalate after 2
- **standard:** max 3 iterations → escalate after 3
- **deep:** max 4 iterations → escalate after 4

After max iterations with any FAIL still present: stop, escalate to user, explain which
dimension is still failing and why. Do not attempt further iterations.

## Phase 2: Spike Execution

**Light depth: skip entirely.** Proceed to Phase 3.

**Standard depth:** Run for HIGH-risk items only from the plan's Risk Assessment.

**Deep depth:** Run for all identified risk items (HIGH and MEDIUM).

**If no applicable risk items exist, skip to Phase 3.**

### Step 2.1 — Create spike beads

```
mcp__beads-village__add(
  title="Spike: <specific yes/no question>",
  typ="task", pri=0,
  desc="## Spike Question\n<yes/no question>\n## Time Box\n30 minutes\n## Success: YES means...\n## Failure: NO means..."
)
```

### Step 2.2 — Execute spikes

For each spike, spawn an isolated subagent:

```
Agent(
  description="Spike: <question>",
  prompt="Investigate this specific question within 30 minutes. Write findings. Conclude with YES or NO.",
  model="sonnet"
)
```

### Step 2.3 — Act on results

**YES:** Embed spike findings into affected bead descriptions. Update plan if constraints tightened.

**NO:** Proceed to Spike Failure Protocol (Step 2.4).

### Step 2.4 — Spike Failure Protocol

When a spike returns NO (risk not mitigated):

1. **Record the failure.** Write the spike question, findings, and NO conclusion into
   `plan.md` Risk Assessment section as a documented blocker.

2. **Track spike outcome in session state.**

3. **Present 3 options to the user:**
   ```
   AskUserQuestion: "Spike failed: '<spike question>' returned NO. How do you want to proceed?"
   Options:
     1. "Reduce scope" — Remove the risky story/bead and proceed without it
     2. "Accept risk" — Proceed despite the unmitigated risk (documented in plan)
     3. "Revise plan" — Return to Phase 2 (Architect planning) with spike findings
   ```

4. **Act on user choice:**
   - **Reduce scope:** Close affected bead(s), re-run `bv_insights()`, continue
   - **Accept risk:** Add risk notice to beads, update plan, continue
   - **Revise plan:** Update session state to `phase_2_planning`, pass findings to Architect

5. **Multiple spike failures:** Present each independently. User may choose different
   options for different spikes.

## Phase 3: Bead Polishing

**Light depth:** Run Rounds 1 and 4 only (graph health + deduplication). Skip other rounds.

**Standard depth:** Run all 6 rounds.

**Deep depth:** Run all 6 rounds + extra cross-phase coherence check.

### Round 1: Graph health

```
mcp__beads-village__bv_insights()
```

Fix cycles, bottlenecks, disconnected beads, and orphaned work.

### Round 2: Priority sanity (standard/deep only)

```
mcp__beads-village__bv_priority()
```

Adjust priorities if foundational work is buried below dependent work.

### Round 3: Execution plan review (standard/deep only)

```
mcp__beads-village__bv_plan()
```

Verify parallel execution tracks make sense and no track is overloaded.

### Round 4: Deduplication

Read all bead titles/descriptions from `mcp__beads-village__ls(status="open")`:
- Same story + same file scope + same goal → close redundant
- Same outcome expressed as two beads → merge

### Round 5: Fresh-eyes review (standard/deep only)

Load `skills/validating/references/bead-reviewer-prompt.md`. Spawn a subagent:

```
Agent(
  description="Fresh-eyes bead review",
  prompt="<bead-reviewer-prompt.md content>\n\n## All Beads\n<all bead descriptions>",
  model="sonnet"
)
```

Fix all CRITICAL flags before proceeding. MINOR flags are judgment calls.

**Deep depth only — second pass:** If CRITICAL flags were fixed, re-run fresh-eyes review
to confirm fixes are adequate.

### Round 6: Story-to-bead coherence (standard/deep only)

Cross-check plan stories against beads:
- Every story should map to at least one bead
- Every bead should belong to a story
- If a story has too many beads (> 5), flag for splitting
- If a bead spans multiple unrelated stories, flag for cleanup

**Deep depth bonus — Cross-phase coherence:**
If this is not the first phase in a phase-at-a-time flow, verify:
- Beads from the current phase don't duplicate work from completed phases
- Dependencies on completed-phase artifacts are explicit
- No regression risk from current-phase changes to completed-phase files

## Phase 4: Exit-State Readiness Review

**Light depth:** Ask questions 1 and 4 only.

**Standard/deep depth:** Ask all 4 questions.

1. If all beads close successfully, will all plan stories actually be done?
2. Does the plan's verification strategy still hold after polishing changes?
3. Are all risk items resolved (spikes passed or items descoped)?
4. Would a fresh Worker understand each bead without external context?

If any answer is "no" or "not sure", route back:
- Story completeness → add missing beads or update plan
- Verification gaps → add acceptance criteria
- Risk gaps → add spikes or descope
- Bead clarity → update bead descriptions

## Phase 5: Final Approval Gate

<HARD-GATE>
**This gate is mandatory and blocking (HITL Gate 3).** No execution begins without
explicit user approval at this gate. Present the structured summary and wait for
the user's decision. Do NOT auto-approve, do NOT skip this gate, do NOT proceed
on timeout.
</HARD-GATE>

Present structured summary to user:

```
VALIDATION COMPLETE — APPROVAL REQUIRED BEFORE EXECUTION

Validation Depth: <light|standard|deep>
Bead Count: <N> (threshold: < 5 beads → light path)

Plan Summary:
- Feature: <name>
- Stories: <N>
- Beads: <N>

Structural Verification:
- Dimensions checked: <4 or 8> (depth: <light|standard|deep>)
- Result: PASS (after <N> iterations)

Spike Results: <skipped (light) | N items checked | no HIGH-risk items>

Polishing Results:
- Graph issues fixed: <N>
- Duplicates removed: <N>
- Fresh-eyes review: <skipped (light) | N CRITICAL fixed>

Exit-State Readiness:
- Key questions verified: <2 or 4>

Unresolved concerns:
- <none | list>

Choose execution mode:
```

```
AskUserQuestion: "All beads validated. Choose execution mode."
Options: [Sequential (safer, one at a time), Parallel (faster, concurrent workers)]
```

### If user approves

Update session state:
```json
{
  "current_phase": "phase_4_validated",
  "validation_passed": true,
  "validation_depth": "<light|standard|deep>",
  "execution_mode": "<sequential|parallel>",
  "stories_count": N,
  "beads_count": N
}
```

Handoff: `Validation complete (depth: <level>). Proceed to Phase 5 execution.`

### If user rejects

Ask what concerns them and route back:
1. Story coverage → Phase 3 Round 6
2. Risk/spike concern → Phase 2
3. Bead quality → Phase 3 Round 5
4. Fundamental approach → escalate to Architect replanning

</Steps>

## Context Budget Monitoring

<HARD-GATE>
**Hard ceiling: 65% context usage.** If context consumption reaches 65% at any point
during validation, stop current work and execute the handoff protocol immediately.
Do NOT attempt to "finish quickly" — write the handoff and stop.
</HARD-GATE>

**Monitoring checkpoints:** Check context usage at:
- Start of each Phase (0-5)
- After each structural verification iteration
- After each spike execution
- After each polishing round

**When 65% threshold is crossed:**

1. **Stop current work** — do not start new subagents or verification rounds
2. **Write handoff** to `.oh-my-beads/handoffs/validation-handoff.md`:

```markdown
## Validation Handoff — Context Budget Exceeded

### Progress
- Depth: <light|standard|deep>
- Bead count: <N>
- Phase reached: <Phase N, Step X.Y>
- Context usage at handoff: ~<N>%

### Completed
- Structural verification: <PASS/IN_PROGRESS — iteration N of max>
  - Dimensions passed: <list>
  - Dimensions failed: <list or none>
- Spikes: <completed/skipped/in_progress — N of M done>
- Polishing: <completed/skipped/in_progress — round N of 6>
- Exit-state: <completed/not_started>
- Approval gate: <not_reached>

### Remaining Work
- <specific phases/rounds still needed>

### Artifacts
- plan.md: <path>
- CONTEXT.md: <path>
- Bead IDs checked: <list>

### Resume Instructions
Re-spawn validating skill with:
- depth: <same depth>
- resume_from: "<Phase N, Step X.Y>"
- completed_dimensions: [<list>]
```

3. **Update session state:**
```json
{
  "current_phase": "phase_4_validation",
  "validation_paused": true,
  "validation_resume_point": "<Phase N, Step X.Y>",
  "context_budget_exceeded": true
}
```

4. **Report to Master:** `Validation paused at 65% context. Handoff written. Resume with fresh context.`

<Tool_Usage>
- **Agent** — Spawn plan-checker, bead-reviewer, spike subagents
- **mcp__beads-village__ls, show** — Read bead state
- **mcp__beads-village__bv_insights** — Graph health analysis
- **mcp__beads-village__bv_priority** — Priority recommendations (standard/deep)
- **mcp__beads-village__bv_plan** — Parallel execution tracks (standard/deep)
- **mcp__beads-village__graph** — Dependency visualization
- **mcp__beads-village__add** — Create spike beads (via Master)
- **mcp__beads-village__done** — Close duplicate/spike beads (via Master)
- **Read, Glob, Grep** — Read plan, CONTEXT.md, bead content
- **AskUserQuestion** — Gate 3 approval (HARD-GATE: mandatory)
- **NEVER:** Write/Edit source code, reserve, release, claim
</Tool_Usage>

<Red_Flags>

## Red Flags

Stop and self-correct if you catch yourself doing any of these:
- **Skipping validation** — even for small features, run the light path (HARD-GATE)
- **Ignoring depth level** — running all 8 dimensions for a 3-bead feature wastes context
- **Exceeding 65% context** — stop and handoff, do not try to finish
- **Auto-approving Gate 3** — the approval gate is blocking; wait for user
- **Running spikes on light depth** — light skips spikes entirely
- **Skipping fresh-eyes on standard** — standard requires all 6 polishing rounds
- **Continuing after max iterations** — if structural verification fails at the limit, escalate
- **Modifying source code** — validation is read-only; never edit implementation files
</Red_Flags>

<Examples>
<Good>
Feature has 3 beads. Master sets depth=light. Validator checks dimensions 2, 4, 5, 7 only.
All pass on iteration 1. Skips spikes, runs graph health + dedup only. Presents approval gate.
Why good: Appropriate depth for small feature. Fast validation without wasting context.
</Good>

<Good>
Feature has 12 beads. Standard depth. Plan-checker finds Dimension 5 FAIL: beads bd-3 and
bd-5 both modify src/api/routes.ts. Adds dependency, re-runs, all 8 dimensions PASS on
iteration 2. Full polishing with fresh-eyes review. Presents approval gate.
Why good: Caught file collision. Full verification appropriate for medium feature.
</Good>

<Good>
Context usage reaches 65% during Phase 3 Round 4. Validator stops immediately, writes
handoff with completed dimensions and resume point. Reports to Master.
Why good: Respected the hard ceiling. Handoff enables clean resume with fresh context.
</Good>

<Bad>
Feature has 2 beads but validator runs all 8 dimensions, spikes, and full 6-round polishing.
Why bad: Wasted context budget on light-path-eligible feature. Should use depth=light.
</Bad>

<Bad>
Validator sees context at 70% but tries to "quickly finish" Phase 3.
Why bad: 65% is the hard ceiling. Stop and handoff immediately.
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- Structural verification fails after max iterations (2/3/4 by depth): escalate to user
- Spike returns NO: present 3-option Spike Failure Protocol
- Fresh-eyes review finds > 5 CRITICAL flags: note plan needs significant rework
- Context budget exceeds 65%: write handoff, stop, report to Master
- User rejects at Gate 3: route to specific concern area
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] Depth determined (light/standard/deep — from Master or auto-detected from bead count)
- [ ] Context budget baseline established (65% hard ceiling)
- [ ] Structural dimensions verified (4 for light, 8 for standard/deep)
- [ ] Iteration limit respected (2/3/4 by depth)
- [ ] Spikes executed if applicable (skip for light, HIGH-risk for standard, all for deep)
- [ ] Polishing completed at appropriate depth
- [ ] Fresh-eyes review completed (standard/deep only)
- [ ] Exit-state readiness confirmed
- [ ] User approval obtained at Gate 3 (HARD-GATE: mandatory, blocking)
- [ ] Session state updated with execution mode and validation depth
- [ ] Context budget never exceeded 65% (or handoff written if it did)
</Final_Checklist>

<Advanced>
## Depth Decision Matrix

| Signal | Depth |
|--------|-------|
| Bead count < 5 | light |
| Bead count 5-15 | standard |
| Bead count > 15 | deep |
| Master explicitly sets depth | use Master's setting |
| Context usage > 50% at start | prefer light regardless |
| Feature flagged as critical by plan | prefer deep regardless |
| Phase-at-a-time (not first phase) | prefer standard minimum |

## Relationship to Old 5-Phase Structure

The old validating skill had 5 sequential phases with no depth adaptation.
The new structure preserves all verification capabilities but makes them configurable:

| Old Structure | New Structure |
|---------------|---------------|
| Phase 1: All 8 dimensions, 3 iterations | Phase 1: 4 or 8 dimensions, 2-4 iterations by depth |
| Phase 2: All spikes always | Phase 2: Skip (light), HIGH-only (standard), all (deep) |
| Phase 3: All 6 rounds always | Phase 3: 2 rounds (light), 6 rounds (standard/deep) |
| Phase 4: All 4 questions | Phase 4: 2 questions (light), 4 questions (standard/deep) |
| Phase 5: Approval gate | Phase 5: Approval gate (unchanged — always mandatory) |

## Lightweight Mode Summary (< 5 beads)

For features with fewer than 5 beads, the light depth path provides:
1. 4 key structural dimensions (story coverage, dependencies, file scope, verification)
2. Max 2 verification iterations
3. No spike execution
4. Graph health + deduplication only (skip priority, execution plan, fresh-eyes, coherence)
5. 2 exit-state questions (story completion + bead clarity)
6. Mandatory approval gate (unchanged)

This reduces validation time and context consumption by ~60% while preserving the
checks most likely to catch structural failures in small features.
</Advanced>
