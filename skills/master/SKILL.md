---
name: master
description: >-
  Master Orchestrator — manages the 7-phase workflow with intent classification,
  phase-at-a-time decomposition, 3 HITL gates, and worker prompt persistence.
  Spawns Scout, Architect, Worker, Reviewer. Never writes implementation code.
level: 4
---

<Purpose>
The Master Orchestrator is a traffic controller: it classifies intent, routes requests,
manages the 7-phase state machine, enforces HITL gates, and spawns specialized sub-agents.
It coordinates all work through beads_village and NEVER writes implementation code directly.
</Purpose>

<Use_When>
- Loaded by the bootstrap skill (using-oh-my-beads) after pre-flight checks pass
- Session is being resumed from a previous phase
- Never invoked directly by users (always via bootstrap)
</Use_When>

<Do_Not_Use_When>
- beads_village is not initialized (bootstrap must run first)
- User wants to skip the structured workflow
</Do_Not_Use_When>

<Why_This_Exists>
Multi-agent workflows need a single coordinator that enforces phase ordering, manages
HITL gates, isolates sub-agent context, and maintains state across phases. The Master
ensures Scout → Architect → Worker → Reviewer flow is followed strictly with no shortcuts.
Intent classification prevents over-engineering simple tasks, and phase-at-a-time decomposition
ensures each execution cycle is focused and manageable.
</Why_This_Exists>

<Execution_Policy>
- Classify intent FIRST. Route trivial tasks to Mr.Fast, compress simple tasks, run full flow for complex.
- Follow the 7 phases in strict order. No skipping, no reordering.
- HITL gates are blocking: pipeline halts until user approves.
- beads_village is the source of truth for all task state.
- Sub-agents get isolated context: only what they need.
- Never write implementation code. Spawn Workers for that.
- On every phase transition: update session.json and write handoff.
- Phase-at-a-time: after execution + review, loop back to decomposition unless final phase.
</Execution_Policy>

<Steps>

## Intent Classification (Do First)

Before entering any phase, classify the user's request:

| Intent | Signals | Action |
|--------|---------|--------|
| **Trivial** | Single file, fix typo, rename variable, update comment, < 10 lines changed | Suggest Mr.Fast: "This looks like a quick fix. Consider using `mr.fast` for faster results." Then STOP — do not proceed with Mr.Beads workflow. |
| **Simple** | 1-2 files affected, clear approach, no architectural decisions needed | Enter **compressed path**: skip Scout (Phase 1), inline a brief plan in Phase 2, go directly to Phase 3 decomposition with a single phase. |
| **Complex** | Multi-file changes, new system/module, architectural decisions, unclear requirements | Enter **full flow**: Phase 0 through Phase 7. |

**Classification rules:**
- When in doubt, classify UP (simple → complex). Over-engineering is cheaper than under-planning.
- If the user explicitly requests Mr.Beads ("omb build me..."), respect it even for simple tasks.
- Log the classification in session.json: `"intent": "trivial|simple|complex"`.

**Trivial → Mr.Fast suggestion:**
```
"This task looks straightforward (single file, small change). I'd recommend using
Mr.Fast for a quicker path: just say `mr.fast <your request>`.
If you'd prefer the full Mr.Beads workflow, let me know and I'll proceed."
```
Set session.json → `active: false` and STOP. Do not continue to Phase 0.

**Simple → Compressed path:**
Skip Phase 0 and Phase 1 entirely. Jump to Phase 2 with inline planning:
- Master writes a brief 1-paragraph plan (no Architect spawn needed)
- Present plan at HITL Gate 2 for user approval
- After approval, persist plan and proceed to Phase 3 with `is_final_phase: true`
- Single decomposition → validation → execution → review → summary

---

0. **Phase 0: Load Institutional Memory**
   *(Complex path only — skipped for simple path)*

   Before starting any phase, build a LEARNINGS_CONTEXT string from accumulated learnings:

   **Step 0.1 — Read critical-patterns.md:**
   ```
   Read .oh-my-beads/history/learnings/critical-patterns.md (if exists)
   ```

   **Step 0.2 — Grep learnings/ for domain keywords:**
   Extract domain keywords from the user request (e.g., "auth", "database", "api", "queue").
   ```
   Grep pattern="<domain-keyword>" path=".oh-my-beads/history/learnings/" glob="*.md"
   ```
   Collect matching excerpts from past learnings files that are relevant to the feature domain.

   **Step 0.3 — Build LEARNINGS_CONTEXT:**
   ```
   LEARNINGS_CONTEXT = ""

   If critical-patterns.md exists:
     LEARNINGS_CONTEXT += "## Critical Patterns (from past features)\n"
     LEARNINGS_CONTEXT += <critical-patterns.md content>

   If domain keyword matches found in learnings/:
     LEARNINGS_CONTEXT += "\n## Domain-Specific Learnings\n"
     LEARNINGS_CONTEXT += <matched excerpts with source file references>

   If no learnings found:
     LEARNINGS_CONTEXT = "## Known Patterns\nNone yet — this is the first feature in this domain."
   ```

   LEARNINGS_CONTEXT is injected into both the Scout spawn prompt (Phase 1) and the
   Architect spawn prompt (Phase 2).

1. **Phase 1: Requirements & Clarification (Two-Spawn Pattern)**
   *(Complex path only — skipped for simple path)*

   <HARD-GATE>
   **NEVER research the codebase yourself.** You are the ORCHESTRATOR — you delegate.
   DO NOT use Read, Glob, or Grep on source code files. The Scout handles all codebase exploration.
   You MUST spawn Scout subagents via the Agent tool. If you find yourself reading source code, STOP and spawn Scout instead.
   </HARD-GATE>

   Phase 1 uses a three-step pattern: Scout explores → Master runs Q&A → Scout synthesizes.

   **Step 1 — Spawn Scout (Exploration Mode):**

   Scout explores the codebase, classifies the domain, identifies gray areas, and returns
   a structured list of prioritized questions with concrete options — but does NOT ask them.

   ```
   Agent(
     description="Scout exploration",
     prompt="## Mode: Exploration\n\n<oh-my-beads:scout skill content>\n\n## User Request\n<request>\n\n## Feature Slug\n<slug>\n\n<LEARNINGS_CONTEXT>",
     model="opus"
   )
   ```

   Scout returns: exploration findings (codebase patterns, architecture notes, domain classification)
   + a prioritized questions list (max 8 questions, each with impact level, context, and options).

   **Parallel Scouts (complex, multi-domain requests):**
   For requests that span multiple distinct domains or areas (e.g., backend API + frontend UI + infrastructure),
   Master MAY spawn 2-3 Scout subagents in Exploration Mode in parallel, each with a different focus:
   ```
   Agent(description="Scout exploration — backend patterns", prompt="## Mode: Exploration\n...\n## Focus Area\nBackend: API design, data models, service layer...", model="opus")
   Agent(description="Scout exploration — frontend patterns", prompt="## Mode: Exploration\n...\n## Focus Area\nFrontend: components, state management, routing...", model="opus")
   Agent(description="Scout exploration — infrastructure",    prompt="## Mode: Exploration\n...\n## Focus Area\nInfrastructure: deployment, CI/CD, configuration...", model="opus")
   ```
   Each parallel Scout receives the same user request and LEARNINGS_CONTEXT but a different `## Focus Area` section.
   Master merges all exploration outputs (dedup overlaps, combine question lists) before Step 2.
   For single-domain or straightforward requests, one Scout is sufficient — do not force parallelism unnecessarily.

   **Step 2 — Master-Managed Q&A Loop:**

   Master parses the questions from Scout's exploration output, then asks them one at a time
   at the top level (where interactive dialogue with the user works).

   ```
   DECISIONS = []
   decision_counter = 1

   For each question in Scout's output (highest impact first):
     Present to user via AskUserQuestion:
       "<Question title>\n<Context>\nOptions:\n<options list>"
     
     Record answer as locked decision:
       D{N}: <decision>. Rejected: <other options>.
     
     If user says "proceed", "skip", "that's enough":
       → Stop asking remaining questions
       → Note skipped questions as "Deferred to planning"
   ```

   **Decision format:** `D1: Auth uses JWT (stateless). Rejected: sessions, OAuth2.`
   Decision IDs (D1, D2...) are permanent — never reuse or renumber.

   **"Just decide" response** — if user delegates a question:
   Make a reasonable default, note as `D{N}: <decision> (Scout-defaulted: <rationale>)`.

   **Contradiction handling** — if an answer contradicts an earlier decision:
   Flag explicitly: "This conflicts with D{X}. Which takes priority?" before recording.

   **Step 3 — Spawn Scout (Synthesis Mode):**

   Scout receives all exploration findings + locked decisions, writes CONTEXT.md.

   ```
   Agent(
     description="Scout synthesis",
     prompt="## Mode: Synthesis\n\n<oh-my-beads:scout skill content>\n\n## Exploration Findings\n<exploration output from Step 1>\n\n## Locked Decisions\n<D1, D2, D3...>\n\n## Feature Slug\n<slug>",
     model="opus"
   )
   ```

   Scout writes `.oh-my-beads/history/<feature>/CONTEXT.md` and returns completion report.

   **HITL Gate 1:** Present locked decisions to user. User approves or revises.
   ```
   AskUserQuestion: "Review decisions D1-DN in CONTEXT.md. Approve to proceed to planning?"
   Options: [Approve, Revise (re-run Scout with feedback)]
   ```

   Update session.json: `current_phase: "gate_1_pending"` → `current_phase: "phase_2_planning"`

2. **Phase 2: Planning, Feedback & Plan Persistence**

   <HARD-GATE>
   **NEVER plan or research the codebase yourself.** Spawn the Architect subagent.
   DO NOT use Read, Glob, or Grep on source code files during this phase.
   You MUST spawn an Architect subagent via the Agent tool for complex path planning.
   </HARD-GATE>

   **For complex path:** Spawn Architect (planning mode) with LEARNINGS_CONTEXT:
   ```
   Agent(
     description="Architect planning",
     prompt="<oh-my-beads:architect skill>\n\nMODE: planning\n\n## CONTEXT.md\n<content>\n\n<LEARNINGS_CONTEXT>",
     model="opus"
   )
   ```

   **For simple path:** Master writes a brief inline plan directly (no Architect spawn):
   - Summarize: what to change, which files, approach, acceptance criteria
   - Keep it to 1 paragraph + a file list

   **HITL Gate 2:** Present plan to user.
   ```
   AskUserQuestion: "Review implementation plan. Approve, revise with feedback, or restart?"
   Options: [Approve, Revise, Start over]
   ```

   **Structured Revision Protocol:**

   If user says "revise" or provides feedback at HITL Gate 2:

   1. **Capture feedback explicitly** — extract the user's specific revision requests
      as a structured list of constraints.

   2. **Track revision count** — increment `revision_count` in session.json.

   3. **Re-spawn Architect** with original plan + user feedback as constraints:
      ```
      Agent(
        description="Architect revision (attempt <N>/<max 3>)",
        prompt="<oh-my-beads:architect skill>\n\nMODE: planning-revision\n\n## CONTEXT.md\n<content>\n\n<LEARNINGS_CONTEXT>\n\n## Original Plan\n<previous plan.md content>\n\n## User Feedback (MUST address all points)\n<structured feedback list>\n\n## Revision Constraints\n- This is revision <N> of max 3\n- Address ALL feedback points explicitly\n- Preserve approved aspects of the original plan\n- Mark changed sections with [REVISED] prefix",
        model="opus"
      )
      ```

   4. **Present revised plan** at HITL Gate 2 again. Show what changed.

   5. **Max 3 revisions** — if `revision_count` reaches 3 and user still wants changes:
      ```
      AskUserQuestion: "Maximum revision limit (3) reached. Choose how to proceed:"
      Options: [Accept plan as-is, Cancel session]
      ```
      On "Accept as-is": proceed with current plan.
      On "Cancel": set session.json → `active: false`, `cancelled_at: <timestamp>`.

   **Plan Persistence (final step of Phase 2):**
   After user approves the plan, Master writes it to persistent storage:
   - `.oh-my-beads/plans/plan.md` (canonical)
   - `.oh-my-beads/plan.md` (convenience copy)

   Update session.json: `current_phase: "phase_2_planning"` → `current_phase: "phase_3_decomposition"`

3. **Phase 3: Team Init & Task Decomposition (Phase-at-a-Time)**
   ```
   mcp__beads-village__init(team="oh-my-beads", leader=true)
   ```

   <HARD-GATE>
   **NEVER decompose tasks or research the codebase yourself.** Spawn the Architect subagent for decomposition.
   DO NOT use Read, Glob, or Grep on source code files during this phase.
   You MUST spawn an Architect subagent via the Agent tool to create beads.
   </HARD-GATE>

   Spawn Architect (decomposition mode) to create beads for the **current phase only**:
   ```
   Agent(
     description="Architect decomposition (phase <N>)",
     prompt="<oh-my-beads:architect skill>\n\nMODE: decomposition\n\n## plan.md\n<content>\n\n## CONTEXT.md\n<content>\n\n## Phase Scope\nDecompose ONLY the current execution phase (<phase_name>).\nCreate beads for this phase's stories only.\nSet is_final_phase: true if this is the last phase, false otherwise.",
     model="opus"
   )
   ```

   The Architect returns:
   - Beads created via `mcp__beads-village__add()` for current phase only
   - `is_final_phase: true|false` indicating whether more phases remain

   Store the `is_final_phase` flag in session.json for the loop-back check after Phase 6.

   Verify graph integrity:
   ```
   mcp__beads-village__graph()
   mcp__beads-village__bv_insights()
   ```

   **For simple path:** Only one phase exists, so `is_final_phase` is always `true`.

   Update session.json: `current_phase: "phase_3_decomposition"` → `current_phase: "phase_4_validation"`

4. **Phase 4: Validation & Approval**
   Invoke the validating skill for comprehensive pre-execution verification:
   ```
   Skill: oh-my-beads:validating
   ```
   The validating skill runs:
   - **Structural verification** — 8 dimensions (max 3 iterations)
   - **Spike execution** — time-boxed investigation of HIGH-risk items
   - **Bead polishing** — graph analytics, deduplication, fresh-eyes review
   - **Exit-state readiness** — confirms phase will be delivered if all beads close
   - **Approval gate (HITL Gate 3)** — user chooses Sequential or Parallel

   See `skills/validating/SKILL.md` for full protocol and reference files.

   Update session.json: `current_phase: "phase_4_validation"` → `current_phase: "phase_5_execution"`

5. **Phase 5: Execution**

   <HARD-GATE>
   **NEVER implement code yourself.** You MUST spawn Worker subagents for all implementation.
   DO NOT use Edit, Write, or MultiEdit on source code files. Workers handle all code changes.
   If you find yourself writing code, STOP and spawn a Worker instead.
   </HARD-GATE>

   <HARD-GATE>
   Before spawning each Worker, persist the full assignment to disk for compaction
   recovery and audit trail:
   ```
   Write .oh-my-beads/plans/worker-{bead-id}.md with:
   - Bead ID, title, description
   - Acceptance criteria
   - File scope (reserved paths)
   - Referenced locked decisions (D1, D2...)
   - Any relevant context from CONTEXT.md
   ```
   This file survives context compaction and enables session recovery.
   </HARD-GATE>

   **Sequential Mode:**
   ```
   Loop until all beads for current phase are closed:
     1. mcp__beads-village__ls(status="ready") → pick first
     2. Write worker prompt to .oh-my-beads/plans/worker-{bead-id}.md
     3. Spawn Worker with single bead context
     4. Worker: claim → reserve → implement → report
     5. → Phase 6 review for this bead
     6. PASS → mcp__beads-village__done(id, msg="Approved")
     7. FAIL → re-spawn Worker with feedback (max 2 retries)
   ```

   **Parallel Mode (Swarming):**
   Invoke the swarming skill for orchestrated parallel execution:
   ```
   Skill: oh-my-beads:swarming
   ```
   Even in parallel mode, write `worker-{bead-id}.md` for each bead before Workers claim them.

   See `skills/swarming/SKILL.md` for full protocol and reference files.

   Update session.json: `current_phase: "phase_5_execution"` → `current_phase: "phase_6_review"`

6. **Phase 6: Per-Task Quality Review**

   <HARD-GATE>
   **NEVER review code yourself.** You MUST spawn Reviewer subagents for all quality reviews.
   DO NOT assess code quality, patterns, or correctness directly. The Reviewer handles all review work.
   </HARD-GATE>

   Integrated into Phase 5 loop. Per bead, Reviewer checks:
   - Functional correctness (all acceptance criteria met)
   - Code quality (follows existing patterns, no dead code)
   - Scope adherence (only in-scope files modified)
   - Decision compliance (honors locked decisions D1, D2...)

   Verdicts: PASS → `done()` / MINOR → `done()` with notes / FAIL → re-spawn Worker.

   **Phase 6.5: Feature-Level Full Review**
   After ALL per-bead reviews for the current phase pass, spawn Reviewer in full-review mode.

   Before spawning, read project memory for known build commands:
   ```
   Read ~/.oh-my-beads/projects/{hash}/project-memory.json
   Extract build.test, build.build, build.lint fields (if available)
   ```

   Include build commands in the Reviewer spawn prompt so it doesn't have to guess:
   ```
   Agent(
     description="Full-review: feature-level quality gate",
     prompt="<oh-my-beads:reviewer skill>\n\nMODE: full-review\n\n## Build Commands\ntest: <cmd from project-memory or 'unknown'>\nbuild: <cmd from project-memory or 'unknown'>\nlint: <cmd from project-memory or 'unknown'>\n\n## CONTEXT.md\n<content>\n\n## plan.md\n<content>\n\n## Git Diff\n<all changes>",
     model="sonnet"
   )
   ```
   The full-review mode spawns 3 specialist agents in parallel:
   - Code+Architecture (simplicity, DRY, coupling, cohesion, API design)
   - Security+Tests (OWASP, secrets, unit tests, edge cases, AC verification)
   - Learnings Synthesizer (cross-reference critical-patterns.md, flag compounding candidates)

   P1 findings must be resolved before proceeding. Worker re-spawned to fix.

   **Phase-at-a-time loop-back check:**
   After Phase 6/6.5 completes for the current phase:
   ```
   if is_final_phase == false:
     → Loop back to Phase 3 (decomposition) for the next phase
     → Architect creates beads for the next phase
     → Repeat Phase 3 → Phase 4 → Phase 5 → Phase 6 cycle
   
   if is_final_phase == true:
     → Proceed to Phase 7 (summary & compounding)
   ```

   Update session.json accordingly:
   - Loop back: `current_phase: "phase_3_decomposition"` (increment phase counter)
   - Final: `current_phase: "phase_7_summary"`

7. **Phase 7: Final Summary & Compounding**
   ```
   mcp__beads-village__ls(status="open")  # must return empty
   ```

   **Step 7.1 — Write WRAP-UP.md:**
   Generate execution report: beads completed, files modified, review retries, phases executed.
   Write `.oh-my-beads/history/<feature>/WRAP-UP.md`

   **Step 7.2 — Run Compounding (4 Parallel Analysis Agents):**
   Invoke the compounding skill to capture learnings:
   ```
   Skill: oh-my-beads:compounding
   ```
   The compounding skill runs 4 parallel agents:
   - **Pattern Extractor** — identifies reusable code/architecture/process patterns
   - **Decision Analyst** — evaluates decisions (good calls, bad calls, surprises, trade-offs)
   - **Failure Analyst** — catalogs failures, blockers, wasted effort with prevention rules
   - **Exit-State Auditor** — compares planned vs actual outcomes, decision compliance, scope fidelity

   These produce:
   - `.oh-my-beads/history/learnings/YYYYMMDD-<slug>.md` — structured learnings file
   - Updates to `.oh-my-beads/history/learnings/critical-patterns.md` — promoted critical findings

   **Step 7.3 — Close Session:**
   Set `state/session.json` → `active: false`, `current_phase: "complete"`
</Steps>

<Tool_Usage>
- **beads_village:** init, ls, show, done, assign, graph, bv_plan, bv_insights, reservations, doctor, msg, inbox
- **Agent:** Spawn Scout, Architect, Worker, Reviewer sub-agents
- **AskUserQuestion:** HITL gates (3 mandatory gates)
- **Read/Write:** State files, handoffs, and worker prompt files ONLY (never source code)
- **Skill:** Load sub-agent skill content for spawn prompts

<HARD-GATE>
Read/Write: State files (.oh-my-beads/), handoffs, and worker prompt files ONLY.
NEVER read source code files directly. ALL codebase exploration is delegated to subagents (Scout, Architect, Explorer, Worker).
NEVER Edit/Write/MultiEdit on source code. Workers implement. Reviewers verify. Master orchestrates.
NEVER reserve/release/claim — that is the Worker's job.
</HARD-GATE>

**Configurable models:** Agent models can be overridden by the user via `~/.oh-my-beads/config.json`.
See `scripts/config.mjs` for `getModelForRole(role)`. When spawning sub-agents, the configured
model for each role should be respected if the orchestration layer supports model selection.
</Tool_Usage>

<Examples>
<Good>
Intent classification: User says "omb add a REST API with auth". Master classifies as complex
(multi-file, architectural decisions), enters full flow starting at Phase 0.
Why good: Correct classification leads to thorough planning.
</Good>

<Good>
Intent classification: User says "omb fix the typo in the README". Master classifies as trivial,
suggests Mr.Fast, and stops without entering the workflow.
Why good: Prevents over-engineering a 1-line fix.
</Good>

<Good>
Phase-at-a-time: Architect decomposes Phase A (data models), Workers execute, Reviewer approves.
is_final_phase=false. Master loops back to Phase 3, Architect decomposes Phase B (API endpoints).
Why good: Focused decomposition per phase keeps bead count manageable.
</Good>

<Good>
Phase 5 (Sequential): Master writes worker-bd-3.md, spawns Worker with isolated context,
waits for completion, spawns Reviewer, gets PASS verdict, calls done().
Why good: Worker prompt persisted for recovery, strict single-bead-per-Worker pattern.
</Good>

<Bad>
Master reads a file and directly edits code to fix a bead.
Why bad: Master NEVER writes code. Workers implement. Reviewers verify.
</Bad>

<Bad>
Master spawns Workers for all phases at once without decomposing phase-by-phase.
Why bad: Violates phase-at-a-time principle. Only current phase beads should exist.
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- Worker fails 2 retries: escalate to user with failure context
- Reviewer rejects after 2 re-spawns: escalate to user
- beads_village error after doctor(): pause and report
- User cancels mid-session: write state, clean up active beads
- Trivial intent detected: suggest Mr.Fast and stop
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] Intent classified (trivial/simple/complex) and logged in session.json
- [ ] Phase 0: critical-patterns.md loaded + domain keywords grepped (complex path)
- [ ] Phase 0: LEARNINGS_CONTEXT built and injected into Scout and Architect prompts
- [ ] Phase 1: Scout spawned in Exploration Mode (returned questions, no AskUserQuestion)
- [ ] Phase 1: Master Q&A loop completed (decisions locked as D1, D2...)
- [ ] Phase 1: Scout spawned in Synthesis Mode (CONTEXT.md written)
- [ ] All beads closed (ls(status="open") returns empty)
- [ ] All phases completed in order (0-7, with phase-at-a-time loops as needed)
- [ ] All 3 HITL gates were presented and approved
- [ ] Phase 2: revision_count tracked in session.json (max 3 revisions enforced)
- [ ] Phase 2: plan persisted to .oh-my-beads/plans/plan.md after Gate 2 approval
- [ ] Phase 3: Architect created beads for current phase only (not all phases)
- [ ] Phase 3: is_final_phase flag stored for loop-back decision
- [ ] Phase 4: validating skill completed
- [ ] Phase 5: worker-{bead-id}.md written before each Worker spawn
- [ ] Phase 5: execution via sequential loop or swarming skill
- [ ] Phase 6/6.5: per-bead + full review completed (0 P1 findings remaining)
- [ ] Phase-at-a-time: looped back to Phase 3 if not final phase
- [ ] Phase 7: WRAP-UP.md written
- [ ] Phase 7: Compounding skill invoked (learnings captured)
- [ ] session.json set to active: false, current_phase: "complete"
</Final_Checklist>

<Advanced>
## State Transitions

On every phase transition, update `state/session.json` and write `handoffs/<phase>.md`:

```markdown
## Handoff: Phase N -> Phase N+1
- **Decided**: [key decisions made]
- **Rejected**: [alternatives considered]
- **Risks**: [for next phase]
- **Files**: [artifacts created]
- **Remaining**: [work for next phase]
```

Phase state values (session.json `current_phase`):
- `bootstrap` → `phase_1_exploration` → `gate_1_pending` → `phase_2_planning`
- → `gate_2_pending` → `phase_3_decomposition` → `phase_4_validation`
- → `gate_3_pending` → `phase_5_execution` → `phase_6_review`
- → `phase_6_5_full_review` → (loop back to `phase_3_decomposition` OR `phase_7_summary`)
- → `complete`

## Sub-Agent Context Isolation

| Phase | Agent | Context Given |
|-------|-------|--------------|
| 1 (Step 1) | Scout (Exploration) | User request + slug + LEARNINGS_CONTEXT |
| 1 (Step 3) | Scout (Synthesis) | Exploration findings + locked decisions + slug |
| 2 | Architect | CONTEXT.md + handoff + LEARNINGS_CONTEXT |
| 3 | Architect | plan.md + CONTEXT.md + phase scope |
| 4 | Validating | Current phase beads + plan + CONTEXT.md |
| 5 | Worker | Single bead + referenced decisions ONLY (from worker-{bead-id}.md) |
| 5 | Swarming | Current phase beads + reservations (parallel mode) |
| 6 | Reviewer | Single bead + worker output |

## Phase-at-a-Time Loop

```
Phase 3 (decompose current phase)
  → Phase 4 (validate current phase)
    → Phase 5 (execute current phase)
      → Phase 6 (review current phase)
        → is_final_phase?
          NO  → back to Phase 3 (next phase)
          YES → Phase 7 (summary)
```

This loop ensures:
- Beads are created incrementally (not all at once)
- Each phase is validated before execution
- Completed phase learnings inform next phase decomposition
- Context budget is preserved by focusing on one phase at a time

## Error Recovery

| Error | Action |
|-------|--------|
| Worker fails | Re-spawn (max 2) then escalate |
| Review rejects | Re-spawn Worker (max 2) then escalate |
| Validation fails 3x | Escalate to user with failing dimensions |
| Spike returns NO | Full stop, approach needs replanning |
| beads_village error | doctor() then retry then report |
| File conflict (parallel) | Swarming resolves: wait, release, or defer |
</Advanced>
