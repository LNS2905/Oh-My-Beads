# Oh-My-Beads — AGENTS.md

> Multi-agent orchestration plugin for Claude Code.
> Uses **beads_village** as the single source of truth for task tracking, dependency management, and concurrency safety.
> All execution on the primary directory — **no git worktrees**.

## Modes

Oh-My-Beads has two execution modes:

| Mode | Keyword | Agents | HITL Gates | beads_village | Use For |
|------|---------|--------|------------|---------------|---------|
| **Mr.Beads** | `omb`, `oh-my-beads`, `mr.beads` | Scout → Architect → Worker → Reviewer | 3 gates | Full (tasks + locks) | Complex features, multi-file changes, new systems |
| **Mr.Fast** | `mr.fast`, `mrfast` | Fast Scout → Executor | 0 gates | Lite (locks only) | Bug fixes, small changes, root cause analysis |

### Mr.Beads Flow (8-step)
```
Scout → Gate 1 → Architect → Gate 2 → Plan → Decomposition → Validation → Gate 3 → Workers → Reviews → Summary
```

### Mr.Fast Flow (2-step)
```
Fast Scout (0-2 questions) → Executor (implement + verify)
```

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

## The 8-Step Workflow

The Master Orchestrator enforces this sequence strictly. No skipping, no reordering.

```
Phase 1: Requirements & Clarification     [Scout]
   ↓
 GATE 1: User approves locked decisions
   ↓
Phase 2: Planning & Feedback               [Architect]
   ↓
 GATE 2: User approves plan (with enhancement feedback)
   ↓
Phase 3: Plan Persistence                  [Master]
   ↓
Phase 4: Team Init & Task Breakdown        [Architect + beads_village]
   ↓
Phase 5: Task Description Review           [Reviewer: validate mode]
   ↓
 GATE 3: User chooses Sequential or Parallel
   ↓
Phase 6: Execution                         [Worker(s)]
   ↓
Phase 7: Per-Task Quality Review           [Reviewer: review mode, per bead]
   ↓
Phase 8: Final Summary & Compounding       [Master]
```

---

## Phase Details

### Phase 1: Requirements & Clarification

**Agent:** Scout | **Skill:** `oh-my-beads:scout`

The Scout clarifies requirements through Socratic dialogue:
- One question at a time (never batched)
- Domain classification: SEE | CALL | RUN | READ | ORGANIZE
- Gray areas probed by impact priority
- Decisions locked as D1, D2, D3...

**Output:** `.oh-my-beads/history/<feature>/CONTEXT.md`

**HITL Gate 1:** User reviews and approves locked decisions before planning begins.

### Phase 2: Planning & Feedback

**Agent:** Architect (planning mode) | **Skill:** `oh-my-beads:architect`

The Architect:
1. Reads CONTEXT.md (locked decisions)
2. Researches codebase deeply
3. Produces plan with stories, acceptance criteria, file scopes, risks

**Output:** Draft plan (returned to Master)

**HITL Gate 2:** User reviews the plan. Can approve, provide enhancement feedback (Architect revises), or start over.

### Phase 3: Plan Persistence

**Agent:** Master (direct)

Once the user approves, the Master writes the plan to persistent files:
- `.oh-my-beads/plans/plan.md` — canonical location
- `.oh-my-beads/plan.md` — top-level convenience copy

This ensures the plan survives context compaction or session restarts.

### Phase 4: Team Init & Task Breakdown

**Agent:** Architect (decomposition mode) | **beads_village:** `init()`, `add()`

1. Master initializes beads_village: `init(team="oh-my-beads", leader=true)`
2. Architect decomposes each story into beads:
   - `add(title, desc, typ, pri, tags, deps)` per bead
   - Dependencies declared via `deps=["issue:bd-N"]`
   - File scope isolation enforced
3. Master verifies graph: `graph()`, `bv_insights()` (check for cycles)

### Phase 5: Task Description Review

**Agent:** Reviewer (validate mode) | **Skill:** `oh-my-beads:reviewer`

Before any code is written, the Reviewer audits every bead across 6 dimensions:

| Dimension | Question | FAIL Condition |
|-----------|----------|----------------|
| Clarity | Can a dev implement from description alone? | Ambiguous or incomplete |
| Scope | Do file scopes overlap between beads? | Same file, no region spec |
| Dependencies | Are deps correct and complete? | Missing, circular, or dangling |
| Acceptance Criteria | Are criteria concrete and verifiable? | Vague ("works correctly") |
| Context Budget | Is description under 2000 chars? | Exceeds budget |
| Completeness | Do beads cover the full plan? | Stories without beads |

**Max 3 validation iterations.** If still failing: escalate to user.

**HITL Gate 3:** User chooses execution mode (Sequential or Parallel).

### Phase 6: Execution

**Agent:** Worker(s) | **Skill:** `oh-my-beads:worker`

#### Sequential Mode
```
For each ready bead (in dependency order):
  1. Master picks first: ls(status="ready")
  2. Worker spawned with single bead context
  3. Worker: claim() → reserve(paths) → implement → report
  4. → Phase 7 review for this bead
  5. If PASS: done(id) → next bead
  6. If FAIL: re-spawn Worker (max 2 retries)
```

#### Parallel Mode
```
Loop until all beads closed:
  1. Master gets all ready beads: ls(status="ready")
  2. Master checks file conflicts: reservations()
  3. For each conflict-free bead: spawn Worker (background)
  4. As Workers complete → Phase 7 review per bead
  5. On PASS: done(id) → unblocks dependents
  6. On FAIL: re-queue
```

**Concurrency safety:** Entirely via beads_village:
- `reserve(paths)` — exclusive file locks
- `ls(status="ready")` — dependency-aware filtering
- `done(id)` — auto-release + unblock dependents
- No advisory lock files. No git worktrees.

### Phase 7: Per-Task Quality Review

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

### Phase 8: Final Summary & Compounding

**Agent:** Master (direct)

1. Verify all beads closed: `ls(status="open")` returns empty
2. Generate report:
   - Beads completed, files modified, review retries
   - Per-bead change summaries
3. **Compounding advice** — patterns observed for future work:
   - What worked well (repeat)
   - What caused issues (avoid)
   - Conventions established
   - Dependency patterns discovered
4. Write `.oh-my-beads/history/<feature>/WRAP-UP.md`
5. Append learnings to `.oh-my-beads/history/learnings.md`
6. Clear session state

---

## Mr.Fast Workflow

Mr.Fast is the lightweight mode for quick fixes and small changes. No planning, no reviewer,
no HITL gates. Two steps: analyze, then execute.

### Fast Scout Phase

**Agent:** Fast Scout | **Skill:** `oh-my-beads:fast-scout`

The Fast Scout performs rapid codebase analysis:
- Reads relevant files using Glob/Grep/Read
- Identifies root cause, affected files, recommended approach
- Asks 0-2 clarifying questions (only if truly needed)
- Returns inline analysis summary (no CONTEXT.md)

### Execution Phase

**Agent:** Executor | **Skill:** (executor agent, no dedicated skill)

The Executor implements the fix:
1. `reserve(paths)` — lock affected files via beads_village
2. Implement changes following Fast Scout's recommended approach
3. Self-verify: build and test
4. `release()` — unlock files
5. Report results

**Retry:** Max 1 retry if Executor fails, then escalate to user.

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
| **Reviewer** | `agents/reviewer.md` | `oh-my-beads:reviewer` | NO | ls, show, msg | sonnet |
| **Explorer** | `agents/explorer.md` | — | NO | (none) | haiku |
| **Executor** | `agents/executor.md` | — | YES | reserve, release | sonnet/opus |
| **Verifier** | `agents/verifier.md` | — | NO | (none) | sonnet |
| **Code Reviewer** | `agents/code-reviewer.md` | — | NO | (none) | opus |
| **Security Reviewer** | `agents/security-reviewer.md` | — | NO | (none) | sonnet |
| **Test Engineer** | `agents/test-engineer.md` | — | Test files only | (none) | sonnet |

## Context Isolation

Sub-agents receive ONLY what they need:

| Agent | Receives | Does NOT Receive |
|-------|----------|-----------------|
| Scout | User request, feature slug | Plans, beads, code |
| Architect | CONTEXT.md, handoffs | Scout's conversation, other agents |
| Worker | Single bead description + referenced decisions | Full plan, other beads, chat history |
| Reviewer | Bead details + worker output OR bead list | Full plan (review mode), chat history |

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
| Gate 2 | Phase 2 → 3 | Implementation plan (with feedback loop) | YES |
| Gate 3 | Phase 5 → 6 | Execution mode (Sequential / Parallel) | YES |

All gates are **mandatory and blocking**.

## Error Recovery

| Error | Action |
|-------|--------|
| Worker fails implementation | Re-spawn with failure context (max 2 retries → escalate) |
| Review rejects bead | Re-spawn Worker with feedback (max 2 retries → escalate) |
| beads_village error | `doctor()` → retry → if still fails, pause and report |
| File lock conflict (parallel) | Defer bead to next cycle |
| Context budget exceeded | Write handoff, spawn fresh sub-agent |
| User cancels mid-session | Write state, clean up active beads |

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
│   ├── keyword-detector.mjs            # UserPromptSubmit: "omb" detection
│   ├── session-start.mjs              # SessionStart: bootstrap + resume
│   ├── pre-tool-enforcer.mjs          # PreToolUse: role-based access control
│   ├── post-tool-verifier.mjs         # PostToolUse: failure detection & tracking
│   ├── persistent-mode.cjs            # Stop: autonomy engine (blocks premature stops)
│   ├── subagent-tracker.mjs           # Subagent lifecycle tracking
│   └── verify-deliverables.mjs        # Verify subagent outputs by role
├── skills/                             # All skills at plugin root
│   ├── using-oh-my-beads/SKILL.md      # Bootstrap & entry point
│   ├── mr-fast/SKILL.md                # Mr.Fast entry point
│   ├── master/SKILL.md                 # Master Orchestrator (8-step)
│   ├── scout/SKILL.md                  # Phase 1: Socratic exploration
│   ├── fast-scout/SKILL.md             # Mr.Fast: Rapid analysis
│   ├── architect/SKILL.md              # Phases 2-4: Planning & decomposition
│   ├── worker/SKILL.md                 # Phase 6: Implementation
│   ├── reviewer/SKILL.md              # Phases 5 & 7: Validation & review
│   ├── cancel/SKILL.md               # Cancel active session
│   └── doctor/SKILL.md               # Diagnose workspace health
├── test/
│   └── run-tests.mjs                  # Hook simulation test harness
├── .oh-my-beads/                       # Runtime workspace (per-project)
│   ├── state/
│   │   ├── session.json                # Current phase, progress, reinforcement count
│   │   ├── tool-tracking.json          # Files modified, failures detected
│   │   └── subagent-tracking.json      # Spawned subagent lifecycle
│   ├── plans/plan.md                   # Approved implementation plan
│   ├── handoffs/phase_<N>.md           # Phase transition context
│   └── history/
│       ├── <feature>/CONTEXT.md        # Locked decisions
│       ├── <feature>/WRAP-UP.md        # Session summary
│       └── learnings.md                # Compounding advice
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
