# beads_village Message Templates

Standard message formats for swarm coordination. All messages use beads_village's
`msg()` and `inbox()` tools. The orchestrator (Master) and Workers communicate
through this shared messaging system.

---

## 1. Swarm Start Notification

**Sent by:** Orchestrator (Master)
**When:** After swarm readiness confirmed, before spawning Workers
**Purpose:** Announces the swarm start and execution model

```
mcp__beads-village__msg(
  subj="[SWARM START] <feature-name>",
  body="Swarm initialized.\n\nExecution model:\n- Workers self-route via ls(status='ready') + claim()\n- File coordination via reserve()/release()\n- Report completions as [DONE], blockers as [BLOCKED]\n\nWorkers spawning: <N>\n\nAll Workers: init, find ready beads, claim, implement, report, loop.",
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

```
mcp__beads-village__msg(
  subj="[DONE] <bead-id>: <bead-title>",
  body="Bead complete: <bead-id>\nWorker: <N>\n\nSummary of changes:\n<2-3 sentences>\n\nFiles modified:\n- <path/to/file1>\n- <path/to/file2>\n\nAcceptance criteria:\n- [x] <criterion 1>\n- [x] <criterion 2>\n\nSelf-verification:\n- <what was checked>\n\nNext action: release files, find next ready bead",
  to="master"
)
```

---

## 3. Blocker Alert

**Sent by:** Worker
**When:** Immediately upon discovering a blocking issue
**Purpose:** Requests orchestrator intervention

```
mcp__beads-village__msg(
  subj="[BLOCKED] <bead-id> — <one-line description>",
  body="BLOCKED: Worker <N> cannot proceed on bead <bead-id>.\n\nBlocker type: [FILE_CONFLICT | DEPENDENCY_NOT_MET | TECHNICAL_FAILURE | AMBIGUITY]\n\nDescription:\n<clear description with errors, file names, and details>\n\nWhat I need to proceed:\n<specific ask: file release, user decision, information, etc.>\n\nI am pausing on this bead and will pick next ready bead.",
  to="master",
  importance="high"
)
```

---

## 4. File Conflict Request

**Sent by:** Worker
**When:** Worker needs a file another Worker currently holds
**Purpose:** Coordinates file access

```
mcp__beads-village__msg(
  subj="[FILE CONFLICT] <path/to/file>",
  body="File conflict: Worker <N> needs a reserved file.\n\nRequested: <path/to/file>\nMy bead: <bead-id>\nReason needed: <why this file is required>\n\nAwaiting resolution:\n1. Request holder release at safe checkpoint\n2. I wait\n3. I defer and create follow-up bead",
  to="master",
  importance="high"
)
```

---

## 5. File Conflict Resolution

**Sent by:** Orchestrator (Master)
**When:** Replying to a File Conflict Request

```
mcp__beads-village__msg(
  subj="Re: [FILE CONFLICT] <path/to/file>",
  body="Decision on file conflict for <path/to/file>:\n\n[OPTION A — Wait]\n<requester>: wait for holder to release.\n\n[OPTION B — Release requested]\n<holder>: release <file> at next safe checkpoint.\n<requester>: stand by.\n\n[OPTION C — Defer]\n<requester>: defer this change, create follow-up bead, continue with next ready bead.",
  to="<requester-id>"
)
```

---

## 6. Overseer Broadcast

**Sent by:** Orchestrator (Master)
**When:** Shared correction or reminder needed across the swarm

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

```
mcp__beads-village__msg(
  subj="[PAUSE] Orchestrator checkpointing",
  body="Orchestrator writing checkpoint.\n\nCurrent status:\n- Open beads: <count>\n- In-progress beads: <count>\n- Known blockers: <count>\n\nWorkers: finish current bead safely, then report status.\n\nResume artifacts:\n- .oh-my-beads/state/checkpoint.json\n- .oh-my-beads/handoffs/swarming-checkpoint.md\n- mcp__beads-village__ls(status='open')",
  to="all",
  global=true,
  importance="high"
)
```

---

## 8. Swarm Completion

**Sent by:** Orchestrator (Master)
**When:** All beads verified closed

```
mcp__beads-village__msg(
  subj="[SWARM COMPLETE] <feature-name> — all beads closed",
  body="Swarm complete.\n\nSummary:\n- Beads implemented: <N>\n- Workers used: <K>\n- Review verdicts: <N> PASS, <N> MINOR\n\nAll Workers: your work is complete.\n\nNext step: Phase 8 summary and compounding.",
  to="all",
  global=true
)
```

---

## 9. Review Verdict Notification

**Sent by:** Orchestrator (Master)
**When:** After Reviewer completes per-bead review

```
mcp__beads-village__msg(
  subj="[REVIEW] <bead-id>: <PASS|MINOR|FAIL>",
  body="Review verdict for bead <bead-id>: <verdict>\n\n<If PASS: Bead approved and closed.>\n<If MINOR: Bead approved with notes: <notes>>\n<If FAIL: Required changes:\n<list of required changes with file:line citations>\nWorker: re-claim this bead and address the feedback. Retry <N>/2.>",
  to="<worker-id>"
)
```
