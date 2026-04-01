# Learnings Retrieval Protocol

Referenced by: **Scout** (Phase 1), **Architect** (Phase 2)

Execute this protocol at the start of every exploration and planning phase to prevent
re-solving solved problems. The compounding flywheel only works if learnings are consumed
as rigorously as they are captured.

---

## Step 1: Read Critical Patterns (mandatory)

```bash
cat .oh-my-beads/history/learnings/critical-patterns.md
```

If the file does not exist, note "No critical patterns yet" and continue.

Critical patterns are promoted learnings that apply broadly. Treat every entry as a
high-priority constraint — these are the lessons that cost the most to learn.

---

## Step 2: Extract Domain Keywords

Pull 3-5 domain keywords from:
- The user's request (feature name, technology mentions)
- CONTEXT.md locked decisions (if available)
- The feature slug

**Examples:**
- Feature "REST API for billing" → keywords: `api`, `billing`, `payment`, `endpoint`
- Feature "auth token refresh" → keywords: `auth`, `token`, `session`, `jwt`

---

## Step 3: Grep for Domain-Relevant Learnings

For each keyword, search the learnings directory by tag:

```bash
grep -r "tags:.*<keyword>" .oh-my-beads/history/learnings/ -l -i
```

Also search `applicable-when` fields:

```bash
grep -r "Applicable-when:.*<keyword>" .oh-my-beads/history/learnings/ -l -i
```

Collect unique file paths from all searches.

---

## Step 4: Score and Include

For each matched file:

| Match Strength | Condition | Action |
|---------------|-----------|--------|
| **Strong** | Keyword appears in `tags:` AND `Applicable-when:` | Read full file, include its insight |
| **Moderate** | Keyword appears in `tags:` only | Read "Recommendation" section, include if relevant |
| **Weak** | Keyword appears only in body text | Skip — likely coincidental |

Read strong matches in full. For moderate matches, read only the "Recommendation for
Future Work" section. Skip weak matches.

---

## Step 5: Document What Was Found

Add an **Institutional Learnings Applied** section to your output artifact:

- **Scout** → include in CONTEXT.md (after Scope Boundaries)
- **Architect** → include in plan.md (after Risk Assessment)

Format:

```markdown
## Institutional Learnings Applied

| Learning Source | Key Insight | How Applied |
|----------------|-------------|-------------|
| `YYYYMMDD-<slug>.md` | <the gotcha or pattern> | <how this shapes questions/plan> |

_If no prior learnings found: "No prior learnings for this domain."_
```

If a critical pattern directly contradicts a proposed approach, flag it explicitly
and explain why you are proceeding differently (or adjusting).

---

## When to Skip

- If `.oh-my-beads/history/learnings/` does not exist or is empty, write
  "No prior learnings for this domain" and proceed.
- Do not spend more than 30 seconds on retrieval. If there are many matches,
  prioritize critical-severity entries over standard ones.
