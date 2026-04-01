---
name: swarming
description: >-
  Orchestrates parallel Worker agents for feature execution. Use after the
  validating skill approves execution in parallel mode. Initializes coordination
  via beads_village messaging, spawns self-routing Workers, monitors for
  completions/blockers/file conflicts, coordinates rescues and course corrections,
  and hands off to Phase 7 review when all beads are closed. The orchestrator
  TENDS — it never implements beads directly.
level: 4
---

<Purpose>
The Swarming Orchestrator launches and manages parallel Worker agents. It replaces
the simple "spawn one Worker at a time" loop of sequential mode with a concurrent
execution model where multiple Workers self-route through the bead graph using
beads_village's dependency-aware filtering and file reservation system.

The orchestrator's job is to TEND the swarm: launch workers, monitor coordination via
beads_village messaging, handle escalations, resolve file conflicts, and keep the
swarm moving. It never implements beads directly.
</Purpose>

<Use_When>
- User chose "Parallel" at Gate 3 (validating Phase 5)
- All beads are validated and approved for execution
- Multiple independent beads exist that can run concurrently
</Use_When>

<Do_Not_Use_When>
- User chose "Sequential" — use the standard Master Phase 6 sequential loop instead
- Only 1-2 beads exist (sequential is simpler and sufficient)
- Beads form a strict chain with no parallelism opportunity
</Do_Not_Use_When>

<Why_This_Exists>
Sequential execution wastes time when beads are independent. A swarm of Workers
claiming beads from the live graph, coordinated through beads_village's file locks
and messaging, executes faster while beads_village prevents conflicts. The orchestrator
adds intelligent oversight: conflict resolution, blocker handling, broadcast corrections,
and graceful context checkpoint when the coordinator's context gets heavy.
</Why_This_Exists>

<Execution_Policy>
- The orchestrator NEVER writes source code. Workers implement. Reviewers verify.
- beads_village is the single source of truth for bead state, file locks, and messaging.
- Workers are self-routing: they call `ls(status="ready")` and `claim()` themselves.
- The orchestrator monitors, resolves conflicts, and keeps the swarm healthy.
- No pre-assigned tracks or waves. The live bead graph drives execution order.
- File coordination via beads_village `reserve()` / `release()` / `reservations()`.
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
     "current_phase": "phase_6_swarming",
     "execution_mode": "parallel",
     "swarm_workers": N
   }
   ```

## Phase 2: Initialize Coordination

Send a swarm start notification via beads_village messaging:

```
mcp__beads-village__msg(
  subj="[SWARM START] <feature-name>",
  body="Swarm initialized. Workers: <N>. Execution model: self-routing via ls(status='ready') + claim(). File coordination via reserve()/release(). Report completions and blockers via msg().",
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
  prompt="<oh-my-beads:worker skill content>\n\n## Swarm Context\n- Feature: <name>\n- Execution mode: Parallel (self-routing)\n- Your loop: init → ls(status='ready') → claim → reserve → implement → report → release → loop\n- Report completions via msg(subj='[DONE] <bead-id>', to='master')\n- Report blockers via msg(subj='[BLOCKED] <bead-id>', to='master', importance='high')\n\n## Startup Hint (optional)\n<hint about a ready bead if one is obvious, labeled as hint not assignment>",
  model="sonnet",
  run_in_background=true
)
```

Load `skills/swarming/references/worker-spawn-template.md` for the full spawn template.

**Worker self-routing loop:**
1. `mcp__beads-village__init(team="oh-my-beads")`
2. `mcp__beads-village__ls(status="ready")` — find claimable work
3. `mcp__beads-village__claim()` — pick up a bead
4. `mcp__beads-village__reserve(paths)` — lock files
5. Implement + self-verify
6. `mcp__beads-village__msg(subj="[DONE] <id>")` — report completion
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
mcp__beads-village__reservations()             # file lock state
```

### Handling Worker Completion Reports

When a Worker reports `[DONE] <bead-id>`:

1. Verify the bead state: `mcp__beads-village__show(id=<bead-id>)`
2. Acknowledge receipt: `mcp__beads-village__ack_message(id=<msg-id>)`
3. Spawn Reviewer for the completed bead (Phase 7 review mode):
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

1. Assess severity:
   - **File conflict** → see File Conflict Resolution below
   - **Dependency not met** → check graph, may be a timing issue
   - **Technical failure** → create fix bead or escalate
   - **Needs user decision** → escalate to user immediately
2. Respond via msg: `mcp__beads-village__msg(subj="Re: [BLOCKED]", body=<resolution>, to=<worker>)`
3. Do not let Workers spin silently on blockers

### File Conflict Resolution

When a Worker needs a file another Worker holds:

1. Check reservations: `mcp__beads-village__reservations()`
2. Identify holder and requester
3. Choose resolution:
   - **Wait:** Requester defers to next ready bead
   - **Release:** Ask holder to release at safe checkpoint
   - **Defer:** Create follow-up bead for the blocked change
4. Broadcast resolution: `mcp__beads-village__msg(subj="[FILE CONFLICT RESOLVED]", ...)`

### Overseer Broadcasts

Use when the swarm needs a shared correction:

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
1. Write checkpoint to `.oh-my-beads/state/checkpoint.json` with swarm state
2. Broadcast pause: `mcp__beads-village__msg(subj="[PAUSE] Orchestrator checkpointing")`
3. Write handoff to `.oh-my-beads/handoffs/swarming-checkpoint.md`
4. Report to user that orchestrator paused safely and how to resume

## Phase 5: Swarm Complete

When no beads remain `in_progress` and no `ready` beads exist:

1. Final verification:
   ```
   mcp__beads-village__ls(status="open")         # should be empty
   mcp__beads-village__ls(status="in_progress")   # should be empty
   mcp__beads-village__reservations()             # should be empty
   ```

2. If orphaned or blocked beads remain:
   - Report which beads remain and why
   - Ask user whether to defer, create cleanup beads, or continue later

3. If all beads are closed and reviewed:
   - Update session state:
     ```json
     {
       "current_phase": "phase_6_complete",
       "swarm_complete": true,
       "beads_closed": N,
       "workers_used": K
     }
     ```

4. Handoff:
   `Swarm execution complete. All beads closed and reviewed. Proceed to Phase 8 summary.`
</Steps>

<Tool_Usage>
- **beads_village:** ls, show, done, reservations, msg, inbox, ack_message, bv_insights, bv_priority, bv_plan
- **Agent** — Spawn Worker and Reviewer sub-agents
- **Read, Write** — State files and handoffs ONLY (never source code)
- **AskUserQuestion** — Escalate blockers requiring user decision
- **NEVER:** Edit/Write source code, reserve, release, claim (Worker's job)
</Tool_Usage>

<Examples>
<Good>
Orchestrator spawns 3 Workers. Worker-1 completes bd-2, orchestrator spawns Reviewer,
gets PASS, calls done(). Worker-2 reports BLOCKED on bd-4 (file conflict with Worker-3).
Orchestrator checks reservations, tells Worker-2 to defer and pick next ready bead.
Worker-3 finishes, releases files, Worker-2 re-claims bd-4. All beads close.
Why good: File conflict resolved without deadlock. Workers self-route. Orchestrator tends.
</Good>

<Bad>
Orchestrator manually assigns specific beads to specific Workers and edits code to fix
a Worker's failing implementation.
Why bad: Workers self-route (no manual assignment). Orchestrator never writes code.
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
- [ ] Workers spawned with self-routing context
- [ ] All Worker completions reviewed (Reviewer per bead)
- [ ] All blockers resolved or escalated
- [ ] File conflicts coordinated (no deadlocks)
- [ ] All beads closed via done() after review
- [ ] No orphaned or stuck beads remain
- [ ] Session state updated
- [ ] Handoff written for Phase 8
</Final_Checklist>

<Advanced>
## Sequential vs. Parallel Decision Matrix

| Condition | Recommendation |
|-----------|---------------|
| All beads form a strict chain | Sequential |
| 1-2 beads total | Sequential |
| 3+ independent beads | Parallel (swarming) |
| High file overlap between beads | Sequential (less conflict) |
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

1. Read `.oh-my-beads/state/checkpoint.json`
2. Read `.oh-my-beads/handoffs/swarming-checkpoint.md`
3. Check `mcp__beads-village__inbox(unread=true)` for messages during pause
4. Check bead state: `mcp__beads-village__ls(status="open")` + `ls(status="in_progress")`
5. Resume monitoring loop from Phase 4
</Advanced>
