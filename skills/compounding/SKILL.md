---
name: compounding
description: >-
  Capture learnings from completed features to make future work faster.
  Invoke after Phase 6 review completes and all beads are closed. Runs 4 parallel
  analysis agents (patterns/decisions/failures/exit-audit), synthesizes into
  .oh-my-beads/history/learnings/YYYYMMDD-<slug>.md, promotes critical items to
  critical-patterns.md. Trigger: Phase 7 of Master workflow, or manual invocation.
  Key output: critical-patterns.md is read by Scout and Architect at session start —
  this is the flywheel that makes the ecosystem smarter over time.
level: 3
---

<Purpose>
Close the loop on completed features. Every session that runs compounding makes the next one
cheaper by capturing reusable patterns, recording decisions that worked (or didn't), and
preventing repeat failures. Skip this step and the ecosystem stays flat; run it and it compounds.
</Purpose>

<Use_When>
- Phase 7 of Master workflow (all beads closed, review complete)
- After debugging sessions that surfaced non-obvious root causes
- After any cancelled session that produced useful learnings
- Manual invocation: "compound", "capture learnings", "what did we learn"
</Use_When>

<Do_Not_Use_When>
- Trivial one-line changes where nothing reusable emerged
- Session cancelled before any meaningful work was done
</Do_Not_Use_When>

<Why_This_Exists>
Teams who systematically capture and re-inject learnings reduce time-to-complete on subsequent
features by 30-50%. This skill closes the loop. Each feature that runs through compounding makes
the next one cheaper. Skip this step and the ecosystem stays flat. Run it and it gets smarter
every cycle.
</Why_This_Exists>

<Execution_Policy>
- Complete all phases in order
- Phase 2 (4-agent analysis) runs in parallel
- Only the orchestrator writes the final learnings file — agents write to temp
- Be specific — "test more carefully" is worthless; name the file, the function, the scenario
- Do NOT fabricate findings — if the feature ran smoothly, write that
</Execution_Policy>

<HARD-GATE>
**Learnings MUST be written before closing the feature.** The Master MUST invoke compounding
and wait for the learnings file to be written before marking the feature as complete. Closing
a feature without running compounding breaks the flywheel — future sessions lose the benefit
of this session's experience. This is non-negotiable for any feature that completes Phase 5
execution. The only exception is trivial one-line changes where nothing reusable emerged.
</HARD-GATE>

<Steps>
1. **Phase 1: Gather Context**
   Read all artifacts from the completed feature:
   ```
   .oh-my-beads/history/<feature>/CONTEXT.md     — locked decisions
   .oh-my-beads/plans/plan.md                    — implementation plan
   .oh-my-beads/history/<feature>/WRAP-UP.md     — Phase 7 summary (if exists)
   .oh-my-beads/state/session.json               — runtime state
   .oh-my-beads/state/tool-tracking.json         — files modified, failures
   .oh-my-beads/state/subagent-tracking.json     — agent lifecycle
   ```

   Also run:
   ```bash
   git log --oneline -20   # recent feature commits
   ```

   Build internal summary: what was built, what risks were flagged, what surprises emerged.

   **If no history files exist:** fall back to reading the session summary and recent git diff.
   Compounding is still valuable even with partial context.

2. **Phase 2: Four-Category Analysis (4 Parallel Agents)**

   Launch four agents simultaneously. Each writes findings to a temp file.
   Do NOT have agents write the final learnings file.

   **Agent 1: Pattern Extractor**
   ```
   Agent(
     description="Extract reusable patterns",
     prompt="Read the feature artifacts. Identify REUSABLE PATTERNS:

- Code patterns: utilities, abstractions worth standardizing
- Architecture patterns: structural decisions that worked
- Process patterns: workflow approaches that saved time
- Integration patterns: how this connected to other systems

Fill this table for each pattern found:

| Name | Description | File/Location | Applicable-when | Reusability |
|------|-------------|---------------|-----------------|-------------|
| <concise name> | <what it does, why valuable> | <specific file path> | <condition for future use> | High / Medium / Low |

Be specific. Name actual files, functions, and modules.
If fewer than 2 patterns found, state that explicitly.

Write to: /tmp/omb-compounding-patterns.md",
     model="sonnet"
   )
   ```

   **Agent 2: Decision Analyst**
   ```
   Agent(
     description="Analyze key decisions",
     prompt="Read the feature artifacts. Identify significant DECISIONS:

- Good calls: saved time or prevented problems
- Bad calls: required rework
- Surprises: turned out differently than expected
- Trade-offs: conscious choices with alternatives

Fill this table for each decision:

| Decision | Choice Made | Alternatives Rejected | Outcome | Tag | Recommendation |
|----------|-------------|----------------------|---------|-----|----------------|
| <what was decided> | <what was chosen> | <what was rejected> | <how it played out> | GOOD_CALL / BAD_CALL / SURPRISE / TRADEOFF | <imperative advice> |

Write to: /tmp/omb-compounding-decisions.md",
     model="sonnet"
   )
   ```

   **Agent 3: Failure Analyst**
   ```
   Agent(
     description="Analyze failures and waste",
     prompt="Read the feature artifacts. Identify FAILURES, BLOCKERS, WASTE:

- Bugs and root causes
- Wrong assumptions requiring backtracking
- Blockers and resolutions
- Wasted effort (unnecessary work)
- Missing prerequisites discovered mid-execution
- Test gaps allowing regressions

Fill this table for each failure:

| What Happened | Root Cause | Time Blocked (est.) | Prevention Rule |
|---------------|-----------|---------------------|-----------------|
| <specific description> | <why it happened> | <minutes/hours> | <Always.../Never.../When X, do Y...> |

If the feature ran smoothly, write that honestly. Do not fabricate failures.

Write to: /tmp/omb-compounding-failures.md",
     model="sonnet"
   )
   ```

   **Agent 4: Exit-State Auditor**
   ```
   Agent(
     description="Compare planned outcomes vs actual outcomes",
     prompt="Read the feature artifacts. Compare what was PLANNED vs what was DELIVERED.

Read these artifacts:
- plan.md: the approved implementation plan (stories, acceptance criteria)
- CONTEXT.md: locked decisions (D1, D2, D3...)
- WRAP-UP.md: execution summary (if exists)
- session.json / subagent-tracking.json: execution metadata

Produce a structured comparison:

## Planned vs Actual

| Story/Item | Planned | Actual | Status |
|------------|---------|--------|--------|
| <story from plan> | <what was planned> | <what was delivered> | DELIVERED / PARTIAL / DROPPED / EMERGED |

## Decision Compliance

| Decision | Honored? | Notes |
|----------|----------|-------|
| D1: <title> | Yes / No / Partially | <explanation> |

## Scope Assessment

- **Scope creep items**: work that emerged unplanned
- **Dropped items**: planned work not delivered
- **Scope fidelity score**: High (>90%) / Medium (70-90%) / Low (<70%)

## Exit-State Summary

- Planned exit state: <from plan.md acceptance criteria>
- Actual exit state: <from WRAP-UP.md and reality>
- Gap: <what differs>

Write to: /tmp/omb-compounding-exit-audit.md",
     model="sonnet"
   )
   ```

3. **Phase 3: Synthesis & Triage**

   After all four agents complete:

   **Step 3.1 — Read all four temp files**

   **Step 3.2 — Triage each finding:**
   - `domain`: which technical area — use one of the standard domain tags:
     `security`, `architecture`, `testing`, `performance`, `database`, `auth`,
     `api`, `ui`, `devops`, `agent-coordination`, `bead-decomposition`, or a custom tag
   - `severity`: `critical` (affects multiple features, prevents serious waste) vs `standard` (valuable but specific)
   - `applicable-when`: concise condition for when future agents should apply this
   - `category`: `pattern` | `decision` | `failure` | `exit-audit`

   **Step 3.3 — Create slug:** `<primary-topic>-<secondary-topic>` (e.g., `auth-token-refresh`)

   **Step 3.4 — Write learnings file:**
   ```
   .oh-my-beads/history/learnings/YYYYMMDD-<slug>.md
   ```
   Use the format from `skills/compounding/references/learnings-template.md`.

   **Step 3.5 — Prune critical-patterns.md if oversized:**

   **Threshold: 50 entries. Archive count: 20 oldest entries.**

   After writing new learnings, count total entries in critical-patterns.md
   (each entry starts with `## [`):
   ```
   Grep pattern="^## \[" path=".oh-my-beads/history/learnings/critical-patterns.md" output_mode="count"
   ```

   If total entries exceed **50**:
   1. Read critical-patterns.md and identify the **oldest 20** entries (by date prefix in headers)
   2. Append those **20** entries to the archive file:
      ```
      .oh-my-beads/history/learnings/critical-patterns-archive.md
      ```
      If the archive file does not exist, create it with header:
      ```markdown
      # Critical Patterns Archive

      Archived entries from critical-patterns.md. These are older learnings that have been
      rotated out to maintain signal-to-noise ratio in the active patterns file.
      Entries are appended, never overwritten.

      ---
      ```
      Append the **20** oldest entries to the archive (do NOT overwrite existing archive content).
   3. Remove the **20** archived entries from critical-patterns.md
   4. Log: "Archived 20 oldest patterns to maintain signal-to-noise ratio (threshold: 50, archived: 20)"
   5. Report in Phase 5 output: `"patterns_archived": 20, "archive_path": ".oh-my-beads/history/learnings/critical-patterns-archive.md"`

4. **Phase 4: Promote Critical Learnings**

   For every finding tagged `severity: critical`, check promotion criteria:
   - Affects more than one potential future feature
   - Would cause meaningful wasted effort if unknown
   - Is generalizable, not implementation-specific

   If criteria met, append to `.oh-my-beads/history/learnings/critical-patterns.md`:
   ```markdown
   ## [YYYYMMDD] <Learning Title>
   **Category:** pattern | decision | failure
   **Feature:** <feature-name>
   **Tags:** [tag1, tag2]

   <2-4 sentence summary and what to do differently>

   **Full entry:** history/learnings/YYYYMMDD-<slug>.md
   ```

   If `critical-patterns.md` doesn't exist, create it with header:
   ```markdown
   # Critical Patterns

   Promoted learnings from completed features. Read this file at the start of every
   exploration (Scout) and planning (Architect) phase. These are the lessons that cost
   the most to learn and save the most by knowing.

   ---
   ```

5. **Phase 5: Update Session State**
   Update `session.json`:
   ```json
   {
     "compounding_complete": true,
     "learnings_file": "history/learnings/YYYYMMDD-<slug>.md",
     "critical_promotions": N
   }
   ```

   Report to Master:
   ```
   Compounding complete.
   - Learnings: .oh-my-beads/history/learnings/YYYYMMDD-<slug>.md
   - Critical promotions: N findings added to critical-patterns.md
   - Total accumulated learnings: <count of files in history/learnings/>
   ```
</Steps>

<Tool_Usage>
- **Read, Glob, Grep** — Gather artifacts from feature history
- **Agent** — Spawn 4 parallel analysis agents (pattern/decision/failure/exit-audit)
- **Write** — Learnings file and critical-patterns.md ONLY
- **Bash** — Git log for commit history
- **NEVER:** Edit source code, reserve, claim, done
</Tool_Usage>

<Examples>
<Good>
After completing a REST API feature, compounding captures:
- Pattern: "API route + Zod schema + test triad" (reusable for all CRUD endpoints)
- Decision: "D3 chose JWT over sessions — correct call, simplified horizontal scaling"
- Failure: "Missing database index on user_id caused 500ms queries under load"
  Prevention: "Always add indexes for foreign keys used in WHERE clauses"
Why good: Specific, actionable, names files and scenarios. Future agents can apply these.
</Good>

<Bad>
Compounding writes: "We should test more" and "The architecture was good."
Why bad: Vague. Names no files, no functions, no scenarios. Future agents learn nothing.
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- If no artifacts exist (cancelled before Phase 1): write minimal learnings from git diff only
- If feature ran smoothly with no surprises: write short file noting what worked. Don't invent problems.
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] All feature artifacts read (CONTEXT.md, plan.md, state files)
- [ ] 4 analysis agents completed (patterns, decisions, failures, exit-audit)
- [ ] Learnings file written with YAML frontmatter and domain tags
- [ ] Critical findings promoted to critical-patterns.md (if any)
- [ ] critical-patterns.md pruned if >50 entries (oldest 20 archived to critical-patterns-archive.md)
- [ ] Learnings written before feature close (HARD-GATE)
- [ ] Session state updated
- [ ] Report sent to Master
</Final_Checklist>

<Advanced>
## The Flywheel

```
Feature N → compounding → critical-patterns.md
                              ↓
Feature N+1 → Scout reads critical-patterns.md → asks better questions
            → Architect reads critical-patterns.md → avoids known pitfalls
            → Worker applies known patterns → fewer failures
                              ↓
Feature N+1 → compounding → critical-patterns.md grows
                              ↓
Feature N+2 starts even smarter...
```

## Red Flags

- Do NOT skip compounding because "we're in a hurry" — the flywheel only works if it runs every cycle
- Do NOT promote everything as critical — critical-patterns.md is read at session start; automated pruning archives the oldest 20 entries when count exceeds 50, but keep promotions genuinely critical to avoid dilution
- Do NOT write generic learnings — "test more carefully" is worthless; name the specific file, function, and scenario
- Do NOT fabricate findings — if the feature ran smoothly, write that honestly
</Advanced>
