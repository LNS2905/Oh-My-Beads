---
name: learner
description: >-
  Extracts reusable, codebase-specific knowledge from the current session and saves it
  as a learned skill file that the skill-injector can auto-discover and inject in future
  prompts. Quality over quantity — only genuinely hard-won debugging insights.
level: 4
---

<Purpose>
The Learner captures debugging breakthroughs and non-obvious solutions from the current
conversation into structured skill files. These files are auto-discovered by the
skill-injector hook and injected into future prompts when trigger keywords match —
creating an ever-growing institutional memory.
</Purpose>

<Use_When>
- User says "learn this", "save this", "remember this pattern", or invokes `/oh-my-beads:learner`
- A difficult debugging session just concluded with a non-obvious solution
- A codebase-specific pattern was discovered that would save time if remembered
</Use_When>

<Do_Not_Use_When>
- The solution is trivially Googleable (e.g., "how to center a div")
- The knowledge is generic programming advice, not codebase-specific
- No real debugging effort was required — it was obvious from the start
</Do_Not_Use_When>

<HARD-GATE>
**NEVER save generic or trivial knowledge.** Every learned skill must pass ALL three quality
gates before saving. If any gate fails, explain why to the user and do NOT create the file.
Quality over quantity — one excellent skill file is worth more than ten mediocre ones.
</HARD-GATE>

<Steps>

## Step 1: Extract Knowledge from Current Session

Review the current conversation and extract:

1. **Problem statement** — What went wrong? Include:
   - Exact error messages (verbatim, not paraphrased)
   - File paths involved
   - Conditions that trigger the issue
   - What made it hard to diagnose

2. **Solution** — The exact fix, including:
   - Code changes (file, function, what changed)
   - Configuration changes
   - The "aha moment" — what insight unlocked the solution

3. **Trigger keywords** — Words or phrases that would identify this problem in future prompts:
   - Error message fragments (most reliable triggers)
   - File names or module names involved
   - Symptom descriptions ("build fails when...", "test hangs after...")
   - At least 2 triggers, ideally 3–5

## Step 2: Apply Quality Gates

<HARD-GATE>
**All three gates must pass. No exceptions.**

| Gate | Question | FAIL → Do not save |
|------|----------|---------------------|
| **Not Googleable** | Would searching the error message + framework name give the answer in the first 3 results? | If yes → too generic |
| **Codebase-Specific** | Does the solution depend on this project's specific architecture, config, or conventions? | If no → too generic |
| **Real Effort** | Did the debugging require more than 5 minutes of investigation or multiple failed approaches? | If no → too trivial |

If ANY gate fails, tell the user:
> "This knowledge doesn't meet the quality bar for a learned skill. Reason: [specific gate that failed]. Consider using `<remember>` tags for session-scoped notes instead."
</HARD-GATE>

## Step 3: Choose Storage Location

Ask the user (or infer from context):

| Location | Path | When to use |
|----------|------|-------------|
| **Project-level** (default) | `{cwd}/.oh-my-beads/skills/{slug}.md` | Codebase-specific knowledge, shared with team |
| **User-level** | `~/.oh-my-beads/skills/{slug}.md` | Personal workflow patterns, cross-project knowledge |

Default to **project-level** unless the knowledge is clearly cross-project.

## Step 4: Generate Slug

Create a URL-safe slug from the problem:
- Lowercase, hyphens only
- 3–5 words capturing the core issue
- Examples: `jwt-refresh-race-condition`, `webpack-circular-import-hang`, `prisma-migration-lock`

## Step 5: Write Skill File

Use the template from `skills/learner/references/skill-template.md`.

The file must have:
- **YAML frontmatter** with: `name`, `description`, `triggers[]`, `source`, `tags[]`
- **Markdown body** with: `# Problem`, `# Solution`, optional `# Context`

The format must match what `scripts/skill-injector.mjs` expects (parsed by `parseFrontmatter()`):

```yaml
---
name: <slug>
description: <one-line summary of the problem and fix>
triggers:
  - <error message fragment or keyword>
  - <file/module name>
  - <symptom description>
source: learned
tags:
  - <domain tag>
---
```

Write the file using the Write tool to the chosen location.

## Step 6: Confirm to User

Report:
- File path where the skill was saved
- Trigger keywords that will activate it
- Remind them it will auto-inject on future matching prompts via the skill-injector hook

</Steps>

<Quality_Examples>

### GOOD — Worth saving
- "Jest tests hang silently when prisma client isn't mocked in `setupFilesAfterFramework`"
- "Build fails with cryptic ENOMEM when webpack has circular imports in the auth module"
- "beads_village `reserve()` returns success but file isn't locked when path contains spaces"

### BAD — Do NOT save
- "How to install npm packages" (Googleable)
- "Always run `npm test` before committing" (generic advice)
- "Fixed a typo in the README" (trivial, no debugging)
- "React components should be pure functions" (generic programming wisdom)

</Quality_Examples>

<Red_Flags>
- **Scope creep**: Learner should extract ONE focused skill per invocation, not a brain dump
- **Over-generalization**: If you find yourself writing generic advice, stop — it fails Gate 2
- **Missing triggers**: Skills without good triggers will never match future prompts
- **Paraphrased errors**: Use EXACT error messages as triggers, not your interpretation
</Red_Flags>

<Tool_Usage>
- Read: Review conversation context, check if skill file already exists at target path
- Write: Create the skill .md file
- Glob/Grep: Check for duplicate skill files with similar triggers
</Tool_Usage>

<Final_Checklist>
- [ ] Problem statement has exact error messages and file paths
- [ ] Solution has specific code/config changes (not vague advice)
- [ ] All 3 quality gates passed explicitly
- [ ] At least 2 trigger keywords defined
- [ ] YAML frontmatter has all required fields (name, description, triggers, source, tags)
- [ ] File written to correct location (project or user level)
- [ ] Slug is descriptive and URL-safe
</Final_Checklist>
