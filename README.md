# Oh-My-Beads -- Multi-Agent Orchestration for Claude Code

Oh-My-Beads (OMB) is a Claude Code plugin that coordinates specialized agents through structured workflows. It splits complex features into dependency-tracked beads managed by beads_village MCP, routes each bead through the right agent (Scout, Architect, Worker, Reviewer), and enforces human-in-the-loop gates so nothing ships without your approval. For smaller fixes it offers a lightweight two-step path that skips the ceremony entirely.

## Quick Start

Just say `omb build me X` or `mr.fast fix Y` in Claude Code.

```
omb build me a REST API with auth        # Full 8-step workflow
mr.fast fix the login validation bug     # Lightweight 2-step workflow
cancel omb                               # Cancel active session
```

## Two Modes

### Mr.Beads -- Full Autonomous Workflow

Eight phases with three mandatory human-in-the-loop (HITL) gates. Designed for complex features, multi-file changes, and new systems.

- **Phase 1** -- Scout clarifies requirements via Socratic dialogue
- **Gate 1** -- You approve locked decisions
- **Phase 2** -- Architect produces implementation plan
- **Gate 2** -- You approve plan (with feedback loop)
- **Phase 3** -- Plan persisted to survive compaction
- **Phase 4** -- Architect decomposes plan into beads (tasks)
- **Phase 5** -- Validation across 8 dimensions, spikes, bead polishing
- **Gate 3** -- You choose Sequential or Parallel execution
- **Phases 6-7** -- Workers implement, Reviewers verify per-bead + full-feature review
- **Phase 8** -- Summary and compounding (learning flywheel)

### Mr.Fast -- Lightweight Workflow

Two steps, zero gates. Designed for bug fixes, small changes, and root cause analysis.

- **Step 1** -- Fast Scout analyzes codebase, asks 0-2 questions
- **Step 2** -- Executor implements, self-verifies, and reports

## Workflow Diagram

```
                           Mr.Beads (8-step)
                           =================

  User ──> keyword-detector ──> prompt-leverage ──> Bootstrap
                                                       |
          ┌────────────────────────────────────────────┘
          v
  Phase 1: Scout (requirements)
          |
      [GATE 1] ── user approves decisions
          |
  Phase 2: Architect (planning)
          |
      [GATE 2] ── user approves plan
          |
  Phase 3: Plan persistence
          |
  Phase 4: Architect (decomposition into beads)
          |
  Phase 5: Validation (8 dimensions + spikes + polish)
          |
      [GATE 3] ── user chooses Sequential / Parallel
          |
  Phase 6: Worker(s) implement beads
          |
  Phase 7: Reviewer per-bead + full-feature review
          |
  Phase 8: Summary + Compounding
          |
         Done


                           Mr.Fast (2-step)
                           ================

  User ──> keyword-detector ──> prompt-leverage ──> Bootstrap
                                                       |
          ┌────────────────────────────────────────────┘
          v
  Step 1: Fast Scout (analyze, 0-2 questions)
          |
  Step 2: Executor (reserve -> implement -> verify -> release)
          |
         Done
```

## Installation

### Marketplace (recommended)

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

Then run `setup omb` in Claude Code to initialize the workspace.

### Local Development

1. Clone the repository
2. Claude Code auto-discovers `.claude-plugin/plugin.json` in the working directory
3. Skills become available as `/oh-my-beads:<skill-name>`

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OMB_MAX_OUTPUT_CHARS` | (none) | Limit agent output size |

Session state is stored in `.oh-my-beads/state/session.json` (runtime only, not committed).

## Agent Roster

| Agent | Role | Writes Code | Model |
|-------|------|-------------|-------|
| Master | Orchestrates the 8-step workflow, enforces gates | No | opus |
| Scout | Socratic requirements clarification (Phase 1) | No | opus |
| Fast Scout | Rapid codebase analysis for Mr.Fast | No | sonnet |
| Architect | Planning, decomposition, bead creation (Phases 2-4) | No | opus |
| Worker | Implements a single bead with file locking (Phase 6) | Yes | sonnet |
| Reviewer | Per-bead and full-feature quality review (Phase 7) | No | sonnet |
| Explorer | Fast codebase search | No | haiku |
| Executor | General implementation for Mr.Fast | Yes | sonnet/opus |
| Verifier | Independent correctness checks | No | sonnet |
| Code Reviewer | Deep code review | No | opus |
| Security Reviewer | OWASP-focused security audit | No | sonnet |
| Test Engineer | Writes and maintains test files only | Tests only | sonnet |

## Skills

| Skill | Purpose |
|-------|---------|
| `using-oh-my-beads` | Mr.Beads bootstrap and entry point |
| `mr-fast` | Mr.Fast bootstrap and entry point |
| `master` | Master Orchestrator (8-step enforcement) |
| `scout` | Phase 1 -- Socratic exploration |
| `fast-scout` | Mr.Fast -- rapid analysis |
| `architect` | Phases 2-4 -- planning and decomposition |
| `worker` | Phase 6 -- single-bead implementation |
| `reviewer` | Phase 7 -- per-bead review and full-feature review |
| `validating` | Phase 5 -- 8-dimension pre-execution verification |
| `swarming` | Phase 6 (parallel) -- orchestrated concurrent workers |
| `compounding` | Phase 8 -- structured learning capture |
| `debugging` | Error recovery -- triage, reproduce, diagnose, fix |
| `prompt-leverage` | Automatic prompt enhancement (both modes) |
| `cancel` | Cancel active session |
| `doctor` | Diagnose workspace health |
| `setup` | Initialize workspace and prerequisites |

## Prerequisites

- **Node.js 18+** -- all scripts are zero-dependency
- **beads_village MCP server** -- task tracking and concurrency management
- **Claude Code** -- the plugin host environment

## Troubleshooting

Run the doctor skill to diagnose workspace issues:

```
/oh-my-beads:doctor
```

This checks beads_village connectivity, state file integrity, hook configuration, and agent definitions.

## Testing

```bash
node test/run-tests.mjs
```

127 tests across 19 suites covering keyword detection, persistent mode, tool enforcement, state management, deliverable verification, prompt leverage, failure tracking, session lifecycle, and context guards.

## License

MIT
