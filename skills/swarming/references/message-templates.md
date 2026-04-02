# beads_village Message Templates

Standard message formats for swarm coordination. All messages use beads_village's
`msg()` and `inbox()` tools. The orchestrator (Master) and Workers communicate
through this shared messaging system.

**Threading rule:** All per-bead messages MUST include `thread="bd-N"` (the bead ID).
Swarm-wide broadcasts use no thread. This enables `inbox(thread="bd-N")` to retrieve
the full conversation history for any bead.

---

## 1. Swarm Start Notification

**Sent by:** Orchestrator (Master)
**When:** After swarm readiness confirmed, before spawning Workers
**Purpose:** Announces the swarm start and execution model
**Thread:** None (swarm-wide)

```
mcp__beads-village__msg(
  subj="[SWARM START] <feature-name>",
  body="Swarm initialized.\n\nExecution model:\n- Workers self-route via ls(status='ready') + claim()\n- File coordination via reserve(mode, region)/release()\n- Report completions as [DONE], blockers as [BLOCKED]\n- All per-bead messages must include thread='bd-N'\n\nWorkers spawning: <N>\n\nAll Workers: init, find ready beads, claim, reserve (with region hints for shared files), implement, report, loop.",
  to="all",
  global=true,
  importance="high"
)
```

---

## 2. Worker Completion Report

**Sent by:** Worker
**When:** After each bead is implemented and self-verified
**Purpose:** Notifies orchestrator of progress for review
**Thread:** `"bd-N"` (the completed bead ID)

```
mcp__beads-village__msg(
  subj="[DONE] <bead-id>: <bead-title>",
  body="Bead complete: <bead-id>\nWorker: <N>\n\nSummary of changes:\n<2-3 sentences>\n\nFiles modified:\n- <path/to/file1>\n- <path/to/file2>\n\nReservation mode:\n- <path/to/file1>: exclusive\n- <path/to/file2>: shared (region: <region hint>)\n\nAcceptance criteria:\n- [x] <criterion 1>\n- [x] <criterion 2>\n\nSelf-verification:\n- <what was checked>\n\nNext action: release files, find next ready bead",
  to="master",
  thread="<bead-id>"
)
```

---

## 3. Blocker Alert

**Sent by:** Worker
**When:** Immediately upon discovering a blocking issue
**Purpose:** Requests orchestrator intervention
**Thread:** `"bd-N"` (the blocked bead ID)

```
mcp__beads-village__msg(
  subj="[BLOCKED] <bead-id> — <one-line description>",
  body="BLOCKED: Worker <N> cannot proceed on bead <bead-id>.\n\nBlocker type: [FILE_CONFLICT | DEPENDENCY_NOT_MET | TECHNICAL_FAILURE | AMBIGUITY]\n\nDescription:\n<clear description with errors, file names, and details>\n\nWhat I need to proceed:\n<specific ask: file release, shared access with region, user decision, etc.>\n\nI am pausing on this bead and will pick next ready bead.",
  to="master",
  importance="high",
  thread="<bead-id>"
)
```

---

## 4. File Conflict Request

**Sent by:** Worker
**When:** Worker needs a file another Worker currently holds
**Purpose:** Coordinates file access
**Thread:** `"bd-N"` (the requesting Worker's bead ID)

```
mcp__beads-village__msg(
  subj="[FILE CONFLICT] <path/to/file>",
  body="File conflict: Worker <N> needs a reserved file.\n\nRequested: <path/to/file>\nMy bead: <bead-id>\nMy intended region: <function/lines/section I need to edit>\nReason needed: <why this file is required>\n\nSuggested resolution:\n1. Convert to shared locks with region hints (if editing different sections)\n2. Request holder release at safe checkpoint\n3. I defer and pick next ready bead",
  to="master",
  importance="high",
  thread="<bead-id>"
)
```

---

## 5. File Conflict Resolution

**Sent by:** Orchestrator (Master)
**When:** Replying to a File Conflict Request
**Thread:** `"bd-N"` (the requesting Worker's bead ID)

```
mcp__beads-village__msg(
  subj="Re: [FILE CONFLICT] <path/to/file>",
  body="Decision on file conflict for <path/to/file>:\n\n[OPTION A — Shared Access with Region Hints]\n<requester>: re-reserve with mode='shared', region='<your edit scope>'.\n<holder>: re-reserve with mode='shared', region='<your edit scope>'.\nBoth proceed concurrently on different regions.\n\n[OPTION B — Wait]\n<requester>: wait for holder to release.\n\n[OPTION C — Release requested]\n<holder>: release <file> at next safe checkpoint.\n<requester>: stand by.\n\n[OPTION D — Defer]\n<requester>: defer this change, create follow-up bead, continue with next ready bead.",
  to="<requester-id>",
  thread="<bead-id>"
)
```

---

## 6. Overseer Broadcast

**Sent by:** Orchestrator (Master)
**When:** Shared correction or reminder needed across the swarm
**Thread:** None (swarm-wide)

```
mcp__beads-village__msg(
  subj="[OVERSEER] <short instruction>",
  body="Broadcast to all Workers:\n\n<instruction or correction>\n\nExamples:\n- Do not touch <file> until blocker <id> is resolved\n- New decision D7 locked: <summary>. Honor in all remaining work.\n- Build is broken — pause new beads until fix bead completes.",
  to="all",
  global=true,
  importance="high"
)
```

---

## 7. Context Checkpoint Warning

**Sent by:** Orchestrator (Master)
**When:** Orchestrator context is getting heavy
**Thread:** None (swarm-wide)

```
mcp__beads-village__msg(
  subj="[PAUSE] Orchestrator checkpointing",
  body="Orchestrator writing checkpoint.\n\nCurrent status:\n- Open beads: <count>\n- In-progress beads: <count>\n- Known blockers: <count>\n- Active reservations: <count>\n\nWorkers: finish current bead safely, then report status via msg(thread='bd-N').\n\nResume artifacts:\n- .oh-my-beads/handoffs/swarming-checkpoint.md\n- mcp__beads-village__ls(status='open')\n- mcp__beads-village__reservations()",
  to="all",
  global=true,
  importance="high"
)
```

---

## 8. Swarm Completion

**Sent by:** Orchestrator (Master)
**When:** All beads verified closed
**Thread:** None (swarm-wide)

```
mcp__beads-village__msg(
  subj="[SWARM COMPLETE] <feature-name> — all beads closed",
  body="Swarm complete.\n\nSummary:\n- Beads implemented: <N>\n- Workers used: <K>\n- Review verdicts: <N> PASS, <N> MINOR\n- Shared locks used: <count> (region-based concurrent edits)\n\nAll Workers: your work is complete.\n\nNext step: Phase 6 review.",
  to="all",
  global=true
)
```

---

## 9. Review Verdict Notification

**Sent by:** Orchestrator (Master)
**When:** After Reviewer completes per-bead review
**Thread:** `"bd-N"` (the reviewed bead ID)

```
mcp__beads-village__msg(
  subj="[REVIEW] <bead-id>: <PASS|MINOR|FAIL>",
  body="Review verdict for bead <bead-id>: <verdict>\n\n<If PASS: Bead approved and closed.>\n<If MINOR: Bead approved with notes: <notes>>\n<If FAIL: Required changes:\n<list of required changes with file:line citations>\nWorker: re-claim this bead and address the feedback. Retry <N>/2.>",
  to="<worker-id>",
  thread="<bead-id>"
)
```

---

## Threading Summary

| Message Type | Thread Value | Rationale |
|-------------|-------------|-----------|
| Swarm Start | (none) | Swarm-wide announcement |
| Worker [DONE] | `"bd-N"` | Per-bead completion tracking |
| Worker [BLOCKED] | `"bd-N"` | Per-bead blocker tracking |
| File Conflict Request | `"bd-N"` | Tied to requesting bead |
| File Conflict Resolution | `"bd-N"` | Reply in same thread |
| Overseer Broadcast | (none) | Swarm-wide correction |
| Context Checkpoint | (none) | Swarm-wide pause |
| Swarm Completion | (none) | Swarm-wide announcement |
| Review Verdict | `"bd-N"` | Per-bead review tracking |

Use `inbox(thread="bd-N")` to retrieve the full conversation history for any bead.
Use `inbox(unread=true)` to check for new messages across all threads.
