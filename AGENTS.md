# Oh-My-Beads — AGENTS.md

> Multi-agent orchestration plugin for Claude Code.
> Uses **beads_village** as the single source of truth for task tracking, dependency management, and concurrency safety.
> All execution on the primary directory — **no git worktrees**.

## Quick Start

```bash
# Invoke the plugin
/oh-my-beads:using-oh-my-beads

# Or trigger via keyword
"oh-my-beads" | "omb"
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

## Agent Roles

| Agent | Skill | Writes Code? | beads_village Tools | Model |
|-------|-------|-------------|-------------------|-------|
| **Master** | `oh-my-beads:master` | NO | init, ls, show, done, assign, graph, bv_plan, bv_insights, reservations, doctor, msg, inbox | opus |
| **Scout** | `oh-my-beads:scout` | NO | (none) | opus |
| **Architect** | `oh-my-beads:architect` | NO | add (via Master) | opus |
| **Worker** | `oh-my-beads:worker` | YES | init, claim, show, reserve, release, msg | sonnet |
| **Reviewer** | `oh-my-beads:reviewer` | NO | ls, show, msg | sonnet |

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
├── hooks/
│   └── hooks.json                      # Session-start bootstrap hook
├── skills/                             # All skills at plugin root
│   ├── using-oh-my-beads/SKILL.md      # Bootstrap & entry point
│   ├── master/SKILL.md                 # Master Orchestrator (8-step)
│   ├── scout/SKILL.md                  # Phase 1: Socratic exploration
│   ├── architect/SKILL.md              # Phases 2-4: Planning & decomposition
│   ├── worker/SKILL.md                 # Phase 6: Implementation
│   └── reviewer/SKILL.md              # Phases 5 & 7: Validation & review
├── .oh-my-beads/                       # Runtime workspace (per-project)
│   ├── state/session.json              # Current phase, progress
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
