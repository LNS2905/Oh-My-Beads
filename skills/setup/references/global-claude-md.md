<!-- OMB:START -->
<!-- OMB:VERSION:2.0.0 -->

# Oh-My-Beads — Multi-Agent Orchestration Plugin

Oh-My-Beads (OMB) is a Claude Code plugin with two modes: **Mr.Beads** (7-phase workflow with 3 HITL gates for complex features) and **Mr.Fast** (lightweight tiered workflow for quick fixes). Uses **beads_village** MCP for task tracking, dependency management, and file locking.

<operating_principles>
- Delegate specialized work to the most appropriate agent via subagent spawning.
- Verify outcomes before claiming completion — evidence over assumptions.
- Choose the lightest path: trivial → Mr.Fast turbo, moderate → Mr.Fast standard, complex → Mr.Beads.
- Respect HITL gates — never skip user approval checkpoints in Mr.Beads.
- Preserve context isolation — each subagent receives only what it needs.
</operating_principles>

<keyword_triggers>
| Keyword | Action | Skill |
|---------|--------|-------|
| `omb`, `oh-my-beads`, `mr.beads` | Mr.Beads (complex) | `oh-my-beads:master` |
| `mr.fast`, `mrfast` | Mr.Fast (quick fix) | `oh-my-beads:fast-scout` or `oh-my-beads:executor` |
| `cancel omb`, `cancel mrfast` | Cancel session | `oh-my-beads:cancel` |
| `setup omb` | Setup wizard | `oh-my-beads:setup` |
| `doctor omb` | Diagnose workspace | `oh-my-beads:doctor` |
| `learn this` | Extract reusable knowledge | `oh-my-beads:learner` |
| `fetch docs` | Fetch SDK/API docs | `oh-my-beads:external-context` |

Invoke skills directly: `/oh-my-beads:<name>`. Keywords are auto-detected — no manual invocation needed.
</keyword_triggers>

<delegation_model>
| Agent | Role | Model |
|-------|------|-------|
| Master | Orchestrates 7-phase workflow | opus |
| Scout | Requirements & clarification (Phase 1) | opus |
| Architect | Planning & decomposition (Phases 2-3) | opus |
| Worker | Implementation — single bead (Phase 5) | sonnet |
| Reviewer | Quality review — per-bead + full (Phase 6/6.5) | sonnet |
| Fast Scout | Rapid analysis for Mr.Fast | sonnet |
| Executor | Implementation for Mr.Fast | sonnet |
| Explorer | Fast codebase search | haiku |

Models configurable via `~/.oh-my-beads/config.json`.
</delegation_model>

<hooks_summary>
10 hooks: UserPromptSubmit (keyword-detector + skill-injector), SessionStart (resume + project memory), PreToolUse (role enforcement), PostToolUse (failure detection + file tracking + remember tags), PostToolUseFailure (retry tracking), Stop (context-guard + persistent-mode), PreCompact (checkpoint), SubagentStart/SubagentStop (lifecycle), SessionEnd (cleanup).
Persistence: `<remember>` (appends to working-memory.md), `<remember priority>` (overwrites priority-context.md).
Quiet mode: `OMB_QUIET` env var (0=normal, 1=reduced, 2=errors only).
</hooks_summary>

<state_paths>
Runtime: `~/.oh-my-beads/projects/{hash}/` (session.json, project-memory.json, handoffs/)
Artifacts: `.oh-my-beads/plans/`, `.oh-my-beads/history/`, `.oh-my-beads/skills/`, `.oh-my-beads/context/`
Config: `~/.oh-my-beads/config.json`
No per-project setup needed — SessionStart auto-creates all dirs.
</state_paths>

<verification>
Mr.Beads: Workers best-effort verify. Reviewer runs full build+test+lint as batch merge. Phase 6.5 runs 3 specialist agents.
Mr.Fast: Executor self-verifies. No mandatory review.
</verification>

<cancellation>
Say `cancel omb` or `cancel mrfast`. Uses 30s TTL signal to prevent race conditions.
</cancellation>

## Setup

Say `setup omb` or run `/oh-my-beads:setup`.

<!-- OMB:END -->
