# Oh-My-Beads — CLAUDE.md

> Multi-agent orchestration plugin for Claude Code.
> This file tells Claude how to develop, test, and maintain this plugin.

## Project Overview

Oh-My-Beads (OMB) is a Claude Code plugin providing an autonomous 8-step
development workflow with specialized agents coordinated by a Master Orchestrator.
It uses **beads_village** MCP for task tracking, dependency management, and file locking.

**Agents**: Master, Scout, Architect, Worker, Reviewer, Explorer, Executor,
Verifier, Code Reviewer, Security Reviewer, Test Engineer.

**Skills**: using-oh-my-beads (bootstrap), master, scout, architect, worker,
reviewer, cancel, doctor.

## Architecture

```
User → keyword-detector (hook) → bootstrap skill → Master skill
  Master → Scout (Phase 1) → HITL Gate 1
         → Architect (Phase 2) → HITL Gate 2
         → Plan persistence (Phase 3)
         → Architect decomposition (Phase 4)
         → Reviewer validation (Phase 5) → HITL Gate 3
         → Worker execution + Reviewer review loop (Phase 6-7)
         → Final summary (Phase 8)
```

### Key Directories

- `scripts/` — Hook scripts (Node.js, `.mjs`/`.cjs`)
- `scripts/state-tools/` — State bridge CLI
- `agents/` — Agent role definitions (11 agents)
- `skills/` — Skill definitions (8 skills)
- `hooks/` — Hook configuration (`hooks.json`)
- `.oh-my-beads/state/` — Runtime session state (not committed)
- `test/` — Test harness (62 tests)

### State Model

Session state lives in `.oh-my-beads/state/session.json`:

```json
{
  "active": true,
  "current_phase": "phase_2_planning",
  "started_at": "2025-01-01T00:00:00.000Z",
  "last_checked_at": "2025-01-01T00:01:00.000Z",
  "reinforcement_count": 3,
  "feature_slug": "rest-api",
  "failure_count": 0
}
```

**Canonical field names** (use these, not alternatives):
- `current_phase` (not `phase`)
- `started_at` (not `startedAt`)
- `cancelled_at` (not `cancelledAt`)
- `last_checked_at` (not `lastCheckedAt`)
- `reinforcement_count` (not `reinforcementCount`)

Additional state files:
- `tool-tracking.json` — files modified, failures detected by PostToolUse hook
- `subagent-tracking.json` — spawned subagent lifecycle (role, start/stop, status)
- `checkpoint.json` — pre-compaction checkpoint for context recovery

### Session-Scoped State

State supports session-scoped paths for multi-session isolation:
```
.oh-my-beads/state/session.json                        (legacy, primary)
.oh-my-beads/state/sessions/{sessionId}/session.json    (session-scoped)
```

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
| UserPromptSubmit | keyword-detector.mjs | 5s | Detect "omb"/"oh-my-beads", trigger skill |
| SessionStart | session-start.mjs | 5s | Banner, resume detection |
| PreToolUse | pre-tool-enforcer.mjs | 3s | Role-based tool access + Bash safety |
| PostToolUse | post-tool-verifier.mjs | 5s | Failure detection, file tracking |
| Stop | persistent-mode.cjs | 5s | Block premature stops, write checkpoints |

### Safety Mechanisms

| Mechanism | Implementation | Trigger |
|-----------|---------------|---------|
| **Stop blocking** | persistent-mode.cjs | Claude tries to stop during active phase |
| **Circuit breaker** | 50 max reinforcements | Runaway blocking |
| **Staleness timeout** | 2-hour threshold | Abandoned sessions |
| **Context limit bypass** | isContextLimitStop() | Token exhaustion |
| **User abort respect** | isUserAbort() | Ctrl+C / manual cancel |
| **Checkpoint on compact** | writeCheckpoint() | Context limit stop |
| **Role enforcement** | pre-tool-enforcer.mjs | Wrong agent uses wrong tool |
| **Bash blocklist** | BASH_BLOCKLIST[] | rm -rf /, DROP DATABASE, etc. |
| **File tracking** | post-tool-verifier.mjs | Worker modifies files |
| **Failure detection** | FAILURE_KEYWORDS[] | Build/test/compile errors |

### Agent Role Matrix

| Agent | Write | Edit | Agent | beads_village mutations | Notes |
|-------|-------|------|-------|------------------------|-------|
| Master | NO | NO | YES | init/ls/show/done/assign | Never writes code |
| Scout | NO | NO | NO | none | Read-only exploration |
| Architect | NO | NO | NO | add (via Master) | Plans only |
| Worker | YES | YES | NO | claim/reserve/release/msg | Single bead |
| Reviewer | NO | NO | NO | ls/show/msg | Read-only quality |
| Explorer | NO | NO | NO | none | Fast search |
| Executor | YES | YES | NO | none | General impl |
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

62 tests across 7 suites covering:
- keyword-detector (8 tests): keyword detection, informational filtering, cancel
- persistent-mode (14 tests): block/allow, circuit breaker, staleness, checkpoint
- post-tool-verifier (8 tests): failure detection, file tracking, counters
- pre-tool-enforcer (15 tests): all 11 roles, Bash safety, file restrictions
- state-bridge (7 tests): CRUD operations, list, status
- verify-deliverables (5 tests): scout/architect/worker/unknown role checks
- subagent-tracker (2 tests): start/stop lifecycle
- pre-compact (3 tests): checkpoint writing, handoff creation

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
# Run tests (62 tests, all must pass)
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
