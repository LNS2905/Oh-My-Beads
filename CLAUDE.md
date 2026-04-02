# Oh-My-Beads — CLAUDE.md

> Multi-agent orchestration plugin for Claude Code.
> This file tells Claude how to develop, test, and maintain this plugin.

## Project Overview

Oh-My-Beads (OMB) is a Claude Code plugin with two execution modes:
- **Mr.Beads** — autonomous 7-phase workflow with intent classification, 3 HITL gates, phase-at-a-time decomposition, and consolidated reviews for complex features
- **Mr.Fast** — lightweight tiered workflow with 3 paths: turbo (single Executor), standard (Fast Scout → Executor), complex (suggest Mr.Beads)

Both modes use **beads_village** MCP for task tracking, dependency management, and file locking.

**Agents**: Master, Scout, Fast Scout, Architect, Worker, Reviewer, Explorer, Executor,
Verifier, Code Reviewer, Security Reviewer, Test Engineer.

**Skills**: master, scout, fast-scout, architect, worker, reviewer, validating, swarming,
compounding, debugging, prompt-leverage, learner, external-context, cancel, doctor, setup,
mr-fast, using-oh-my-beads, statusline, update-plugin.

**Power Features**: Project Memory (cross-session knowledge), Skill Injector (auto-injects
learned skills), Learner (extracts reusable knowledge), Configurable Agent Models
(user-overridable model assignments), External Context (parallel web doc fetching).

## Architecture

```
User → keyword-detector (hook) → intent classification → mode routing:
     → skill-injector (hook) → auto-inject matching learned skills

  "omb"/"mr.beads" → Master skill (7-phase)
    Master classifies intent:
      Trivial → suggest Mr.Fast and stop
      Simple  → compressed path (skip Scout, inline plan)
      Complex → full 7-phase flow

  "mr.fast" → keyword-detector classifies intent:
    Turbo    → Executor directly (no Fast Scout, no beads_village init)
    Standard → Fast Scout → Executor (self-verifies)
    Complex  → suggest Mr.Beads instead (no active session)

  "learn this" → Learner skill (extract knowledge → skill file)
  "fetch docs" → External Context skill (parallel web search → context file)
  "setup omb"  → Setup skill
  "doctor omb" → Doctor skill

Mr.Beads (full flow, phase-at-a-time):
  Phase 0: Load learnings + project memory
  → Scout (Phase 1) → HITL Gate 1
  → Architect planning + plan persistence (Phase 2) → HITL Gate 2
  → Architect decomposition for current phase (Phase 3)
  → Validation (Phase 4) → HITL Gate 3
  → Worker execution (Phase 5) + Reviewer review (Phase 6/6.5)
  → [loop back to Phase 3 if not final phase]
  → Final summary + compounding + skill promotion (Phase 7)

Mr.Fast (turbo path):
  Executor (read → edit → verify → report)

Mr.Fast (standard path):
  Fast Scout (0-2 questions) → Executor (reserve → implement → self-verify → release)
```

### Key Directories

- `scripts/` — Hook scripts (Node.js, `.mjs`/`.cjs`) + shared helpers (`helpers.mjs`/`helpers.cjs`)
- `scripts/state-tools/` — State bridge CLI + shared state resolver (`resolve-state-dir.mjs`)
- `agents/` — Agent role definitions (12 agents)
- `skills/` — Skill definitions (22 skills, including validating, swarming, compounding, debugging, prompt-leverage, learner, external-context)
- `hooks/` — Hook configuration (`hooks.json`)
- `test/` — Test harness

### State Model (Hybrid)

OMB uses a **hybrid state model** — runtime state at system-level, project artifacts at project-level:

| Type | Location | Committed? |
|------|----------|-----------|
| Runtime state | `~/.oh-my-beads/projects/{hash}/` | No |
| Session-scoped | `~/.oh-my-beads/projects/{hash}/sessions/{sessionId}/` | No |
| Handoffs | `~/.oh-my-beads/projects/{hash}/handoffs/` | No |
| Project memory | `~/.oh-my-beads/projects/{hash}/project-memory.json` | No |
| User config | `~/.oh-my-beads/config.json` | No |
| Plans | `{cwd}/.oh-my-beads/plans/` | Yes |
| History/learnings | `{cwd}/.oh-my-beads/history/` | Yes |
| Learned skills | `{cwd}/.oh-my-beads/skills/` | Yes |
| External context | `{cwd}/.oh-my-beads/context/` | Yes |
| Priority context | `{cwd}/.oh-my-beads/priority-context.md` | Yes |

`{hash}` = 8-char SHA-256 of the project's absolute path (deterministic).

Users do **not** need to run `setup omb` per project — the SessionStart hook auto-creates
all required directories. Plans and history are committed to the project repo.

Session state structure (at system-level):

```json
{
  "active": true,
  "mode": "mr.beads",
  "intent": "complex",
  "current_phase": "phase_2_planning",
  "started_at": "2025-01-01T00:00:00.000Z",
  "last_checked_at": "2025-01-01T00:01:00.000Z",
  "reinforcement_count": 3,
  "feature_slug": "rest-api",
  "failure_count": 0,
  "revision_count": 0
}
```

**Canonical field names** (use these, not alternatives):
- `mode` ("mr.beads" | "mr.fast", defaults to "mr.beads" if absent)
- `intent` (Mr.Beads: "trivial" | "simple" | "complex"; Mr.Fast: "turbo" | "standard" | "complex")
- `current_phase` (not `phase`)
- `started_at` (not `startedAt`)
- `cancelled_at` (not `cancelledAt`)
- `last_checked_at` (not `lastCheckedAt`)
- `reinforcement_count` (not `reinforcementCount`)
- `revision_count` (Phase 2 revision tracking, max 3, not `revisionCount`)

Additional state files (system-level):
- `tool-tracking.json` — files modified, failures detected by PostToolUse hook
- `subagent-tracking.json` — spawned subagent lifecycle (role, start/stop, status)
- `checkpoint.json` — pre-compaction checkpoint for context recovery
- `last-tool-error.json` — last tool failure, retry count, escalation state (PostToolUseFailure hook)
- `cancel-signal.json` — cancel signal with 30s TTL (prevents TOCTOU race on cancel)
- `project-memory.json` — auto-detected tech stack, hot paths, directives, notes (Project Memory)
- `injected-skills.json` — tracks which skills have been injected this session (Skill Injector dedup)

### State Path Resolution

All hooks use `resolveStateDir(baseDir, data)` from `scripts/state-tools/resolve-state-dir.mjs` (ESM)
or inline equivalent (CJS) to resolve the correct path. Key helpers:

| Helper | Returns |
|--------|---------|
| `getSystemRoot()` | `~/.oh-my-beads/` (or `$OMB_HOME`) |
| `getProjectStateRoot(cwd)` | `~/.oh-my-beads/projects/{hash}/` |
| `getArtifactsDir(cwd)` | `{cwd}/.oh-my-beads/` |
| `resolveStateDir(cwd, data)` | `{ stateDir, sessionId, legacyDir, projectRoot }` |
| `resolveHandoffsDir(cwd)` | `~/.oh-my-beads/projects/{hash}/handoffs/` |
| `ensureRuntimeDirs(cwd, sid)` | Auto-creates system-level dirs |
| `ensureArtifactDirs(cwd)` | Auto-creates project-level plans/ and history/ |

**Legacy migration**: if state exists at `{cwd}/.oh-my-beads/state/` but not at system-level,
it is read from the legacy path. New writes always go to system-level.

Use the state bridge CLI for uniform access:
```bash
node scripts/state-tools/state-bridge.cjs read [--session-id ID]
node scripts/state-tools/state-bridge.cjs write --phase PHASE [--active true|false]
node scripts/state-tools/state-bridge.cjs list
node scripts/state-tools/state-bridge.cjs clear [--session-id ID]
node scripts/state-tools/state-bridge.cjs status [--session-id ID]
```

### Hook Events

| Hook | Script | Timeout | Purpose |
|------|--------|---------|---------|
| UserPromptSubmit | keyword-detector.mjs | 5s | Detect "omb"/"mr.fast"/"mr.beads"/"setup"/"doctor"/"learn"/"fetch docs", classify Mr.Fast intent (turbo/standard/complex), route to mode, detect user directives |
| UserPromptSubmit | skill-injector.mjs | 5s | Auto-discover learned skills from .oh-my-beads/skills/ and ~/.oh-my-beads/skills/, inject matching skills into prompt |
| SessionStart | session-start.mjs | 5s | Banner, resume detection (both modes), post-compaction auto-resume, project memory injection, priority context loading |
| PreToolUse | pre-tool-enforcer.mjs | 3s | Role-based tool access (engine-level blocking) + Bash safety. Early-returns for inactive sessions. |
| PostToolUse | post-tool-verifier.mjs | 5s | Failure detection, file tracking, output clipping, hot path tracking (Project Memory), `<remember>` tag processing. Early-returns for inactive sessions. |
| PostToolUseFailure | post-tool-use-failure.mjs | 3s | Track tool failures, retry counts, escalation at 5 retries |
| Stop | context-guard-stop.mjs | 3s | Detect context pressure, allow context-limit stops through |
| Stop | persistent-mode.cjs | 5s | Block premature stops, write checkpoints |
| PreCompact | pre-compact.mjs | 5s | Save checkpoint + handoff before compaction, include project memory summary in systemMessage |
| SubagentStart | subagent-tracker.mjs | 3s | Track subagent lifecycle (role, start time) |
| SubagentStop | subagent-stop.mjs | 5s | Consolidated: verify deliverables + update tracking state |
| SessionEnd | session-end.mjs | 30s | Clean up state, mark stale sessions, clear transient files |

### Safety Mechanisms

| Mechanism | Implementation | Trigger |
|-----------|---------------|---------|
| **Stop blocking** | persistent-mode.cjs | Claude tries to stop during active phase |
| **Context guard** | context-guard-stop.mjs | Context pressure detected (>85%) → allow stop + checkpoint |
| **Circuit breaker** | 50 max reinforcements | Runaway blocking |
| **Staleness timeout** | 2-hour threshold | Abandoned sessions |
| **Context limit bypass** | isContextLimitStop() | Token exhaustion |
| **User abort respect** | isUserAbort() | Ctrl+C / manual cancel |
| **Checkpoint on compact** | writeCheckpoint() | Context limit stop |
| **Role enforcement** | pre-tool-enforcer.mjs | Wrong agent uses wrong tool |
| **Bash blocklist** | BASH_BLOCKLIST[] | rm -rf /, DROP DATABASE, etc. |
| **File tracking** | post-tool-verifier.mjs | Worker modifies files |
| **Failure detection** | FAILURE_KEYWORDS[] | Build/test/compile errors |
| **Tool failure tracking** | post-tool-use-failure.mjs | Tool errors with retry window (60s) and escalation at 5 |
| **Session cleanup** | session-end.mjs | Session close → deactivate non-critical, clear transient state |
| **Cancel signal TTL** | cancel-signal.json (30s) | Prevents TOCTOU race between cancel and next stop hook |
| **Awaiting confirmation** | awaiting_confirmation flag | Skip blocking until skill initializes |
| **Informational filter** | ±80 char context window | Prevents false triggers on "what is omb?" queries |
| **SystemMessage re-inject** | pre-compact.mjs systemMessage | Session context survives compaction |
| **Worker guard** | OMB_AGENT_ROLE / OMB_TEAM_WORKER env check | Prevents subagent keyword re-triggers (spawn loops) |
| **Output clipping** | MAX_OUTPUT_CHARS (12k default) | Limits large tool outputs, annotates truncation |
| **Session-scoped state** | resolveStateDir() helper | Multi-session isolation via sessions/{id}/ paths |
| **Hybrid state model** | system-level + project-level | Runtime at ~/.oh-my-beads/, artifacts at {cwd}/.oh-my-beads/ |
| **Auto-initialization** | session-start.mjs ensureRuntimeDirs | No manual setup needed per project |
| **Prerequisite checks** | session-start.mjs | Warns if Node < 18 or beads-village missing |
| **Inactive session early-return** | pre-tool-enforcer, post-tool-verifier | Hooks return immediately when no active session → lower overhead |
| **OMB_QUIET levels** | OMB_QUIET env var (0/1/2) | Controls hook output verbosity (0=normal, 1=warnings+errors, 2=errors only) |
| **Intent classification** | keyword-detector.mjs (Mr.Fast), Master skill (Mr.Beads) | Routes tasks to appropriate complexity path |
| **Mode conflict prevention** | keyword-detector.mjs | Blocks "mr.fast" during active Mr.Beads session (and vice versa) |
| **HARD-GATE enforcement** | `<HARD-GATE>` tags in all execution skills | Non-negotiable behavioral constraints in Worker, Reviewer, Swarming, Compounding, Validating |
| **Phase-at-a-time decomposition** | Architect + Master loop | Only current phase beads exist, preventing scope sprawl |
| **Priority context notepad** | session-start.mjs + post-tool-verifier.mjs | `<remember priority>` writes to priority-context.md; loaded every session start |
| **Working memory** | post-tool-verifier.mjs | `<remember>` tags append to history/working-memory.md with timestamps |
| **Project Memory** | project-memory.mjs + session-start.mjs + post-tool-verifier.mjs | Auto-detects tech stack, tracks hot paths, stores user directives; 650-char summary injected every session |
| **Skill Injector** | skill-injector.mjs (UserPromptSubmit hook) | Auto-discovers learned skills from .oh-my-beads/skills/ and injects matching ones into prompts (max 3, session dedup) |
| **Compounding skill promotion** | compounding SKILL.md | HARD-GATE quality gates (Reusable, Actionable, Triggerable) before promoting learnings to skill files |
| **Configurable agent models** | config.mjs + ~/.oh-my-beads/config.json | User can override model per agent role; defaults preserved if config missing |
| **External Context** | external-context SKILL.md | Parallel web search with document-specialist subagents; results saved to .oh-my-beads/context/ |
| **Learner quality gates** | learner SKILL.md | 3-gate quality check (Not Googleable, Codebase-Specific, Real Effort) before saving learned skills |
| **User directive detection** | keyword-detector.mjs | "always use X", "never modify Y" patterns auto-add to project memory directives |

### Agent Role Matrix

| Agent | Write | Edit | Agent | beads_village mutations | Notes |
|-------|-------|------|-------|------------------------|-------|
| Master | YES | YES | YES | init/ls/show/done/assign/graph/bv_plan/bv_insights/reservations/doctor/msg/inbox | Prefers delegating to sub-agents |
| Scout | CONTEXT.md only | NO | NO | none | Read-only exploration (Mr.Beads) |
| Fast Scout | BRIEF.md only | NO | NO | none | Rapid analysis, writes BRIEF.md (Mr.Fast) |
| Architect | plans/ only | NO | NO | add (via Master) | Plans only |
| Worker | YES | YES | NO | init/claim/show/reserve/release/msg | Single bead |
| Reviewer | NO | NO | NO | ls/show/msg | Read-only quality |
| Explorer | NO | NO | NO | none | Fast search |
| Executor | YES | YES | NO | reserve/release | General impl |
| Verifier | NO | NO | NO | none | Independent checks |
| Code Reviewer | NO | NO | NO | none | Deep review (Opus) |
| Security Reviewer | NO | NO | NO | none | Security audit |
| Test Engineer | Tests only | Tests only | NO | none | *.test.* files |

## Development Rules

### Scripts

- All hook scripts read JSON from stdin and write JSON to stdout
- Scripts must never block indefinitely — use timeouts
- Scripts must fail gracefully (catch errors, write safe output)
- Use `.cjs` for CommonJS (required by Stop hook), `.mjs` for ESM
- All scripts are spawned via `run.cjs` (handles stale plugin paths)

### Testing

Run tests: `node test/run-tests.mjs`

331 tests across 55+ suites covering:
- keyword-detector (10 tests): keyword detection, informational filtering (±80 char window), cancel with signal file, CC prompt field
- persistent-mode (15 tests): block/allow, circuit breaker, staleness, CC-format stop hook, cancel signal TTL, awaiting_confirmation
- post-tool-verifier (8 tests): failure detection (word-boundary patterns), file tracking, counters
- pre-tool-enforcer (15 tests): all 11 roles, Bash safety, file restrictions
- state-bridge (7 tests): CRUD operations, list, status
- verify-deliverables (5 tests): scout/architect/worker/unknown role checks
- subagent-tracker (2 tests): start/stop lifecycle
- pre-compact (4 tests): checkpoint writing, handoff creation, systemMessage re-injection
- session-start post-compaction (4 tests): auto-resume from checkpoint, handoff loading, startup modes
- session-start first-run detection (3 tests): first-run banner, update banner, no banner
- keyword-detector Mr.Fast (8 tests): mr.fast/mrfast detection, mr.beads, cancel, session state
- persistent-mode Mr.Fast (3 tests): fast_scout/fast_execution/fast_complete phase handling
- pre-tool-enforcer Mr.Fast (4 tests): fast-scout role restrictions
- verify-deliverables Mr.Fast (1 test): fast-scout verification without CONTEXT.md
- pre-tool-enforcer Audit (13 tests): file restrictions, Bash blocklist expansions, over-blocking prevention
- pre-tool-enforcer Role Detection (4 tests): prompt text does NOT trigger roles, env var priority
- prompt-leverage unit (13 tests): task detection, intensity inference, framework blocks, mode capping
- prompt-leverage integration (4 tests): keyword-detector augmented output for both modes
- post-tool-use-failure (5 tests): retry tracking, escalation at threshold, tool change reset, graceful fallback
- session-end (4 tests): deactivation, critical phase preservation, inactive passthrough, error cleanup
- context-guard-stop (3 tests): inactive passthrough, normal stop passthrough, context pressure detection
- keyword-detector Worker Guard (3 tests): OMB_AGENT_ROLE skip, OMB_TEAM_WORKER skip, normal detection
- post-tool-verifier Output Clipping (3 tests): clipping >12k, passthrough <12k, env override
- post-tool-verifier Session-Scoped State (2 tests): session_id scoped path, legacy fallback
- statusline HUD (17+ tests): idle/active display, mode colors, context bar with thresholds, session duration, agents, beads progress, files count, ANSI colors, non-breaking spaces
- shared helpers (8 tests): readJson valid/invalid/missing, writeJsonAtomic, hookOutput with/without systemMessage
- system-level-only writes (3 tests): state writes to system path, no legacy writes
- legacy read fallback (2 tests): resolveStateDir returns legacyDir, state-bridge reads legacy
- inactive-session optimization (2 tests): pre-tool-enforcer and post-tool-verifier early-return
- consolidated SubagentStop (3 tests): tracking, deliverable verification by role
- quiet levels (4 tests): OMB_QUIET=0/1/2 across hooks
- Mr.Fast intent classification (12 tests): turbo/standard/complex detection, session state, ambiguous defaults
- prompt-leverage Light cap (4 tests): mr.fast Light intensity, shorter output, omits first-principles
- persistent-mode turbo (2 tests): fast_turbo phase blocking, continuation guidance
- statusline turbo (2 tests): fast_turbo display, cyan color
- mode conflict prevention (5 tests): mr.fast during active mr.beads and vice versa, clean states
- Mr.Fast resume (3 tests): session-start resumes interrupted mr.fast, failure count, feature slug
- phase renumbering (10 tests): new phase names in persistent-mode, statusline, session-end
- backward compatibility (4 tests): missing intent field across hooks
- cancel during phase-at-a-time (6 tests): cancel at various loop stages
- hook output schema (8 tests): no hookSpecificOutput for SessionEnd/SubagentStop/Stop
- setup & doctor routing (11 tests): setup omb, omb setup, doctor omb, regression, informational
- keyword-detector learner routing (2 tests): "learn this", "remember this pattern"
- keyword-detector external context routing (2 tests): "fetch docs for X", "find docs for X"
- project-memory detectProjectEnv (4 tests): Node.js, pnpm, Go, unknown
- project-memory loadMemory/saveMemory (2 tests): default, round-trip
- project-memory formatSummary (3 tests): default budget, custom budget, empty
- project-memory bounded collections (4 tests): hotPaths max 50, accessCount, notes max 20, directives max 20
- project-memory rescan (4 tests): needsRescan triggers, recent, preserves user data
- project-memory session-start integration (2 tests): injects summary, runs rescan when stale
- project-memory post-tool-verifier hot paths (2 tests): tracks Read, tracks Edit/Write/MultiEdit
- project-memory pre-compact (1 test): adds summary to systemMessage
- project-memory directive detection (2 tests): "always use", "never modify"
- worker prompt recovery pre-compact (4 tests): checkpoint with active worker, plans scan, non-execution, systemMessage
- worker prompt recovery session-start (2 tests): injects path from checkpoint, scans plans directory
- session-start priority context (2 tests): injects when exists, skips when missing
- post-tool-verifier remember tags (3 tests): priority writes, working-memory appends, multiple entries
- skill-injector discovery (2 tests): project and global skill directories
- skill-injector trigger matching (3 tests): case-insensitive, scoring, no-match filter
- skill-injector injection format (1 test): wraps in omb-learned-skills tags
- skill-injector max cap (1 test): caps at MAX_SKILLS=3
- skill-injector quiet level (1 test): OMB_QUIET=2 suppresses output
- skill-injector session dedup (1 test): prevents re-injection
- skill-injector early return (1 test): no skill directories
- skill-injector project overrides global (1 test): same-name override
- config.mjs (4 tests): loadConfig defaults, merges overrides, getModelForRole configured, default fallback
- SubagentStop Mr.Fast agents (4 tests): fast-scout, executor, role detection

### Adding a New Agent

1. Create `agents/<role>.md` with frontmatter: `name`, `description`, `model`, `level`, `disallowedTools`
2. Add role restrictions to `scripts/pre-tool-enforcer.mjs` ROLE_RESTRICTIONS
3. Add expected deliverables to `scripts/subagent-stop.mjs` ROLE_DELIVERABLES
4. Update AGENTS.md agent table
5. Add tests in `test/run-tests.mjs`

### Adding a New Skill

1. Create `skills/<name>/SKILL.md` with frontmatter and full skill content
2. If keyword-triggered, add pattern to `scripts/keyword-detector.mjs`
3. Update AGENTS.md directory structure

### Adding a Learned Skill (via Learner)

1. Invoke `/oh-my-beads:learner` or say "learn this" / "remember this pattern"
2. Learner extracts knowledge, applies 3 quality gates
3. Writes skill file to `{cwd}/.oh-my-beads/skills/{slug}.md` (project) or `~/.oh-my-beads/skills/{slug}.md` (global)
4. Skill injector auto-discovers and injects matching skills in future prompts

### Adding a New Hook

1. Add script in `scripts/`
2. Wire in `hooks/hooks.json` using `run.cjs` wrapper
3. Add tests in `test/run-tests.mjs`
4. Document in this file's Hook Events table

## Conventions

- Snake_case for JSON state fields
- camelCase for JavaScript variables
- Agents use Markdown frontmatter format
- Skills use SKILL.md with frontmatter; critical constraints wrapped in `<HARD-GATE>` tags
- Shared helpers in `scripts/helpers.mjs` (ESM) and `scripts/helpers.cjs` (CJS shim)
- All hook outputs: `{ continue: true, hookSpecificOutput: { hookEventName, additionalContext? } }`
- Stop hook uses `{ decision: "block", reason }` to prevent stops
- Never commit `.oh-my-beads/state/` contents (runtime state is at system-level now)
- Runtime state lives at `~/.oh-my-beads/projects/{hash}/` — never in the project repo
- Project artifacts (plans, history) live at `{cwd}/.oh-my-beads/` — committed to repo
- `OMB_QUIET` env var controls hook output verbosity (0=default, 1=reduced, 2=errors only)

## Commands

```bash
# Run tests (331 tests, all must pass)
node test/run-tests.mjs

# Manual keyword test
echo '{"query":"omb build me X"}' | node scripts/keyword-detector.mjs

# Manual persistent-mode test
echo '{"cwd":"/path/to/project"}' | node scripts/persistent-mode.cjs

# State bridge operations
node scripts/state-tools/state-bridge.cjs read
node scripts/state-tools/state-bridge.cjs write --phase bootstrap --active true
node scripts/state-tools/state-bridge.cjs list
node scripts/state-tools/state-bridge.cjs status
node scripts/state-tools/state-bridge.cjs clear

# Check session state directly (system-level)
cat ~/.oh-my-beads/projects/$(echo -n "$(pwd)" | sha256sum | cut -c1-8)/session.json

# Check project memory
cat ~/.oh-my-beads/projects/$(echo -n "$(pwd)" | sha256sum | cut -c1-8)/project-memory.json

# Check user config (agent model overrides)
cat ~/.oh-my-beads/config.json
```

## Dependencies

- **Runtime**: Node.js 18+, beads_village MCP server
- **No npm dependencies** — all scripts are zero-dependency Node.js

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
