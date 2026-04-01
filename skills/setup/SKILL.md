---
name: setup
description: Interactive setup wizard for Oh-My-Beads plugin - checks prerequisites, wires hooks, configures project
level: 4
model: claude-sonnet-4-6
trigger: "setup omb|setup oh-my-beads|omb setup"
---

<Purpose>
Interactive 3-phase setup wizard for Oh-My-Beads. Checks prerequisites, wires hooks into
the Claude Code settings, creates the runtime directory structure, and configures the project
CLAUDE.md with OMB quick-reference. Designed to be idempotent — running it twice is safe.
</Purpose>

<Use_When>
- First-time installation of Oh-My-Beads
- After cloning a project that uses Oh-My-Beads
- When hooks or directories are missing or misconfigured
- User says "setup omb", "setup oh-my-beads", or "omb setup"
</Use_When>

<Do_Not_Use_When>
- Oh-My-Beads is already fully configured (all checks pass)
- User wants to diagnose issues (use `/oh-my-beads:doctor` instead)
- User wants to start a workflow (use `omb` or `mr.fast` keywords)
</Do_Not_Use_When>

<Why_This_Exists>
Oh-My-Beads requires hooks wired in `.claude/settings.json`, a runtime directory structure
under `.oh-my-beads/`, beads_village MCP access, and CLAUDE.md documentation. Setting this up
manually is error-prone. This wizard walks the user through each step with clear status feedback.
</Why_This_Exists>

<Execution_Policy>
- Always check before modifying — never overwrite existing valid config
- Use AskUserQuestion for every modification that touches user files
- Print clear status labels: CHECK / PASS / MISSING / FIXED / SKIP
- Proceed phase by phase: A (Pre-Check) -> B (Install/Wire) -> C (Configure)
- If everything passes in Phase A, report success and skip B/C
</Execution_Policy>

<Steps>

## Phase A: Pre-Check

Run all checks and collect results before making any changes.

### A1. Check `.claude/settings.json`

```
Read .claude/settings.json (project-level)
```

**If file exists:** CHECK settings.json ... PASS
**If file does not exist:** CHECK settings.json ... MISSING (will create in Phase B)

### A2. Check hooks wiring

Determine the plugin root path. Use `CLAUDE_PLUGIN_ROOT` environment variable if available.
If not available, use the Oh-My-Beads repository root (look for `hooks/hooks.json` relative
to the skill file location, or search for it in common plugin paths).

Read `hooks/hooks.json` from the plugin root to get the canonical hook configuration.

Then check `.claude/settings.json` for existing hook entries. For each hook event in hooks.json,
check whether the corresponding command patterns are already present in settings.json:

| Hook Event | Key Pattern to Look For |
|------------|------------------------|
| UserPromptSubmit | `keyword-detector.mjs` |
| SessionStart | `session-start.mjs` |
| PreToolUse | `pre-tool-enforcer.mjs` |
| PostToolUse | `post-tool-verifier.mjs` |
| PostToolUseFailure | `post-tool-use-failure.mjs` |
| Stop | `context-guard-stop.mjs` AND `persistent-mode.cjs` |
| PreCompact | `pre-compact.mjs` |
| SubagentStart | `subagent-tracker.mjs` |
| SubagentStop | `subagent-tracker.mjs` AND `verify-deliverables.mjs` |
| SessionEnd | `session-end.mjs` |

**If all hooks present:** CHECK hooks ... PASS (N/N events wired)
**If some missing:** CHECK hooks ... PARTIAL (X/N events wired, missing: [list])
**If none present:** CHECK hooks ... MISSING (0/N events wired)

### A3. Check beads_village MCP

Attempt to call beads_village:

```
mcp__beads-village__status()
```

**If responds successfully:** CHECK beads_village MCP ... PASS
**If fails or unavailable:** CHECK beads_village MCP ... MISSING

Also check if `.mcp.json` exists in the project root and contains beads_village configuration:

```
Read .mcp.json
```

### A4. Check `.oh-my-beads/` directory structure

Check for the existence of these directories:
- `.oh-my-beads/state/`
- `.oh-my-beads/plans/`
- `.oh-my-beads/history/`
- `.oh-my-beads/handoffs/`

```
Glob .oh-my-beads/*
```

**If all exist:** CHECK .oh-my-beads/ directories ... PASS
**If some missing:** CHECK .oh-my-beads/ directories ... PARTIAL (missing: [list])
**If none exist:** CHECK .oh-my-beads/ directories ... MISSING

### A5. Check project CLAUDE.md

```
Read CLAUDE.md
```

Look for the OMB quick-reference section (search for `## Oh-My-Beads Quick Reference` or
similar OMB-specific markers like `omb`, `mr.beads`, `mr.fast` keyword documentation).

**If OMB section present:** CHECK CLAUDE.md OMB section ... PASS
**If CLAUDE.md exists but no OMB section:** CHECK CLAUDE.md OMB section ... MISSING
**If no CLAUDE.md:** CHECK CLAUDE.md ... MISSING (will need full creation)

### A6. Report Summary

Present all results in a structured table:

```
=== Oh-My-Beads Setup Pre-Check ===

| Component              | Status  | Detail                        |
|------------------------|---------|-------------------------------|
| .claude/settings.json  | PASS    |                               |
| Hooks wiring           | MISSING | 0/10 events wired             |
| beads_village MCP      | PASS    | Server responding             |
| .oh-my-beads/ dirs     | PARTIAL | Missing: handoffs/            |
| CLAUDE.md OMB section  | MISSING |                               |

Items to configure: 3
```

**If all PASS:** Report "Oh-My-Beads is fully configured. No changes needed." and STOP.

**If any MISSING/PARTIAL:** Ask the user:

> "Found N items to configure. Shall I proceed with setup?"
> 1. **Yes, configure everything** -- Fix all missing items
> 2. **Let me choose** -- Select which items to fix
> 3. **Cancel** -- Exit without changes

If user chooses "Let me choose", present the list of MISSING items and let them pick.

---

## Phase B: Install/Wire

Execute only for items that are MISSING or PARTIAL from Phase A.

### B1. Wire hooks into `.claude/settings.json`

**Only if hooks check was MISSING or PARTIAL.**

Read the canonical hook configuration from the plugin's `hooks/hooks.json`.

Present the hook configuration to the user:

```
The following hooks need to be added to .claude/settings.json:

Hook Events: UserPromptSubmit, SessionStart, PreToolUse, PostToolUse,
             PostToolUseFailure, Stop, PreCompact, SubagentStart,
             SubagentStop, SessionEnd

Each hook runs via: node "${CLAUDE_PLUGIN_ROOT}/scripts/run.cjs" "${CLAUDE_PLUGIN_ROOT}/scripts/<script>"
```

Ask user for confirmation before writing:

> "Add Oh-My-Beads hooks to .claude/settings.json?"
> 1. **Yes** -- Merge hooks into settings (preserves existing config)
> 2. **Show me the full config first** -- Display the JSON to be written
> 3. **Skip** -- I'll configure manually

**If Yes:** Read the current `.claude/settings.json` (or create `{}`), merge the hooks
from `hooks/hooks.json` into the `hooks` key. Preserve any existing hooks for other plugins.
Write the merged result.

**If Show:** Display the full JSON that would be written, then ask again.

**IMPORTANT:** If `CLAUDE_PLUGIN_ROOT` is not available as an environment variable, the hooks.json
already uses `${CLAUDE_PLUGIN_ROOT}` in command strings -- this is resolved by Claude Code at
runtime. Write the commands exactly as they appear in hooks.json.

Report: FIXED hooks ... N/N events wired

### B2. Create `.oh-my-beads/` directories

**Only if directory check was MISSING or PARTIAL.**

Create the missing directories:

```bash
mkdir -p .oh-my-beads/state
mkdir -p .oh-my-beads/plans
mkdir -p .oh-my-beads/history
mkdir -p .oh-my-beads/handoffs
```

Verify `.gitignore` includes `.oh-my-beads/state/` (runtime state should not be committed).
If `.gitignore` exists but does not contain the entry, suggest adding it.

Report: FIXED .oh-my-beads/ directories ... 4/4 created

### B3. Verify beads_village MCP configuration

**Only if beads_village check was MISSING.**

Check `.mcp.json` for beads_village configuration:

```
Read .mcp.json
```

If beads_village is not configured, inform the user:

```
beads_village MCP server is not configured in this project.

To add it, you need a .mcp.json entry like:

{
  "mcpServers": {
    "beads-village": {
      "command": "uvx",
      "args": ["beads-village"]
    }
  }
}

Please ensure beads_village is installed and accessible.
```

Ask the user if they want the wizard to write this configuration or if they'll handle it
manually. If the user confirms, write/merge the `.mcp.json` file.

Report: FIXED beads_village MCP ... configured in .mcp.json
(or) SKIP beads_village MCP ... user will configure manually

---

## Phase C: Configure

### C1. Add OMB quick-reference to CLAUDE.md

**Only if CLAUDE.md OMB section check was MISSING.**

Read the current CLAUDE.md (if it exists). Append the following section at the end
(before any `<!-- gitnexus:start -->` block if present):

```markdown
## Oh-My-Beads Quick Reference

### Keywords

| Keyword | Mode | Description |
|---------|------|-------------|
| `omb`, `oh-my-beads`, `mr.beads` | Mr.Beads | Full 8-step workflow with 3 HITL gates |
| `mr.fast`, `mrfast` | Mr.Fast | Lightweight 2-step fix (Scout + Executor) |
| `cancel omb`, `cancel mrfast` | Cancel | Stop active session cleanly |

### Available Skills

| Skill | Purpose |
|-------|---------|
| `/oh-my-beads:using-oh-my-beads` | Start Mr.Beads workflow |
| `/oh-my-beads:mr-fast` | Start Mr.Fast workflow |
| `/oh-my-beads:master` | Master Orchestrator (auto-loaded) |
| `/oh-my-beads:scout` | Requirements exploration |
| `/oh-my-beads:fast-scout` | Rapid analysis (Mr.Fast) |
| `/oh-my-beads:architect` | Planning and decomposition |
| `/oh-my-beads:worker` | Implementation |
| `/oh-my-beads:reviewer` | Quality review |
| `/oh-my-beads:validating` | Pre-execution verification |
| `/oh-my-beads:swarming` | Parallel execution |
| `/oh-my-beads:compounding` | Learning flywheel |
| `/oh-my-beads:debugging` | Systematic debugging |
| `/oh-my-beads:cancel` | Cancel active session |
| `/oh-my-beads:doctor` | Diagnose workspace health |
| `/oh-my-beads:setup` | This setup wizard |

### Agents

Master (orchestrator) | Scout (requirements) | Fast Scout (rapid analysis) |
Architect (planning) | Worker (implementation) | Reviewer (quality) |
Explorer (search) | Executor (general impl) | Verifier (checks) |
Code Reviewer (deep review) | Security Reviewer (audit) | Test Engineer (tests)
```

Ask user for confirmation before writing:

> "Add Oh-My-Beads quick-reference section to CLAUDE.md?"
> 1. **Yes** -- Append the section
> 2. **Show me the content first** -- Preview what will be added
> 3. **Skip** -- I'll add it myself

Report: FIXED CLAUDE.md ... OMB quick-reference added

### C2. Final Confirmation

Present the final setup summary:

```
=== Oh-My-Beads Setup Complete ===

| Component              | Status |
|------------------------|--------|
| .claude/settings.json  | PASS   |
| Hooks wiring           | FIXED  |
| beads_village MCP      | PASS   |
| .oh-my-beads/ dirs     | FIXED  |
| CLAUDE.md OMB section  | FIXED  |

Oh-My-Beads is ready to use!

Quick start:
  - "omb <your feature request>"     -- Start Mr.Beads (full workflow)
  - "mr.fast <your quick fix>"       -- Start Mr.Fast (lightweight)
  - "/oh-my-beads:doctor"            -- Check workspace health
```

</Steps>

<Tool_Usage>
- Read: Check existing files (settings.json, CLAUDE.md, .mcp.json, hooks.json)
- Write: Create new files when confirmed by user
- Edit: Merge config into existing files
- Bash: Create directories (mkdir -p)
- Glob: Verify directory existence
- AskUserQuestion: Every modification requires user confirmation
- mcp__beads-village__status: Test beads_village connectivity
</Tool_Usage>

<Idempotency>
This skill is designed to be run multiple times safely:
- Phase A always checks current state before suggesting changes
- Phase B only modifies what is MISSING or PARTIAL
- Phase C only appends if the OMB section is not already present
- Existing configurations from other plugins are preserved during merge
- Running the wizard when everything is configured results in "No changes needed"
</Idempotency>

<Error_Handling>
- If `.claude/settings.json` has invalid JSON: warn user, offer to back up and recreate
- If `hooks/hooks.json` cannot be found: check common paths, report error with guidance
- If beads_village MCP is unreachable: continue setup, note it as a post-setup action
- If directory creation fails: report the error, suggest checking permissions
- If CLAUDE.md write fails: show the content to add manually
</Error_Handling>
