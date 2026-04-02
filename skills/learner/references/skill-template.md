# Learned Skill File Template

Use this template when creating learned skill files via the Learner skill.

Files are saved to:
- **Project-level**: `{cwd}/.oh-my-beads/skills/{slug}.md`
- **User-level**: `~/.oh-my-beads/skills/{slug}.md`

The format must be parseable by `scripts/skill-injector.mjs` (`parseFrontmatter()`).

---

## Template

```markdown
---
name: <slug>
description: <one-line summary — what goes wrong and how to fix it>
triggers:
  - <exact error message fragment>
  - <file or module name>
  - <symptom keyword>
source: learned
tags:
  - <domain: e.g., auth, database, testing, build, api, config>
---

# Problem

<What goes wrong. Include:>
- Exact error message(s)
- File(s) and function(s) involved
- Conditions that trigger the issue
- Why it's hard to diagnose (what's misleading)

# Solution

<The exact fix. Include:>
- Which file(s) to change
- What code/config to add, modify, or remove
- The key insight that unlocks the fix

# Context

<Optional. Include if helpful:>
- When this was discovered (feature/PR context)
- Related files or systems
- Gotchas or edge cases
```

---

## Example: JWT Refresh Race Condition

```markdown
---
name: jwt-refresh-race-condition
description: Concurrent token refresh requests cause auth failures due to non-atomic check-then-act
triggers:
  - token refresh
  - concurrent auth failure
  - SELECT FOR UPDATE
  - jwt invalidated unexpectedly
source: learned
tags:
  - auth
  - concurrency
---

# Problem

When two API requests arrive simultaneously with an expiring JWT token, both pass the
"token not yet expired" check, both issue new tokens, and both invalidate the old token.
The second request's new token is immediately invalid because the first request already
rotated the token family.

Error manifests as intermittent 401 responses under load. Hard to reproduce in unit tests
because they mock the DB and never simulate concurrency.

# Solution

Replace the two-step check-then-act (SELECT + UPDATE) with an atomic database operation:

```sql
UPDATE refresh_tokens
SET revoked = true, replaced_by = $newTokenId
WHERE id = $oldTokenId AND revoked = false
RETURNING id;
```

If RETURNING is empty, another request already rotated — reject this one.

Add a concurrency integration test with 10 parallel refresh requests to catch regressions.

# Context

Discovered during load testing of the user-auth-refresh feature. The non-atomic pattern
was inherited from the original codebase. Applies to any token rotation or session renewal
with parallel request potential.
```

---

## Slug Naming Rules

- Lowercase, hyphens only (no underscores, no spaces)
- 3–5 words capturing the core issue
- Pattern: `<domain>-<specific-problem>`
- Examples:
  - `prisma-migration-lock-timeout`
  - `webpack-circular-import-hang`
  - `beads-village-space-in-path`
  - `jest-prisma-mock-setup`

---

## Frontmatter Field Reference

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `name` | YES | string | Unique slug identifier |
| `description` | YES | string | One-line summary |
| `triggers` | YES | string[] | Keywords for matching (min 2) |
| `source` | YES | string | Always `"learned"` for Learner-created skills |
| `tags` | NO | string[] | Domain tags for categorization |

The `triggers` array is the most important field — it determines when the skill-injector
will match and inject this skill into future prompts. Use exact error message fragments
as triggers for highest recall.
