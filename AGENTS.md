# Oh-My-Beads — AGENTS.md

> Multi-agent orchestration plugin for Claude Code.
> Uses **beads_village** as the single source of truth for task tracking, dependency management, and concurrency safety.
> All execution on the primary directory — **no git worktrees**.

## Modes

Oh-My-Beads has two execution modes:

| Mode | Keyword | Agents | HITL Gates | beads_village | Use For |
|------|---------|--------|------------|---------------|---------|
| **Mr.Beads** | `omb`, `oh-my-beads`, `mr.beads` | Scout → Architect → Worker → Reviewer | 3 gates | Full (tasks + locks) | Complex features, multi-file changes, new systems |
| **Mr.Fast** | `mr.fast`, `mrfast` | Turbo: Executor only / Standard: Fast Scout → Executor | 0 gates | Turbo: locks only if needed / Standard: lite (locks) | Bug fixes, small changes, root cause analysis |

### Mr.Beads Flow (7-phase, with phase-at-a-time loop)

Master classifies intent first:
- **Trivial** → suggest Mr.Fast and stop
- **Simple** → compressed path (skip Scout, inline plan, single decomposition phase)
- **Complex** → full 7-phase flow

```
User prompt → keyword-detector → prompt-leverage (augment) → Mr.Beads bootstrap
Phase 0: Load learnings → Scout (Phase 1) → Gate 1
→ Architect planning + persistence (Phase 2) → Gate 2
→ Architect decomposition for current phase (Phase 3)
→ Validation (Phase 4) → Gate 3
→ Workers (Phase 5) → Per-bead review + Full review (Phase 6/6.5)
→ [loop back to Phase 3 if not final phase]
→ Summary + Compounding (Phase 7)
```

### Mr.Fast Flow (tiered)

Keyword-detector classifies intent:
- **Turbo** (explicit file + approach) → single Executor, no Fast Scout, no beads_village init
- **Standard** (moderate fix) → Fast Scout → Executor (self-verifies), no mandatory review
- **Complex** (too large) → suggest Mr.Beads instead, no active session created

```
User prompt → keyword-detector → intent classification → prompt-leverage (augment, Light intensity)

Turbo:   → Executor (read → edit → verify → report)
Standard: → Fast Scout (0-2 questions) → Executor (reserve → implement → self-verify → release)
Complex:  → "Consider Mr.Beads" suggestion (no session started)
```

### Prompt Leverage (automatic, both modes)

Every keyword-triggered invocation automatically runs prompt-leverage to strengthen the
user's raw prompt before routing to agents. The augmented prompt includes:

| Block | Purpose |
|-------|---------|
| Objective | Task + success definition |
| Context | Intent preservation + assumptions |
| Work Style | Task type + intensity (Light/Standard/Deep) |
| Tool Rules | Task-specific tool guidance |
| Output Contract | Expected result format |
| Verification | Correctness checks |
| Done Criteria | When to stop |

Mr.Fast caps intensity at Light (speed over thoroughness).
Both the original and augmented prompts are passed to agents.

## Quick Start

```bash
# Mr.Beads — full workflow for complex features
omb build me a REST API

# Mr.Fast — quick fix for bugs and small changes
mr.fast fix the login validation bug

# Cancel either mode
cancel omb
cancel mrfast
```

## The 7-Phase Workflow

The Master Orchestrator classifies intent first, then enforces phase ordering strictly.

### Intent Classification (before any phase)

| Intent | Signals | Action |
|--------|---------|--------|
| **Trivial** | Single file, fix typo, rename, < 10 lines | Suggest Mr.Fast and stop |
| **Simple** | 1-2 files, clear approach, no architectural decisions | Compressed path: skip Scout, inline plan, single decomposition phase |
| **Complex** | Multi-file, new system, unclear requirements | Full 7-phase flow |

### Full Flow (Complex)

```
Phase 0: Load Institutional Memory        [Master: read critical-patterns.md + domain learnings]
   ↓
Phase 1: Requirements & Clarification     [Scout]
   ↓
 GATE 1: User approves locked decisions
   ↓
Phase 2: Planning, Feedback & Persistence  [Architect + Master plan write]
   ↓
 GATE 2: User approves plan (with enhancement feedback, max 3 revisions)
   ↓
Phase 3: Team Init & Task Decomposition    [Architect: phase-at-a-time beads + beads_village]
   ↓
Phase 4: Validation & Approval             [Validating skill: configurable depth + spikes + polishing]
   ↓
 GATE 3: User chooses Sequential or Parallel
   ↓
Phase 5: Execution                         [Worker(s) or Swarming skill]
   ↓
Phase 6: Per-Task Quality Review           [Reviewer: review mode, per bead + batch merge verify]
   ↓
Phase 6.5: Feature-Level Full Review       [Reviewer: full-review mode, 3 specialist agents]
   ↓
 [Loop back to Phase 3 if not final phase]
   ↓
Phase 7: Final Summary & Compounding       [Master + Compounding skill]
```

---

## Phase Details

### Phase 0: Load Institutional Memory
*(Complex path only — skipped for simple path)*

**Agent:** Master (direct)

Before entering any phase, the Master builds LEARNINGS_CONTEXT from accumulated learnings:
- Reads `.oh-my-beads/history/learnings/critical-patterns.md`
- Greps `learnings/` for domain keywords from the user request
- Builds LEARNINGS_CONTEXT string injected into Scout and Architect prompts

### Phase 1: Requirements & Clarification
*(Complex path only — skipped for simple path)*

**Agent:** Scout | **Skill:** `oh-my-beads:scout`

The Scout clarifies requirements through Socratic dialogue:
- Reads `critical-patterns.md` (past learnings) to inform questions
- One question at a time (HARD-GATE: never batched)
- Communication standards: plain language, practical-first, scenario-first
- Domain classification: SEE | CALL | RUN | READ | ORGANIZE
- Uses domain-specific gray area probes (`scout/references/gray-area-probes.md`)
- Red Flags section: scope creep, contradictory requirements, under-specification
- Gray areas probed by impact priority
- Decisions locked as D1, D2, D3...

**Output:** `.oh-my-beads/history/<feature>/CONTEXT.md`

**HITL Gate 1:** User reviews and approves locked decisions before planning begins.

### Phase 2: Planning, Feedback & Plan Persistence

**Agent:** Architect (planning mode) | **Skill:** `oh-my-beads:architect`

The Architect:
1. Reads CONTEXT.md (locked decisions)
2. Researches codebase deeply
3. AI-slop detection: catches scope inflation, premature abstraction, over-validation
4. Produces plan with stories, acceptance criteria, file scopes, risks

**For simple path:** Master writes a brief inline plan directly (no Architect spawn).

**Output:** Draft plan (returned to Master)

**HITL Gate 2:** User reviews the plan. Can approve, provide enhancement feedback (Architect revises, max 3 revisions), or start over.

**Plan Persistence (final step of Phase 2):**
After user approves, Master writes the plan to persistent storage:
- `.oh-my-beads/plans/plan.md` — canonical location
- `.oh-my-beads/plan.md` — top-level convenience copy

### Phase 3: Team Init & Task Decomposition (Phase-at-a-Time)

**Agent:** Architect (decomposition mode) | **beads_village:** `init()`, `add()`

1. Master initializes beads_village: `init(team="oh-my-beads", leader=true)`
2. Architect decomposes the **current phase's stories** into beads (not the entire feature):
   - `add(title, desc, typ, pri, tags, deps)` per bead
   - Dependencies declared via `deps=["issue:bd-N"]`
   - File scope isolation enforced; bead conflict detection (overlapping file scopes → split, dependency, or merge)
   - Returns `is_final_phase: true|false` indicating whether more phases remain
3. Master verifies graph: `graph()`, `bv_insights()` (check for cycles)

**For simple path:** Only one phase exists, so `is_final_phase` is always `true`.

### Phase 4: Validation & Approval

**Skill:** `oh-my-beads:validating`

Configurable-depth pre-execution verification:

**Lighter path** (< 5 beads): Fewer dimensions, fewer iterations, faster validation.
**Standard/Deep** (≥ 5 beads): Full verification with all 8 dimensions.

Context budget monitoring at 65% threshold — writes handoff and defers if exceeded.

1. **Structural verification** — 8 dimensions (plan coherence, story coverage, decision coverage, dependency correctness, file scope isolation, context budget, verification completeness, exit-state completeness). Max 3 iterations.
2. **Spike execution** — time-boxed investigation for HIGH-risk items. YES → embed findings. NO → full stop, replan.
3. **Bead polishing** — graph health (`bv_insights`), priority alignment (`bv_priority`), execution tracks (`bv_plan`), deduplication, fresh-eyes bead review (subagent).
4. **Exit-state readiness** — confirms phase will be delivered if all beads close.
5. **Approval gate (HITL Gate 3)** — structured summary + user chooses Sequential or Parallel.

Reference files: `skills/validating/references/plan-checker-prompt.md`, `skills/validating/references/bead-reviewer-prompt.md`

### Phase 5: Execution

**Agent:** Worker(s) | **Skill:** `oh-my-beads:worker` (sequential), `oh-my-beads:swarming` (parallel)

**Worker prompt persistence (HARD-GATE):** Before spawning each Worker, Master writes
the full assignment to `.oh-my-beads/plans/worker-{bead-id}.md` for compaction recovery and audit trail.

#### Sequential Mode
```
For each ready bead (in dependency order):
  1. Master picks first: ls(status="ready")
  2. Master writes worker-{bead-id}.md with full assignment context
  3. Worker spawned with single bead context
  4. Worker: claim() → reserve(paths) → implement → best-effort verify → report
  5. → Phase 6 review for this bead
  6. If PASS: done(id) → next bead
  7. If FAIL: re-spawn Worker (max 2 retries)
```

**Worker HARD-GATE constraints:**
- Must reserve files before editing (file scope adherence)
- Best-effort verification only (lint/syntax on changed files) — full build+test deferred to Reviewer batch merge
- Turn termination rules: must end with structured completion report
- Context budget monitoring with handoff on approaching limits

#### Parallel Mode (Swarming)

Invokes the swarming skill for orchestrated parallel execution:

```
Swarming Orchestrator:
  1. Confirm readiness: ls(status="ready"), bv_insights()
  2. Spawn self-routing Worker pool (2-4 concurrent Workers)
  3. Workers self-route: ls(status="ready") → claim() → reserve(paths, region_hint) → implement → msg(thread="bd-N") → release() → loop
  4. Orchestrator monitors: inbox(), reservations(), handles file conflicts
  5. Per-bead review: Reviewer spawned as each Worker completes
  6. On PASS: done(id) → unblocks dependents
  7. On FAIL: re-spawn Worker with feedback (max 2 retries)
```

Swarming uses **shared locks with region hints** for concurrent edits to different sections
of the same file. Messages are threaded by bead ID (`thread="bd-N"`) for organized communication.

Reference files: `skills/swarming/references/worker-spawn-template.md`, `skills/swarming/references/message-templates.md`

**Concurrency safety:** Entirely via beads_village:
- `reserve(paths)` — exclusive file locks
- `ls(status="ready")` — dependency-aware filtering
- `done(id)` — auto-release + unblock dependents
- No advisory lock files. No git worktrees.

### Phase 6: Per-Task Quality Review + Batch Merge Verification

**Agent:** Reviewer (review mode) | **Skill:** `oh-my-beads:reviewer`

Runs **per bead**, immediately after each Worker completes:

| Dimension | Check |
|-----------|-------|
| Functional Correctness | All acceptance criteria met? |
| Code Quality | Follows existing patterns? Clean code? |
| Scope Adherence | Only modified in-scope files? |
| Decision Compliance | Honors locked decisions (D1, D2...)? |

**Verdicts:**
- **PASS** → Master closes bead via `done(id)`
- **MINOR** → Close with advisory notes
- **FAIL** → Re-spawn Worker with review feedback (max 2 retries, then escalate)

**No TDD mandate.** Focus on functional review, not test coverage.

**Batch Merge Verification (HARD-GATE):** After all per-bead reviews pass, Reviewer runs
full project-wide build+test+lint+type-check. Workers only do best-effort verification
on their changed files — the Reviewer is responsible for comprehensive batch verification.
If batch verification fails, the responsible bead(s) are identified and Workers re-spawned.

### Phase 6.5: Feature-Level Full Review

**Agent:** Reviewer (full-review mode) | **Skill:** `oh-my-beads:reviewer`

After ALL per-bead reviews and batch merge verification pass, runs **3 consolidated specialist agents** for cross-cutting analysis:

| Agent | Focus | Severity |
|-------|-------|----------|
| Code+Architecture | Simplicity, DRY, error handling, type safety, coupling, cohesion, API design, patterns | P1-P3 |
| Security+Tests | OWASP Top 10, secrets, supply chain, unit tests, edge cases, AC verification | P1-P3 |
| Learnings Synthesizer | Cross-reference with critical-patterns.md, flag new patterns | P3 (candidates) |

**Review findings become beads_village issues:**
- **P1** (blocking) → Must fix before Phase 7. Worker re-spawned.
- **P2/P3** (non-blocking) → Tracked as follow-up beads.

**Artifact verification (3-level):** EXISTS → SUBSTANTIVE → WIRED for all deliverables.

Reference files: `skills/reviewer/references/review-agent-prompts.md`, `skills/reviewer/references/review-bead-template.md`

**Phase-at-a-time loop-back check:**
After Phase 6/6.5 completes:
- If `is_final_phase == false` → loop back to Phase 3 (Architect decomposes next phase)
- If `is_final_phase == true` → proceed to Phase 7 (summary & compounding)

### Phase 7: Final Summary & Compounding

**Agent:** Master (direct) + Compounding Skill

1. Verify all beads closed: `ls(status="open")` returns empty
2. Write `.oh-my-beads/history/<feature>/WRAP-UP.md` — execution report
3. **Invoke compounding skill** (`oh-my-beads:compounding`) for structured learning capture:
   - 4 parallel analysis agents: Pattern Extractor, Decision Analyst, Failure Analyst, Exit-State Auditor
   - Produces `.oh-my-beads/history/learnings/YYYYMMDD-<slug>.md` with domain tags
   - Promotes critical findings to `.oh-my-beads/history/learnings/critical-patterns.md`
   - **Pruning:** When critical-patterns.md exceeds 50 entries, archives oldest 20 to `critical-patterns-archive.md`
4. Clear session state

The compounding flywheel ensures each completed feature makes the next one faster:
- **Scout** reads critical-patterns.md at Phase 1 → asks sharper questions
- **Architect** reads critical-patterns.md at Phase 2 → avoids known pitfalls

---

## Mr.Fast Workflow

Mr.Fast is the lightweight mode for quick fixes and small changes. No planning, no mandatory review,
no HITL gates. Intent classification determines the execution path.

### Intent Classification

The keyword-detector classifies Mr.Fast prompts into three intents:

| Intent | Signals | Path |
|--------|---------|------|
| **Turbo** | Explicit file + line reference AND explicit approach | Single Executor, no Fast Scout, no beads_village init |
| **Standard** | Moderate fix description without explicit file+line | Fast Scout → Executor |
| **Complex** | Large-scope work (refactor entire, redesign, rebuild) | Suggest Mr.Beads instead (no active session) |

Ambiguous prompts default to Standard (the safer path).

### Turbo Path

**Agent:** Executor only | **No beads_village init**

For when the user provides specific file + approach (e.g., "mr.fast fix typo on line 42 of auth.ts"):
1. Executor reads target file(s)
2. Applies the specific change described
3. File locking (`reserve`/`release`) used only if needed
4. Self-verify: lint/build/test on changed files
5. Report results

### Standard Path (Fast Scout → Executor)

**Agent:** Fast Scout | **Skill:** `oh-my-beads:fast-scout`

The Fast Scout performs rapid codebase analysis:
- Reads relevant files using Glob/Grep/Read
- HARD-GATE: asks at most 2 clarifying questions (only if truly needed)
- HARD-GATE: never writes code
- Red Flags: scope creep, over-analysis, writing code
- Returns BRIEF.md with root cause, affected files, and fix plan

**Agent:** Executor

The Executor implements the fix:
1. Reads BRIEF.md for the fix plan
2. `reserve(paths)` — lock affected files via beads_village
3. Follows fix plan step by step
4. Self-verify: build/lint/test on changed files
5. `release()` — unlock files
6. Report results with file:line citations

### Execution Phase

**Retry:** Max 1 retry if Executor fails, then escalate to user.

### Mr.Fast Resume

If a Mr.Fast session is interrupted (`active=true`, `mode=mr.fast`), `session-start.mjs`
detects the interrupted session and offers to resume on next startup.

---

## Agent Roles

Agent definitions live in `agents/*.md`. Each file defines the agent's role, model, constraints, and protocol.

| Agent | Agent File | Skill | Writes Code? | beads_village Tools | Model |
|-------|-----------|-------|-------------|-------------------|-------|
| **Master** | `agents/master.md` | `oh-my-beads:master` | NO | init, ls, show, done, assign, graph, bv_plan, bv_insights, reservations, doctor, msg, inbox | opus |
| **Scout** | `agents/scout.md` | `oh-my-beads:scout` | NO | (none) | opus |
| **Fast Scout** | `agents/fast-scout.md` | `oh-my-beads:fast-scout` | NO | (none) | sonnet |
| **Architect** | `agents/architect.md` | `oh-my-beads:architect` | NO | add (via Master) | opus |
| **Worker** | `agents/worker.md` | `oh-my-beads:worker` | YES | init, claim, show, reserve, release, msg | sonnet |
| **Reviewer** | `agents/reviewer.md` | `oh-my-beads:reviewer` | NO | ls, show, search, add, msg | sonnet |
| **Explorer** | `agents/explorer.md` | — | NO | (none) | haiku |
| **Executor** | `agents/executor.md` | — | YES | reserve, release | sonnet/opus |
| **Verifier** | `agents/verifier.md` | — | NO | (none) | sonnet |
| **Code Reviewer** | `agents/code-reviewer.md` | — | NO | (none) | opus |
| **Security Reviewer** | `agents/security-reviewer.md` | — | NO | (none) | sonnet |
| **Test Engineer** | `agents/test-engineer.md` | — | Test files only | (none) | sonnet |

**Skills (not agents, but invoked as skills):**

| Skill | Skill File | Phase | beads_village Tools | Model |
|-------|-----------|-------|-------------------|-------|
| **Validating** | `skills/validating/SKILL.md` | Phase 4 | ls, show, bv_insights, bv_priority, bv_plan, graph, add, done | sonnet (subagents) |
| **Swarming** | `skills/swarming/SKILL.md` | Phase 5 (parallel) | ls, show, done, reservations, msg, inbox, ack_message, bv_insights | sonnet (Workers) |
| **Compounding** | `skills/compounding/SKILL.md` | Phase 7 | (none — reads/writes learnings files) | sonnet (subagents) |
| **Debugging** | `skills/debugging/SKILL.md` | Error recovery | show, add, msg, inbox, bv_insights, reservations | sonnet |

## Context Isolation

Sub-agents receive ONLY what they need:

| Agent | Receives | Does NOT Receive |
|-------|----------|-----------------|
| Scout | User request, feature slug, LEARNINGS_CONTEXT | Plans, beads, code |
| Architect | CONTEXT.md, handoffs, LEARNINGS_CONTEXT | Scout's conversation, other agents |
| Architect (decomposition) | plan.md, CONTEXT.md, phase scope | Scout/Architect planning conversations |
| Validating | Current phase beads + plan + CONTEXT.md | Scout/Architect conversations |
| Worker | Single bead (from worker-{bead-id}.md) + referenced decisions | Full plan, other beads, chat history |
| Swarming | Current phase beads + reservations + messaging | Scout/Architect conversations, source code |
| Reviewer | Bead details + worker output OR bead list | Full plan (review mode), chat history |
| Reviewer (full-review) | Git diff + CONTEXT.md + plan.md + closed beads | Scout/Architect conversations, session state |

## beads_village Lifecycle

```
init(team="oh-my-beads", leader=true)    # Master initializes
  → add(title, desc, deps, tags)         # Architect creates beads
  → ls(status="ready")                   # Master finds claimable work
  → claim()                              # Worker picks up bead
  → reserve(paths)                       # Worker locks files
  → [Worker implements]                  # Code changes
  → release()                            # Worker unlocks
  → [Reviewer verifies]                  # Quality check
  → done(id, msg)                        # Master closes after review
```

## Concurrency Rules

1. **File locks via beads_village ONLY** — `reserve()` before editing, `release()` after
2. **Never create advisory lock files** — beads_village IS the lock manager
3. **Ready tasks only** — `ls(status="ready")` filters blocked beads
4. **One bead per Worker** — Workers don't claim multiple beads
5. **Review before close** — `done()` only after Reviewer approves
6. **No git worktrees** — all work on primary directory

## HITL Gates

| Gate | Between | User Approves | Blocking? |
|------|---------|--------------|-----------|
| Gate 1 | Phase 1 → 2 | Locked decisions (CONTEXT.md) | YES |
| Gate 2 | Phase 2 → 3 | Implementation plan (with feedback loop, max 3 revisions) | YES |
| Gate 3 | Phase 4 → 5 | Execution mode (Sequential / Parallel) | YES |

All gates are **mandatory and blocking**.

## Error Recovery

| Error | Action |
|-------|--------|
| Worker fails implementation | Re-spawn with failure context (max 2 retries → invoke debugging skill → escalate) |
| Review rejects bead | Re-spawn Worker with feedback (max 2 retries → invoke debugging skill → escalate) |
| Full-review P1 findings | Worker re-spawned to fix → re-review (max 2 iterations → escalate) |
| Batch merge verification fails | Identify responsible bead(s), re-spawn Worker(s), max 2 iterations → escalate |
| Build/test failure | Invoke debugging skill (triage → reproduce → diagnose → fix → learn) |
| beads_village error | `doctor()` → retry → if still fails, pause and report |
| Validation fails 3 iterations | Escalate to user with failing dimensions |
| Spike returns NO | Full stop → approach needs replanning |
| File lock conflict (parallel) | Swarming resolves: wait, release, or defer bead |
| Context budget exceeded | Write handoff, spawn fresh sub-agent |
| Swarm orchestrator context heavy | Checkpoint + broadcast pause + handoff |
| User cancels mid-session | Write state, clean up active beads |
| Phase-at-a-time loop cancel | Cancel signal respected between loop iterations |

## Priority Context & Remember Tags

Agents can persist critical knowledge across sessions and compactions using `<remember>` tags in their output.

### Priority Context (`<remember priority>`)

Wrap critical, must-never-forget information in `<remember priority>` tags:

```
<remember priority>Always run database migrations before deploying. Auth module uses JWT with 24h expiry.</remember>
```

- **Writes to:** `.oh-my-beads/priority-context.md` (project-level, committed to repo)
- **Behavior:** Replaces entire file content (max 500 chars)
- **Loaded:** Every session start, injected as `[Priority Context]` in additionalContext
- **Survives:** Sessions AND compactions (persisted to disk)
- **Use for:** Critical patterns, architecture decisions, safety constraints

### Working Memory (`<remember>`)

Wrap session-relevant findings in plain `<remember>` tags:

```
<remember>Found that the config module reads from both ENV and .env file, ENV takes precedence</remember>
```

- **Writes to:** `.oh-my-beads/history/working-memory.md` (project-level, committed to repo)
- **Behavior:** Appends with timestamp (never replaces)
- **Use for:** Investigation findings, discovered patterns, context for future sessions

### Usage Rules

- Any agent can use `<remember>` tags in tool output (Bash, Agent, etc.)
- `<remember priority>` is for truly critical context only — it replaces the entire priority file
- `<remember>` (without priority) appends and accumulates over time
- Processing happens in `post-tool-verifier.mjs` (PostToolUse hook)

## Directory Structure

```
OhMyBeads/                              # Plugin root (git repo)
├── .claude-plugin/
│   ├── plugin.json                     # Plugin manifest
│   └── marketplace.json                # Marketplace registry entry
├── package.json                        # npm package metadata
├── .mcp.json                           # MCP server config (beads_village)
├── agents/                             # Agent role definitions
│   ├── master.md                       # Master Orchestrator agent
│   ├── scout.md                        # Scout (requirements) agent
│   ├── fast-scout.md                   # Fast Scout (Mr.Fast analysis) agent
│   ├── architect.md                    # Architect (planning) agent
│   ├── worker.md                       # Worker (implementation) agent
│   ├── reviewer.md                     # Reviewer (quality) agent
│   ├── explorer.md                     # Explorer (fast search) agent
│   ├── executor.md                     # Executor (general implementation) agent
│   ├── verifier.md                     # Verifier (independent checks) agent
│   ├── code-reviewer.md                # Code Reviewer (deep review) agent
│   ├── security-reviewer.md            # Security Reviewer (audit) agent
│   └── test-engineer.md                # Test Engineer (test files only) agent
├── hooks/
│   └── hooks.json                      # Event-driven hooks config
├── scripts/                            # Hook runtime scripts
│   ├── run.cjs                         # Hook wrapper (spawns .mjs scripts)
│   ├── helpers.mjs                     # Shared helpers (readJson, writeJsonAtomic, hookOutput)
│   ├── helpers.cjs                     # CJS shim of shared helpers (for persistent-mode)
│   ├── keyword-detector.mjs            # UserPromptSubmit: "omb"/"mr.fast" detection + intent classification
│   ├── session-start.mjs              # SessionStart: bootstrap + resume (both modes)
│   ├── pre-tool-enforcer.mjs          # PreToolUse: role-based access control (early-returns for inactive sessions)
│   ├── post-tool-verifier.mjs         # PostToolUse: failure detection & tracking (early-returns for inactive sessions)
│   ├── post-tool-use-failure.mjs      # PostToolUseFailure: retry tracking & escalation
│   ├── context-guard-stop.mjs         # Stop: context pressure detection (runs before persistent-mode)
│   ├── persistent-mode.cjs            # Stop: autonomy engine (blocks premature stops)
│   ├── session-end.mjs                # SessionEnd: cleanup state, deactivate sessions
│   ├── prompt-leverage.mjs            # Prompt augmentation (imported by keyword-detector)
│   ├── subagent-tracker.mjs           # SubagentStart: subagent lifecycle tracking
│   └── subagent-stop.mjs             # SubagentStop: consolidated deliverable verification + tracking
├── skills/                             # All skills at plugin root
│   ├── using-oh-my-beads/SKILL.md      # Bootstrap & entry point
│   ├── mr-fast/SKILL.md                # Mr.Fast entry point (turbo/standard/complex paths)
│   ├── master/SKILL.md                 # Master Orchestrator (7-phase, intent classification, phase-at-a-time)
│   ├── scout/                          # Phase 1: Socratic exploration
│   │   ├── SKILL.md                    # HARD-GATE tags, Communication Standards, Red Flags
│   │   └── references/
│   │       ├── gray-area-probes.md     # Domain-specific probe templates
│   │       └── discovery-template.md   # Structured discovery output template
│   ├── fast-scout/SKILL.md             # Mr.Fast: Rapid analysis (HARD-GATE tags, Red Flags)
│   ├── architect/SKILL.md              # Phase 2-3: Planning, AI-slop detection, phase-at-a-time decomposition
│   │   └── references/
│   │       ├── approach-template.md    # Structured approach template
│   │       └── phase-contract-template.md # Phase contract format
│   ├── worker/SKILL.md                 # Phase 5: Implementation (HARD-GATE, turn termination, best-effort verify)
│   ├── reviewer/SKILL.md              # Phase 6: Per-bead review + Phase 6.5: Full-review (3 specialist agents)
│   │   └── references/
│   │       ├── review-agent-prompts.md # 3 consolidated specialist prompts (Code+Architecture, Security+Tests, Learnings)
│   │       └── review-bead-template.md # Review finding bead format (P1/P2/P3)
│   ├── validating/                     # Phase 4: Pre-execution verification (configurable depth)
│   │   ├── SKILL.md                    # HARD-GATE, lighter path for <5 beads, 65% context budget
│   │   └── references/
│   │       ├── plan-checker-prompt.md  # 8-dimension structural checker
│   │       └── bead-reviewer-prompt.md # Fresh-eyes bead quality review
│   ├── swarming/                       # Phase 5: Parallel execution (shared locks, region hints)
│   │   ├── SKILL.md                    # HARD-GATE on concurrency safety
│   │   └── references/
│   │       ├── worker-spawn-template.md # Self-routing Worker spawn template (region hints)
│   │       └── message-templates.md    # beads_village messaging formats (thread parameter)
│   ├── compounding/                    # Phase 7: Learning flywheel (pruning, domain tags)
│   │   ├── SKILL.md                    # HARD-GATE, pruning at >50 entries, archive oldest 20
│   │   └── references/
│   │       ├── learnings-template.md   # YAML template with domain tags
│   │       └── learnings-retrieval-protocol.md # 5-step protocol for consuming learnings
│   ├── debugging/SKILL.md              # Systematic debugging (triage → reproduce → diagnose → fix → learn)
│   ├── prompt-leverage/                # Automatic prompt enhancement
│   │   ├── SKILL.md
│   │   └── references/
│   │       └── framework.md            # Framework block definitions
│   ├── cancel/SKILL.md               # Cancel active session
│   └── doctor/SKILL.md               # Diagnose workspace health
├── test/
│   └── run-tests.mjs                  # Hook simulation test harness
├── .oh-my-beads/                       # Runtime workspace (per-project)
│   ├── state/
│   │   ├── session.json                # Current phase, progress, reinforcement count
│   │   ├── tool-tracking.json          # Files modified, failures detected
│   │   └── subagent-tracking.json      # Spawned subagent lifecycle
│   ├── priority-context.md             # Critical context loaded every session (max 500 chars)
│   ├── plans/plan.md                   # Approved implementation plan
│   ├── handoffs/phase_<N>.md           # Phase transition context
│   └── history/
│       ├── <feature>/CONTEXT.md        # Locked decisions
│       ├── <feature>/WRAP-UP.md        # Session summary
│       ├── working-memory.md           # Accumulated working memory (<remember> tags)
│       └── learnings/                  # Compounding flywheel
│           ├── critical-patterns.md    # Promoted critical learnings (read at session start)
│           └── YYYYMMDD-<slug>.md      # Per-feature structured learnings
├── AGENTS.md                           # This file
└── .gitignore
```

## Prerequisites

- **beads_village MCP server** — must be installed and configured
- **Claude Code** — the plugin host environment (v1.0+)

The `using-oh-my-beads` bootstrap skill validates prerequisites on session start.

## Installation

### Option 1: Add as marketplace (recommended)

Add to your `~/.claude/settings.json`:
```json
{
  "extraKnownMarketplaces": {
    "oh-my-beads": {
      "source": {
        "source": "github",
        "repo": "LNS2905/oh-my-beads"
      }
    }
  },
  "enabledPlugins": {
    "oh-my-beads@oh-my-beads": true
  }
}
```

### Option 2: Local development

1. Clone the repo
2. Claude Code auto-discovers `.claude-plugin/plugin.json` in the working directory
3. Skills become available as `/oh-my-beads:<skill-name>`

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **OhMyBeads** (15858 symbols, 48696 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/OhMyBeads/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/OhMyBeads/context` | Codebase overview, check index freshness |
| `gitnexus://repo/OhMyBeads/clusters` | All functional areas |
| `gitnexus://repo/OhMyBeads/processes` | All execution flows |
| `gitnexus://repo/OhMyBeads/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
