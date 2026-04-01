# Oh-My-Beads — CLAUDE.md

> Multi-agent orchestration plugin for Claude Code.
> This file tells Claude how to develop, test, and maintain this plugin.

## Project Overview

Oh-My-Beads (OMB) is a Claude Code plugin with two execution modes:
- **Mr.Beads** — autonomous 8-step workflow with 3 HITL gates for complex features
- **Mr.Fast** — lightweight 2-step workflow (Scout → Executor) for quick fixes

Both modes use **beads_village** MCP for task tracking, dependency management, and file locking.

**Agents**: Master, Scout, Fast Scout, Architect, Worker, Reviewer, Explorer, Executor,
Verifier, Code Reviewer, Security Reviewer, Test Engineer.

**Skills**: using-oh-my-beads (Mr.Beads bootstrap), mr-fast (Mr.Fast bootstrap),
master, scout, fast-scout, architect, worker, reviewer, compounding, prompt-leverage, cancel, doctor.

## Architecture

```
User → keyword-detector (hook) → mode routing:
  "omb"/"mr.beads" → Mr.Beads bootstrap → Master skill (8-step)
  "mr.fast"        → Mr.Fast bootstrap → Fast Scout → Executor

Mr.Beads:
  Master → Scout (Phase 1) → HITL Gate 1
         → Architect (Phase 2) → HITL Gate 2
         → Plan persistence (Phase 3)
         → Architect decomposition (Phase 4)
         → Reviewer validation (Phase 5) → HITL Gate 3
         → Worker execution + Reviewer review loop (Phase 6-7)
         → Final summary (Phase 8)

Mr.Fast:
  Fast Scout (0-2 questions) → Executor (reserve → implement → verify → release)
```

### Key Directories

- `scripts/` — Hook scripts (Node.js, `.mjs`/`.cjs`)
- `scripts/state-tools/` — State bridge CLI + shared state resolver (`resolve-state-dir.mjs`)
- `agents/` — Agent role definitions (12 agents)
- `skills/` — Skill definitions (12 skills, including compounding + prompt-leverage)
- `hooks/` — Hook configuration (`hooks.json`)
- `.oh-my-beads/state/` — Runtime session state (not committed)
- `test/` — Test harness (136 tests)

### State Model

Session state lives in `.oh-my-beads/state/session.json`:

```json
{
  "active": true,
  "mode": "mr.beads",
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
- `current_phase` (not `phase`)
- `started_at` (not `startedAt`)
- `cancelled_at` (not `cancelledAt`)
- `last_checked_at` (not `lastCheckedAt`)
- `reinforcement_count` (not `reinforcementCount`)
- `revision_count` (Phase 2 revision tracking, max 3, not `revisionCount`)

Additional state files:
- `tool-tracking.json` — files modified, failures detected by PostToolUse hook
- `subagent-tracking.json` — spawned subagent lifecycle (role, start/stop, status)
- `checkpoint.json` — pre-compaction checkpoint for context recovery
- `last-tool-error.json` — last tool failure, retry count, escalation state (PostToolUseFailure hook)
- `cancel-signal.json` — cancel signal with 30s TTL (prevents TOCTOU race on cancel)

### Session-Scoped State

State supports session-scoped paths for multi-session isolation:
```
.oh-my-beads/state/session.json                        (legacy, primary)
.oh-my-beads/state/sessions/{sessionId}/session.json    (session-scoped)
```

All hooks use `resolveStateDir(baseDir, data)` from `scripts/state-tools/resolve-state-dir.mjs` (ESM)
or inline equivalent (CJS) to resolve the correct path. Session ID is read from `data.session_id`,
`data.sessionId`, or `CLAUDE_SESSION_ID` env var. Falls back to legacy path when unavailable.

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
| UserPromptSubmit | keyword-detector.mjs | 5s | Detect "omb"/"mr.fast"/"mr.beads", route to mode |
| SessionStart | session-start.mjs | 5s | Banner, resume detection, post-compaction auto-resume |
| PreToolUse | pre-tool-enforcer.mjs | 3s | Role-based tool access (engine-level blocking) + Bash safety |
| PostToolUse | post-tool-verifier.mjs | 5s | Failure detection, file tracking |
| PostToolUseFailure | post-tool-use-failure.mjs | 3s | Track tool failures, retry counts, escalation at 5 retries |
| Stop | context-guard-stop.mjs | 3s | Detect context pressure, allow context-limit stops through |
| Stop | persistent-mode.cjs | 5s | Block premature stops, write checkpoints |
| PreCompact | pre-compact.mjs | 5s | Save checkpoint + handoff before compaction |
| SubagentStart | subagent-tracker.mjs | 3s | Track subagent lifecycle (role, start time) |
| SubagentStop | subagent-tracker.mjs, verify-deliverables.mjs | 5s | Verify deliverables, update tracking state |
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

### Agent Role Matrix

| Agent | Write | Edit | Agent | beads_village mutations | Notes |
|-------|-------|------|-------|------------------------|-------|
| Master | .oh-my-beads/ only | NO | YES | init/ls/show/done/assign/graph/bv_plan/bv_insights/reservations/doctor/msg/inbox | Never writes code |
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

136 tests across 22 suites covering:
- keyword-detector (10 tests): keyword detection, informational filtering (±80 char window), cancel with signal file, CC prompt field
- persistent-mode (15 tests): block/allow, circuit breaker, staleness, CC-format stop hook, cancel signal TTL, awaiting_confirmation
- post-tool-verifier (8 tests): failure detection (word-boundary patterns), file tracking, counters
- pre-tool-enforcer (15 tests): all 11 roles, Bash safety, file restrictions
- state-bridge (7 tests): CRUD operations, list, status
- verify-deliverables (5 tests): scout/architect/worker/unknown role checks
- subagent-tracker (2 tests): start/stop lifecycle
- pre-compact (4 tests): checkpoint writing, handoff creation, systemMessage re-injection
- session-start post-compaction (4 tests): auto-resume from checkpoint, handoff loading, startup modes
- keyword-detector Mr.Fast (8 tests): mr.fast/mrfast detection, mr.beads, cancel, session state
- persistent-mode Mr.Fast (3 tests): fast_scout/fast_execution/fast_complete phase handling
- pre-tool-enforcer Mr.Fast (3 tests): fast-scout role restrictions
- verify-deliverables Mr.Fast (1 test): fast-scout verification without CONTEXT.md
- pre-tool-enforcer Audit (13 tests): file restrictions, Bash blocklist expansions, over-blocking prevention
- prompt-leverage unit (13 tests): task detection, intensity inference, framework blocks, mode capping
- prompt-leverage integration (4 tests): keyword-detector augmented output for both modes
- post-tool-use-failure (5 tests): retry tracking, escalation at threshold, tool change reset, graceful fallback
- session-end (4 tests): deactivation, critical phase preservation, inactive passthrough, error cleanup
- context-guard-stop (3 tests): inactive passthrough, normal stop passthrough, context pressure detection
- keyword-detector Worker Guard (3 tests): OMB_AGENT_ROLE skip, OMB_TEAM_WORKER skip, normal detection
- post-tool-verifier Output Clipping (3 tests): clipping >12k, passthrough <12k, env override
- post-tool-verifier Session-Scoped State (2 tests): session_id scoped path, legacy fallback

### Adding a New Agent

1. Create `agents/<role>.md` with frontmatter: `name`, `description`, `model`, `level`, `disallowedTools`
2. Add role restrictions to `scripts/pre-tool-enforcer.mjs` ROLE_RESTRICTIONS
3. Add expected deliverables to `scripts/subagent-tracker.mjs` ROLE_DELIVERABLES
4. Update AGENTS.md agent table
5. Add tests in `test/run-tests.mjs`

### Adding a New Skill

1. Create `skills/<name>/SKILL.md` with frontmatter and full skill content
2. If keyword-triggered, add pattern to `scripts/keyword-detector.mjs`
3. Update AGENTS.md directory structure

### Adding a New Hook

1. Add script in `scripts/`
2. Wire in `hooks/hooks.json` using `run.cjs` wrapper
3. Add tests in `test/run-tests.mjs`
4. Document in this file's Hook Events table

## Conventions

- Snake_case for JSON state fields
- camelCase for JavaScript variables
- Agents use Markdown frontmatter format
- Skills use SKILL.md with frontmatter
- All hook outputs: `{ continue: true, hookSpecificOutput: { hookEventName, additionalContext? } }`
- Stop hook uses `{ decision: "block", reason }` to prevent stops
- Never commit `.oh-my-beads/state/` contents (runtime only)

## Commands

```bash
# Run tests (136 tests, all must pass)
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

# Check session state directly
cat .oh-my-beads/state/session.json
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
