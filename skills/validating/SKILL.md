---
name: validating
description: >-
  Critical gate between planning and execution. Verifies the plan, story map, and
  bead graph across 8 structural dimensions, executes time-boxed spikes for HIGH-risk
  items, polishes beads with beads_village graph analytics, and requires explicit user
  approval before any code is written. Phase 5 of the 8-step workflow.
level: 3
---

<Purpose>
The Validator ensures execution-readiness by verifying structural integrity of the plan,
beads, and their dependencies. It prevents the most expensive failure in agentic delivery:
launching execution against a plan that was never clear enough to deserve execution.

A bead set can look tidy while still being structurally broken. The Validator answers:
- If all beads finish, will the plan's stories actually be complete?
- If all stories finish, will the feature actually be delivered?
- Are there scope collisions that would cause Worker conflicts?
- Are HIGH-risk items resolved before committing to execution?
</Purpose>

<Use_When>
- Spawned by Master at Phase 5 (after Architect decomposition, before execution)
- All beads have been created via Architect decomposition (Phase 4)
- Plan is persisted at `.oh-my-beads/plans/plan.md`
</Use_When>

<Do_Not_Use_When>
- Beads haven't been created yet (Architect must run first)
- Plan hasn't been approved by user (Gate 2 must pass)
- User explicitly requests skipping validation for trivial single-bead work
</Do_Not_Use_When>

<Why_This_Exists>
The old Phase 5 Reviewer (validate mode) checked 6 dimensions on bead descriptions only.
This enhanced validation also checks plan-to-bead coherence, exit-state completeness,
risk alignment with spikes, graph health via beads_village analytics, and fresh-eyes
bead review. It catches structural problems that individual bead audits miss.
</Why_This_Exists>

<Execution_Policy>
- Follow all 5 phases in order. No skipping.
- Phase 1 allows max 3 iterations. Escalate after that.
- Read-only. NEVER modify source code.
- beads_village is the source of truth for graph state.
- The approval gate (Phase 5) is mandatory and blocking.
</Execution_Policy>

<Steps>
## Phase 1: Structural Verification

**Maximum 3 iterations. Nothing advances until this passes.**

### Step 1.1 — Spawn plan-checker

Load `skills/validating/references/plan-checker-prompt.md`. Spawn an isolated subagent:

```
Agent(
  description="Plan checker verification",
  prompt="<plan-checker-prompt.md content>\n\n## Inputs\n<all bead descriptions from ls()>\n<CONTEXT.md>\n<plan.md>",
  model="sonnet"
)
```

The plan-checker verifies 8 dimensions:

| # | Dimension | Question |
|---|-----------|----------|
| 1 | **Plan coherence** | Does the plan have clear stories with verifiable acceptance criteria? |
| 2 | **Story coverage** | Does every story map to at least one bead? |
| 3 | **Decision coverage** | Do locked decisions (D1, D2...) from CONTEXT.md map to beads? |
| 4 | **Dependency correctness** | Is the graph acyclic with no missing or dangling deps? |
| 5 | **File scope isolation** | Can parallel-ready beads execute without file collisions? |
| 6 | **Context budget** | Does every bead fit in one Worker context (<2000 chars)? |
| 7 | **Verification completeness** | Does every bead have concrete acceptance criteria? |
| 8 | **Exit-state completeness** | If all beads close, is the feature actually delivered? |

### Step 1.2 — Triage results

**If all 8 dimensions PASS:** proceed to Phase 2.

**If any dimension FAILS:**

1. Fix the specific issue in the relevant artifact:
   - Plan coherence → revise `plan.md`
   - Story/bead mapping → update beads via Master (`add()` or close duplicates)
   - Decision coverage → update bead descriptions to reference decisions
   - Dependencies → add/remove deps via Master
   - File scope → split beads or add dependency ordering
   - Context budget → split oversized beads
   - Verification → add acceptance criteria to beads
   - Exit-state → revise plan or add missing beads
2. Re-run the checker (counts as next iteration)

After 3 iterations with any FAIL still present: stop, escalate to user, explain which dimension
is still failing and why. Do not attempt iteration 4.

## Phase 2: Spike Execution

Run for every HIGH-risk item from the plan's Risk Assessment section.

**If no HIGH-risk items exist, skip to Phase 3.**

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

When a spike returns NO (risk not mitigated), do NOT silently stop. Instead, give the user
an informed choice with full context.

1. **Record the failure.** Write the spike question, findings, and NO conclusion into
   `plan.md` Risk Assessment section as a documented blocker.

2. **Track spike outcome in session state.** Update `.oh-my-beads/state/session.json`:
   ```json
   {
     "spike_outcomes": [
       {
         "spike_question": "<the yes/no question>",
         "result": "NO",
         "findings_summary": "<1-2 sentence summary of what was discovered>",
         "affected_stories": ["Story N", ...],
         "timestamp": "<ISO 8601>"
       }
     ]
   }
   ```
   This feeds into the compounding learnings system so future plans benefit from spike results.

3. **Present 3 options to the user:**

   ```
   AskUserQuestion: "Spike failed: '<spike question>' returned NO. How do you want to proceed?"
   Options:
     1. "Reduce scope" — Remove the risky story/bead from the plan and proceed without it
     2. "Accept risk" — Proceed with execution despite the unmitigated risk (documented in plan)
     3. "Revise plan" — Return to Phase 2 (Architect planning) with spike findings as new constraints
   ```

4. **Act on user choice:**

   **Option 1 — Reduce scope:**
   - Close the affected bead(s) via Master (`done()` with msg "Descoped due to spike failure")
   - Remove or mark the affected story as descoped in `plan.md`
   - Re-run `bv_insights()` to verify the remaining graph is still healthy
   - Continue to Phase 3 (Bead Polishing)

   **Option 2 — Accept risk:**
   - Add a prominent risk notice to each affected bead description:
     `"WARNING: Unmitigated risk — <spike question>. User accepted risk on <date>."`
   - Update `plan.md` Risk Assessment to mark the item as "ACCEPTED (unmitigated)"
   - Continue to Phase 3 (Bead Polishing)

   **Option 3 — Revise plan:**
   - Update session state: `"current_phase": "phase_2_planning"` (return to Phase 2)
   - Pass spike findings as additional constraints to the Architect:
     ```
     Constraint from spike failure:
     - Question: <spike question>
     - Finding: <summary>
     - Implication: <what approach is ruled out>
     ```
   - The Architect must produce a revised plan that avoids the failed spike's risk area
   - After the revised plan, the full Phase 3-5 cycle restarts

5. **If multiple spikes fail:** Present each spike failure independently. The user may choose
   different options for different spikes (e.g., reduce scope for one, accept risk for another).

## Phase 3: Bead Polishing

Multiple rounds. Quality compounds here.

### Round 1: Graph health

```
mcp__beads-village__bv_insights()
```

Fix cycles, bottlenecks, disconnected beads, and orphaned work. Re-run if critical findings remain.

### Round 2: Priority sanity

```
mcp__beads-village__bv_priority()
```

Adjust priorities if the graph says foundational work is buried below dependent work.

### Round 3: Execution plan review

```
mcp__beads-village__bv_plan()
```

Verify the parallel execution tracks make sense and no track is overloaded.

### Round 4: Deduplication

Read all bead titles and descriptions from `mcp__beads-village__ls(status="open")`:
- Same story + same file scope + same goal → likely duplicate → close redundant
- Same outcome expressed as two beads → merge

### Round 5: Fresh-eyes review

Load `skills/validating/references/bead-reviewer-prompt.md`. Spawn a subagent with the full bead set:

```
Agent(
  description="Fresh-eyes bead review",
  prompt="<bead-reviewer-prompt.md content>\n\n## All Beads\n<all bead descriptions>",
  model="sonnet"
)
```

Fix all CRITICAL flags before proceeding. MINOR flags are judgment calls.

### Round 6: Story-to-bead coherence

Cross-check plan stories against beads:
- Every story should map to at least one bead
- Every bead should belong to a story
- If a story has too many beads (>5), it may be too large — flag
- If a bead spans multiple unrelated stories, the decomposition is muddy — flag

## Phase 4: Exit-State Readiness Review

Ask these questions explicitly:

1. If all beads close successfully, will all plan stories actually be done?
2. Does the plan's verification strategy still hold after polishing changes?
3. Are all HIGH-risk items resolved (spikes passed or items descoped)?
4. Would a fresh Worker understand each bead without external context?

If any answer is "no" or "not sure", route back:
- Story completeness → add missing beads or update plan
- Verification gaps → add acceptance criteria
- Risk gaps → add spikes or descope
- Bead clarity → update bead descriptions

## Phase 5: Final Approval Gate

**This gate is mandatory and blocking (HITL Gate 3).**

Present structured summary to user:

```
VALIDATION COMPLETE — APPROVAL REQUIRED BEFORE EXECUTION

Plan Summary:
- Feature: <name>
- Stories: <N>
- Beads: <N>

Structural Verification:
- All 8 dimensions: PASS (after <N> iterations)

Spike Results:
- HIGH-risk items: <N>
- Result: <all passed / concerns listed>

Polishing Results:
- Graph issues fixed: <N>
- Priority adjustments: <N>
- Duplicates removed: <N>
- Fresh-eyes CRITICAL flags fixed: <N>

Exit-State Readiness:
- Story coverage complete: YES
- Verification strategy solid: YES
- Risk items resolved: YES
- Bead clarity sufficient: YES

Unresolved concerns:
- <none | list>

Choose execution mode:
```

```
AskUserQuestion: "All beads validated. Choose execution mode."
Options: [Sequential (safer, one at a time), Parallel (faster, concurrent workers)]
```

### If user approves

Update `.oh-my-beads/state/session.json`:
```json
{
  "current_phase": "phase_5_validated",
  "validation_passed": true,
  "execution_mode": "<sequential|parallel>",
  "stories_count": N,
  "beads_count": N
}
```

Handoff: `Validation complete. Plan, stories, and beads all pass. Proceed to Phase 6 execution.`

### If user rejects

Ask what concerns them and route back:
1. Story coverage or completeness → Phase 3 Round 6
2. Risk/spike concern → Phase 2
3. Bead quality → Phase 3 Round 5
4. Fundamental approach → escalate to Architect replanning
</Steps>

<Tool_Usage>
- **Agent** — Spawn plan-checker, bead-reviewer, spike subagents
- **mcp__beads-village__ls, show** — Read bead state
- **mcp__beads-village__bv_insights** — Graph health analysis
- **mcp__beads-village__bv_priority** — Priority recommendations
- **mcp__beads-village__bv_plan** — Parallel execution tracks
- **mcp__beads-village__graph** — Dependency visualization
- **mcp__beads-village__add** — Create spike beads (via Master)
- **mcp__beads-village__done** — Close duplicate/spike beads (via Master)
- **Read, Glob, Grep** — Read plan, CONTEXT.md, bead content
- **AskUserQuestion** — Gate 3 approval
- **NEVER:** Write/Edit source code, reserve, release, claim
</Tool_Usage>

<Examples>
<Good>
Plan-checker finds Dimension 5 FAIL: beads bd-3 and bd-5 both modify src/api/routes.ts
with no dependency between them. Validator adds a dependency (bd-5 depends on bd-3),
re-runs checker, all 8 dimensions PASS on iteration 2.
Why good: Caught a file collision that would have caused Worker conflicts at runtime.
</Good>

<Bad>
Validator sees 2 CRITICAL flags in fresh-eyes review but proceeds to approval gate anyway.
Why bad: CRITICAL flags must be fixed before approval. They indicate execution failures.
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- Structural verification fails after 3 iterations: escalate to user with failing dimensions
- Spike returns NO: present 3-option Spike Failure Protocol (reduce scope / accept risk / revise plan)
- Fresh-eyes review finds >5 CRITICAL flags: note plan needs significant rework
- User rejects at Gate 3: route to specific concern area, do not guess
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] All 8 structural dimensions verified (max 3 iterations)
- [ ] All HIGH-risk spikes executed and resolved
- [ ] Graph health checked (bv_insights — no cycles/bottlenecks)
- [ ] Priorities aligned (bv_priority — foundational work first)
- [ ] Execution tracks reviewed (bv_plan — no overloaded tracks)
- [ ] Duplicates removed
- [ ] Fresh-eyes review: all CRITICAL flags fixed
- [ ] Story-to-bead coherence confirmed
- [ ] Exit-state readiness questions all answered YES
- [ ] User approval obtained at Gate 3
- [ ] Session state updated with execution mode
</Final_Checklist>

<Advanced>
## Lightweight Mode

For confirmed LOW-risk single-story, single-bead work:

1. Abbreviated structural verification (dimensions 4-7 only)
2. Skip spikes (Phase 2)
3. Run `bv_insights()` only
4. Still require the final approval gate (Phase 5)

If uncertain, use full mode.

## Relationship to Existing Reviewer

The validating skill subsumes and extends the old Reviewer validate mode:

| Old Reviewer (6 dimensions) | Validating (8 dimensions + polishing) |
|------------------------------|---------------------------------------|
| Clarity | Dimension 7: Verification completeness |
| Scope | Dimension 5: File scope isolation |
| Dependencies | Dimension 4: Dependency correctness |
| Acceptance Criteria | Dimension 7: Verification completeness |
| Context Budget | Dimension 6: Context budget |
| Completeness | Dimension 2: Story coverage |
| — | Dimension 1: Plan coherence (NEW) |
| — | Dimension 3: Decision coverage (NEW) |
| — | Dimension 8: Exit-state completeness (NEW) |
| — | Spike execution (NEW) |
| — | Graph analytics polishing (NEW) |
| — | Fresh-eyes bead review (NEW) |
| — | Story-to-bead coherence (NEW) |

The Reviewer's review mode (Phase 7, per-bead implementation review) remains unchanged.
</Advanced>
