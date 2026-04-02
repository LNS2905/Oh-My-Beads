---
name: swarming
description: >-
  Orchestrates parallel Worker agents for feature execution. Use after the
  validating skill approves execution in parallel mode. Initializes coordination
  via beads_village messaging, spawns self-routing Workers, monitors for
  completions/blockers/file conflicts, coordinates rescues and course corrections,
  and hands off to Phase 6 review when all beads are closed. The orchestrator
  TENDS — it never implements beads directly.
level: 4
---

<Purpose>
The Swarming Orchestrator launches and manages parallel Worker agents. It replaces
the simple "spawn one Worker at a time" loop of sequential mode with a concurrent
execution model where multiple Workers self-route through the bead graph using
beads_village's dependency-aware filtering, shared/exclusive file reservation with
region hints, and threaded messaging.

The orchestrator's job is to TEND the swarm: launch workers, monitor coordination via
threaded beads_village messaging, handle escalations, resolve file conflicts, and keep
the swarm moving. It never implements beads directly.
</Purpose>

<Use_When>
- User chose "Parallel" at Gate 3 (Phase 4 validation)
- All beads are validated and approved for execution
- Multiple independent beads exist that can run concurrently
</Use_When>

<Do_Not_Use_When>
- User chose "Sequential" — use the standard Master Phase 5 sequential loop instead
- Only 1-2 beads exist (sequential is simpler and sufficient)
- Beads form a strict chain with no parallelism opportunity
</Do_Not_Use_When>

<Why_This_Exists>
Sequential execution wastes time when beads are independent. A swarm of Workers
claiming beads from the live graph, coordinated through beads_village's shared/exclusive
file locks with region hints and threaded messaging, executes faster while preventing
conflicts. The orchestrator adds intelligent oversight: conflict resolution, blocker
handling, broadcast corrections, and graceful context checkpoint when the coordinator's
context gets heavy.
</Why_This_Exists>

<HARD-GATE>
## Concurrency Safety — Non-Negotiable

**Every file edit MUST be preceded by a successful `reserve()`.** Workers MUST call
`mcp__beads-village__reserve(paths, reason, ttl)` before editing ANY file. If reservation
fails (file locked by another Worker), the Worker MUST report BLOCKED and move to the
next ready bead. Editing without a reservation is a gate violation — no exceptions.

**Every Worker turn MUST end with `release()`.** After reporting completion, Workers
MUST call `mcp__beads-village__release()` to unlock all held files. Failing to release
holds up the entire swarm. The orchestrator MUST verify via `reservations()` that no
stale locks remain.

**Shared locks require region hints.** When two Workers need the same file, use
`mode="shared"` with a `region` hint describing the edit scope (function name, line range,
or module section). beads_village allows concurrent shared access when regions don't overlap.
Without region hints on shared locks, assume non-overlapping (optimistic). Never use
`mode="exclusive"` when shared access with region hints would suffice — exclusive locks
serialize work unnecessarily.

**All messages MUST use `thread` keyed to bead ID.** Worker completion reports, blocker
alerts, and review notifications MUST include `thread="bd-N"` (the bead ID) so that
conversation threads per bead are preserved. The orchestrator uses `inbox(thread="bd-N")`
to retrieve all messages related to a specific bead. Global broadcasts (swarm-wide) use
no thread or a feature-level thread.
</HARD-GATE>

<Execution_Policy>
- The orchestrator NEVER writes source code. Workers implement. Reviewers verify.
- beads_village is the single source of truth for bead state, file locks, and messaging.
- Workers are self-routing: they call `ls(status="ready")` and `claim()` themselves.
- The orchestrator monitors, resolves conflicts, and keeps the swarm healthy.
- No pre-assigned tracks or waves. The live bead graph drives execution order.
- File coordination via `reserve()` / `release()` / `reservations()` with shared/exclusive modes.
- All per-bead communication threaded via `thread="bd-N"` for traceability.
</Execution_Policy>

<Steps>
## Phase 1: Confirm Swarm Readiness

1. Check live bead status:
   ```
   mcp__beads-village__ls(status="ready")     # verify executable work exists
   mcp__beads-village__bv_insights()           # verify no cycles or blockers
   ```

2. Verify prerequisites:
   - Open beads exist with `ready` status
   - Dependency graph is acyclic
   - No unresolved validation blockers remain

3. Determine Worker pool size:
   - Count ready beads with no dependency conflicts
   - Check `mcp__beads-village__reservations()` for existing file locks
   - Recommended: 2-4 Workers for most features (cap at number of ready beads)

4. Update session state:
   ```json
   {
     "current_phase": "phase_5_execution",
     "execution_mode": "parallel",
     "swarm_workers": N
   }
   ```

## Phase 2: Initialize Coordination

Send a swarm start notification via beads_village messaging:

```
mcp__beads-village__msg(
  subj="[SWARM START] <feature-name>",
  body="Swarm initialized. Workers: <N>. Execution model: self-routing via ls(status='ready') + claim(). File coordination via reserve(mode, region)/release(). Report completions and blockers via msg(thread='bd-N').",
  to="all",
  global=true,
  importance="high"
)
```

## Phase 3: Spawn Workers

Spawn Workers in parallel using the Agent tool. Each Worker gets:

```
Agent(
  description="Worker: bead executor",
  prompt="<oh-my-beads:worker skill content>\n\n## Swarm Context\n- Feature: <name>\n- Execution mode: Parallel (self-routing)\n- Your loop: init → ls(status='ready') → claim → reserve(mode, region) → implement → report(thread='bd-N') → release → loop\n- Report completions via msg(subj='[DONE] <bead-id>', to='master', thread='<bead-id>')\n- Report blockers via msg(subj='[BLOCKED] <bead-id>', to='master', thread='<bead-id>', importance='high')\n\n## Region Hints for Shared Files\nWhen your bead's file scope overlaps with another Worker's, use shared reservation with region hints:\n- reserve(paths=['src/app.py'], mode='shared', region='function handleAuth lines 50-120')\n- region describes WHAT you'll edit: function name, line range, or module section\n- Different regions on the same file = concurrent access allowed\n- Same/overlapping regions = conflict (report BLOCKED)\n\n## Startup Hint (optional)\n<hint about a ready bead if one is obvious, labeled as hint not assignment>",
  model="sonnet",
  run_in_background=true
)
```

Load `skills/swarming/references/worker-spawn-template.md` for the full spawn template.

**Worker self-routing loop:**
1. `mcp__beads-village__init(team="oh-my-beads")`
2. `mcp__beads-village__ls(status="ready")` — find claimable work
3. `mcp__beads-village__claim()` — pick up a bead
4. `mcp__beads-village__reserve(paths, reason, ttl, mode, region)` — lock files with region hints
5. Implement + self-verify (best-effort)
6. `mcp__beads-village__msg(subj="[DONE] <id>", thread="<bead-id>")` — report completion
7. `mcp__beads-village__release()` — unlock files
8. Loop back to step 2

Workers do NOT call `done()` — Master/Orchestrator does that after review.

## Phase 4: Monitor + Tend

This is the core orchestrator phase. The swarm is live; now manage it.

### Polling loop

Check beads_village inbox and bead status regularly:

```
mcp__beads-village__inbox(unread=true)         # check for worker messages
mcp__beads-village__ls(status="in_progress")   # active work
mcp__beads-village__ls(status="ready")         # available work
mcp__beads-village__reservations()             # file lock state (includes mode/region)
```

### Handling Worker Completion Reports

When a Worker reports `[DONE] <bead-id>`:

1. Verify the bead state: `mcp__beads-village__show(id=<bead-id>)`
2. Acknowledge receipt: `mcp__beads-village__ack_message(id=<msg-id>)`
3. Spawn Reviewer for the completed bead (Phase 6 review mode):
   ```
   Agent(
     description="Reviewer: bead <id>",
     prompt="<oh-my-beads:reviewer skill>\n\nMODE: review\n\n## Bead\n<bead details>\n## Worker Output\n<completion report>",
     model="sonnet"
   )
   ```
4. On PASS verdict: `mcp__beads-village__done(id=<bead-id>, msg="Approved")`
5. On FAIL verdict: re-spawn Worker with review feedback (max 2 retries per bead)

### Handling Blocker Alerts

When a Worker reports `[BLOCKED] <bead-id>`:

1. Check the thread for context: `mcp__beads-village__inbox(thread="<bead-id>")`
2. Assess severity:
   - **File conflict** → see File Conflict Resolution below
   - **Dependency not met** → check graph, may be a timing issue
   - **Technical failure** → create fix bead or escalate
   - **Needs user decision** → escalate to user immediately
3. Respond via msg with thread: `mcp__beads-village__msg(subj="Re: [BLOCKED]", body=<resolution>, to=<worker>, thread="<bead-id>")`
4. Do not let Workers spin silently on blockers

### File Conflict Resolution

When a Worker needs a file another Worker holds:

1. Check reservations: `mcp__beads-village__reservations()`
2. Identify holder, requester, their modes, and region hints
3. Choose resolution:
   - **Shared access:** If both Workers edit different regions, convert to `mode="shared"` with region hints — both can proceed concurrently
   - **Wait:** Requester defers to next ready bead
   - **Release:** Ask holder to release at safe checkpoint
   - **Defer:** Create follow-up bead for the blocked change
4. Broadcast resolution: `mcp__beads-village__msg(subj="[FILE CONFLICT RESOLVED]", thread="<bead-id>", ...)`

### Overseer Broadcasts

Use when the swarm needs a shared correction (no thread — swarm-wide):

```
mcp__beads-village__msg(
  subj="[OVERSEER] <instruction>",
  to="all", global=true, importance="high",
  body="<correction or new information>"
)
```

Examples:
- "Do not touch file X until blocker Y is cleared"
- "New user decision: D7 is locked, honor it in all remaining work"
- "Build is broken — pause new beads until fix bead completes"

### Context Checkpoint

After each significant event, estimate context budget.

**If context is heavy (many worker interactions processed):**
1. Write checkpoint with swarm state
2. Broadcast pause: `mcp__beads-village__msg(subj="[PAUSE] Orchestrator checkpointing", to="all", global=true, importance="high")`
3. Write handoff to `.oh-my-beads/handoffs/swarming-checkpoint.md`
4. Report to user that orchestrator paused safely and how to resume

## Phase 5: Swarm Complete

When no beads remain `in_progress` and no `ready` beads exist:

1. Final verification:
   ```
   mcp__beads-village__ls(status="open")         # should be empty
   mcp__beads-village__ls(status="in_progress")   # should be empty
   mcp__beads-village__reservations()             # should be empty (no stale locks)
   ```

2. If orphaned or blocked beads remain:
   - Report which beads remain and why
   - Ask user whether to defer, create cleanup beads, or continue later

3. If all beads are closed and reviewed:
   - Update session state:
     ```json
     {
       "current_phase": "phase_5_complete",
       "swarm_complete": true,
       "beads_closed": N,
       "workers_used": K
     }
     ```

4. Handoff:
   `Swarm execution complete. All beads closed and reviewed. Proceed to Phase 6 review.`
</Steps>

<Tool_Usage>
- **beads_village:** ls, show, done, reservations, msg, inbox, ack_message, bv_insights, bv_priority, bv_plan
- **Agent** — Spawn Worker and Reviewer sub-agents
- **Read, Write** — State files and handoffs ONLY (never source code)
- **AskUserQuestion** — Escalate blockers requiring user decision
- **NEVER:** Edit/Write source code, reserve, release, claim (Worker's job)
</Tool_Usage>

<Red_Flags>
Stop and self-correct if you catch yourself doing any of these:
- **Editing source code** — orchestrator never writes code (Workers do)
- **Assigning specific beads** — Workers self-route via `ls(status="ready")` + `claim()`
- **Ignoring file conflicts** — every conflict must be resolved or escalated
- **Skipping review** — every completed bead needs a Reviewer before `done()`
- **Messages without thread** — all per-bead messages must use `thread="bd-N"`
- **Letting stale locks persist** — check `reservations()` regularly, prod Workers to release
</Red_Flags>

<Examples>
<Good>
Orchestrator spawns 3 Workers. Worker-1 and Worker-2 both need `src/routes.ts`.
Worker-1 reserves with `mode="shared", region="function getUser lines 10-50"`.
Worker-2 reserves with `mode="shared", region="function listProducts lines 80-140"`.
Both proceed concurrently — different regions, no conflict.
Worker-3 completes bd-4, sends `msg(subj="[DONE] bd-4", thread="bd-4")`.
Orchestrator spawns Reviewer for bd-4 via `inbox(thread="bd-4")`, gets PASS, calls `done()`.
Why good: Shared locks with region hints enable concurrent edits. Threaded messaging
keeps per-bead conversations organized. Orchestrator tends without writing code.
</Good>

<Bad>
Orchestrator manually assigns specific beads to specific Workers, uses exclusive locks
on all files (blocking other Workers unnecessarily), and sends messages without thread
parameter (making per-bead conversation tracking impossible).
Why bad: Workers self-route (no manual assignment). Shared locks with regions enable
parallelism. Messages must be threaded for traceability.
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- Worker fails same bead 2 times: escalate to user with failure context
- File conflict repeats on same file: bead decomposition may be too coarse — escalate
- No progress after 3 polling cycles: check if all Workers are stuck, escalate if so
- Build/test failures accumulate: create fix beads or stop and escalate
- Orchestrator context heavy: checkpoint and pause gracefully
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] Swarm readiness confirmed (ready beads exist, graph acyclic)
- [ ] Workers spawned with self-routing context and region hint guidance
- [ ] All Worker completions reviewed (Reviewer per bead)
- [ ] All blockers resolved or escalated
- [ ] File conflicts coordinated — shared locks with region hints preferred over exclusive
- [ ] All per-bead messages use `thread="bd-N"` (HARD-GATE)
- [ ] All beads closed via `done()` after review
- [ ] No orphaned or stuck beads remain
- [ ] No stale file reservations remain (`reservations()` is empty)
- [ ] Session state updated
- [ ] Handoff written for Phase 6 review
</Final_Checklist>

<Advanced>
## Reservation Modes

| Mode | Region | Behavior |
|------|--------|----------|
| `exclusive` | — | Only this Worker can access the file. Use for sole ownership. |
| `shared` | `"function parseArgs"` | Multiple Workers can edit the same file if regions don't overlap. |
| `shared` | `"lines 50-120"` | Line-range region hint. beads_village checks for range overlap. |
| `shared` | (empty) | Optimistic shared access — assumes non-overlapping. |

**Prefer shared+region** when beads touch different parts of the same file.
**Use exclusive** only when the bead requires whole-file control (e.g., config files, package.json).

## Message Threading

All per-bead messages use `thread="bd-N"`:
- Worker → Orchestrator: `msg(subj="[DONE] bd-5", thread="bd-5")`
- Orchestrator → Worker: `msg(subj="Re: [BLOCKED] bd-5", thread="bd-5")`
- Orchestrator retrieves bead context: `inbox(thread="bd-5")`

Swarm-wide broadcasts (no thread):
- `msg(subj="[OVERSEER] ...", to="all", global=true)` — no thread, applies to all

## Sequential vs. Parallel Decision Matrix

| Condition | Recommendation |
|-----------|---------------|
| All beads form a strict chain | Sequential |
| 1-2 beads total | Sequential |
| 3+ independent beads | Parallel (swarming) |
| High file overlap between beads | Parallel with shared locks + region hints |
| Feature is time-sensitive | Parallel (faster) |
| Single story with tight coupling | Sequential |
| Multiple stories with independent scope | Parallel |

## Worker Pool Sizing

| Ready Beads | Recommended Workers |
|-------------|-------------------|
| 1-2 | 1 (sequential is better) |
| 3-5 | 2-3 |
| 6-10 | 3-4 |
| 10+ | 4 (cap — more adds coordination overhead) |

## Recovery from Orchestrator Context Checkpoint

When resuming from a checkpoint:

1. Read `.oh-my-beads/handoffs/swarming-checkpoint.md`
2. Check `mcp__beads-village__inbox(unread=true)` for messages during pause
3. Check bead state: `mcp__beads-village__ls(status="open")` + `ls(status="in_progress")`
4. Check `mcp__beads-village__reservations()` for stale locks
5. Resume monitoring loop from Phase 4
</Advanced>
