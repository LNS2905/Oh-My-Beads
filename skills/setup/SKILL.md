---
name: setup
description: Interactive setup wizard for Oh-My-Beads plugin — checks prerequisites, installs beads-village, wires hooks, configures project. Designed to be idempotent and zero-friction.
level: 4
model: claude-sonnet-4-6
trigger: "setup omb|setup oh-my-beads|omb setup"
---

<Purpose>
Interactive 3-phase setup wizard for Oh-My-Beads. Validates prerequisites (Node.js, beads-village),
wires hooks, creates directories, configures CLAUDE.md, and tracks completion state. Designed to be
idempotent — running it twice is safe. Supports `--force` to re-run from scratch and `--update` to
refresh only CLAUDE.md.
</Purpose>

<Use_When>
- First-time installation of Oh-My-Beads (session-start shows `[FIRST RUN]` banner)
- After plugin update (session-start shows `[UPDATE]` banner)
- When hooks or directories are missing or misconfigured
- User says "setup omb", "setup oh-my-beads", or "omb setup"
</Use_When>

<Do_Not_Use_When>
- Oh-My-Beads is already fully configured (all checks pass)
- User wants to diagnose issues (use `/oh-my-beads:doctor` instead)
- User wants to start a workflow (use `omb` or `mr.fast` keywords)
</Do_Not_Use_When>

<Why_This_Exists>
Oh-My-Beads requires beads_village MCP server, hooks wired in settings.json, runtime directories,
and CLAUDE.md documentation. This wizard handles everything automatically so users don't need to
figure out each piece manually. On first install from the marketplace, only this wizard needs to run.
</Why_This_Exists>

<Execution_Policy>
- Always check before modifying — never overwrite existing valid config
- Use AskUserQuestion for every modification that touches user files
- Print clear status labels: CHECK / PASS / MISSING / FIXED / SKIP
- Proceed phase by phase: A (Pre-Check) → B (Install/Wire) → C (Configure)
- If everything passes in Phase A, report success and skip B/C
- Track completion in `~/.oh-my-beads/setup.json` for idempotency
</Execution_Policy>

<Steps>

## Phase A: Pre-Check

Run all checks and collect results before making any changes.

### A0. Setup Completion Gate

Check `~/.oh-my-beads/setup.json`:

```
Read ~/.oh-my-beads/setup.json
```

**If file exists AND `setupCompleted` is set AND not `--force`:**

Read the plugin version from `.claude-plugin/plugin.json`.

If `setupVersion` matches the current plugin version:

> "Oh-My-Beads setup is already complete (v{version}, configured {date})."
> 1. **Quick update** — Refresh CLAUDE.md only (skip to C1)
> 2. **Full wizard** — Re-run all checks and reconfigure
> 3. **Cancel** — Exit

If `setupVersion` is older than the current plugin version:

> "Oh-My-Beads has been updated from v{old} to v{new}."
> 1. **Update config** — Re-run checks and update (Recommended)
> 2. **Cancel** — Keep current config

**If file does not exist OR `--force`:** Proceed with full wizard.

### A1. Check Node.js Version

```bash
node --version
```

**If >= 18:** CHECK Node.js ... PASS (v{version})
**If < 18:** CHECK Node.js ... ERROR (v{version}, requires >= 18)

### A2. Check `.claude/settings.json`

```
Read .claude/settings.json (project-level)
```

**If file exists:** CHECK settings.json ... PASS
**If does not exist:** CHECK settings.json ... MISSING (will create in Phase B)

### A3. Check Hooks Wiring

Determine the plugin root path. Read `hooks/hooks.json` from the plugin root.
Check `.claude/settings.json` for existing hook entries.

| Hook Event | Script Pattern |
|------------|---------------|
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

### A4. Check beads-village Availability

Test if beads-village is available via any method:

```bash
# Method 1: Global install
which beads-village

# Method 2: npx (auto-downloads if not installed)
npx -y beads-village --version
```

**If `which` succeeds:** CHECK beads-village ... PASS (global install)
**If `npx` succeeds:** CHECK beads-village ... PASS (available via npx)
**If both fail:** CHECK beads-village ... MISSING (not installed)

### A5. Check `.mcp.json` Configuration

```
Read .mcp.json (project root)
```

Look for a `beads-village` entry in `mcpServers`.

**If beads-village configured:** CHECK .mcp.json ... PASS
**If file exists but no beads-village:** CHECK .mcp.json ... PARTIAL (beads-village missing)
**If file does not exist:** CHECK .mcp.json ... MISSING

### A6. Check beads_village MCP Connectivity

```
mcp__beads-village__status()
```

**If responds:** CHECK beads_village MCP ... PASS (server responding)
**If fails:** CHECK beads_village MCP ... OFFLINE (server not running or not configured)

### A7. Check System-Level Runtime Dirs

Check if `~/.oh-my-beads/` exists (or `$OMB_HOME`).

**If exists:** CHECK runtime dirs ... PASS
**If missing:** CHECK runtime dirs ... MISSING (auto-created by session-start, no action needed)

### A8. Check Project-Level Artifact Dirs

Check for:
- `{cwd}/.oh-my-beads/plans/`
- `{cwd}/.oh-my-beads/history/`

**If all exist:** CHECK artifact dirs ... PASS
**If some missing:** CHECK artifact dirs ... PARTIAL (missing: [list])
**If none exist:** CHECK artifact dirs ... MISSING

### A9. Check CLAUDE.md OMB Section

```
Read CLAUDE.md
```

Look for `<!-- OMB:START -->` marker (idempotent merge marker).
If no marker, look for "Oh-My-Beads" or "oh-my-beads" section header.

**If OMB section present with markers:** CHECK CLAUDE.md ... PASS (managed section found)
**If OMB content present without markers:** CHECK CLAUDE.md ... PARTIAL (needs marker upgrade)
**If no OMB content:** CHECK CLAUDE.md ... MISSING
**If no CLAUDE.md file:** CHECK CLAUDE.md ... MISSING (will create)

### A10. Check Version Consistency

```
Read .claude-plugin/plugin.json → version
Read .claude-plugin/marketplace.json → version, plugins[0].version
```

**If all match:** CHECK versions ... PASS (v{version})
**If mismatch:** CHECK versions ... WARNING (plugin.json: {a}, marketplace.json: {b})

### A11. Check Statusline Configuration

```
Read ~/.claude/settings.json
```

Check if the file contains a `statusLine` entry pointing to the Oh-My-Beads statusline script.

Determine the plugin root path (the directory containing `scripts/statusline.mjs`). Build the
expected command: `"node <plugin-root>/scripts/statusline.mjs"` where `<plugin-root>` is the
absolute path to the plugin directory (e.g., `/home/user/.claude/plugins/oh-my-beads` or the
local development path).

**If `statusLine` exists AND command contains `statusline.mjs` from this plugin:** CHECK statusline ... PASS
**If `statusLine` exists BUT command points to a different (non-OMB) script:** CHECK statusline ... SKIP (non-OMB statusline configured — will not overwrite)
**If `statusLine` is missing or `~/.claude/settings.json` does not exist:** CHECK statusline ... MISSING (will auto-configure in Phase B)

### A12. Report Summary

Present all results:

```
=== Oh-My-Beads Setup Pre-Check ===

| #  | Component              | Status  | Detail                        |
|----|------------------------|---------|-------------------------------|
| A1 | Node.js                | PASS    | v22.22.0                      |
| A2 | .claude/settings.json  | PASS    |                               |
| A3 | Hooks wiring           | MISSING | 0/10 events wired             |
| A4 | beads-village          | MISSING | Not installed                 |
| A5 | .mcp.json              | MISSING | beads-village not configured   |
| A6 | beads_village MCP      | OFFLINE | Server not responding         |
| A7 | Runtime dirs           | PASS    | ~/.oh-my-beads/ exists        |
| A8 | Artifact dirs          | PASS    | plans/, history/              |
| A9 | CLAUDE.md OMB section  | MISSING |                               |
| A10| Version consistency    | PASS    | v1.2.0                        |
| A11| Statusline             | MISSING | Not configured in settings    |

Items to configure: 5
```

**If all PASS:** "Oh-My-Beads is fully configured. No changes needed." → STOP.

**If any MISSING/PARTIAL:**

> "Found N items to configure. Shall I proceed with setup?"
> 1. **Yes, configure everything** (Recommended)
> 2. **Let me choose** — Select which items to fix
> 3. **Cancel** — Exit without changes

---

## Phase B: Install/Wire

Execute only for items that are MISSING or PARTIAL from Phase A.

### B1. Install beads-village

**Only if A4 was MISSING.**

> "beads-village is required for task tracking and file locking. How would you like to install it?"
> 1. **npm install -g beads-village** (Recommended — fastest startup)
> 2. **Use via npx** (No global install, auto-downloads each session — slower first start)
> 3. **Skip** (Warning: omb/mr.fast workflows won't have task tracking)

**If Option 1:**
```bash
npm install -g beads-village
```
Verify: `which beads-village`. Report FIXED or ERROR with the npm output.

**If Option 2:**
Note: `.mcp.json` will use `npx -y beads-village` (Phase B3 handles this).
Report: FIXED beads-village ... configured via npx

**If Option 3:**
Report: SKIP beads-village ... user will install later

### B2. Write `.mcp.json`

**Only if A5 was MISSING or PARTIAL.**

Determine the beads-village command based on B1 choice:
- If global install: `{"command": "beads-village"}`
- If npx: `{"command": "npx", "args": ["-y", "beads-village"]}`
- If skipped: `{"command": "npx", "args": ["-y", "beads-village"]}` (default for future)

The `.mcp.json` to write (or merge):
```json
{
  "mcpServers": {
    "beads-village": {
      "command": "npx",
      "args": ["-y", "beads-village"],
      "env": {
        "BEADS_WORKING_DIR": "${workspaceFolder}"
      }
    }
  }
}
```

> "Write beads-village configuration to .mcp.json?"
> 1. **Yes** — Write/merge .mcp.json
> 2. **Show me the config first** — Preview JSON
> 3. **Skip** — I'll configure manually

**If Yes:** Read existing `.mcp.json` (or create `{}`), merge the `beads-village` entry
into `mcpServers`. Preserve existing MCP server entries. Write result.

Report: FIXED .mcp.json ... beads-village configured

### B3. Wire Hooks

**Only if A3 was MISSING or PARTIAL.**

Read the canonical hook configuration from the plugin's `hooks/hooks.json`.

> "Add Oh-My-Beads hooks to .claude/settings.json?"
> 1. **Yes** — Merge hooks into settings (preserves existing config)
> 2. **Show me the full config first** — Display JSON
> 3. **Skip** — I'll configure manually

**If Yes:** Read `.claude/settings.json` (or create `{}`), merge hooks from `hooks/hooks.json`.
Preserve existing hooks for other plugins.

**IMPORTANT:** Hook commands use `${CLAUDE_PLUGIN_ROOT}` which Claude Code resolves at runtime.
Write them exactly as they appear in hooks.json.

Report: FIXED hooks ... N/N events wired

### B4. Create Project Artifact Dirs

**Only if A8 was MISSING or PARTIAL.**

```bash
mkdir -p .oh-my-beads/plans
mkdir -p .oh-my-beads/history
```

Check `.gitignore` includes `.oh-my-beads/state/` (legacy) — suggest adding if missing.
Note: Runtime state is at `~/.oh-my-beads/` (system-level) so no gitignore needed for runtime.

Report: FIXED artifact dirs ... plans/, history/ created

### B5. Configure Statusline

**Only if A11 was MISSING.**

Determine the absolute path to the Oh-My-Beads plugin root directory (the directory that contains
`scripts/statusline.mjs`). Build the statusline command:

```
node <absolute-plugin-root>/scripts/statusline.mjs
```

Read `~/.claude/settings.json` (or create `{}` if it does not exist).

Add the `statusLine` entry:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node <absolute-plugin-root>/scripts/statusline.mjs"
  }
}
```

**Important constraints:**
- The path MUST be absolute (e.g., `/home/user/.claude/plugins/oh-my-beads/scripts/statusline.mjs`)
- Preserve ALL existing keys in `~/.claude/settings.json` — only add/update the `statusLine` key
- This is auto-configured without asking the user (no AskUserQuestion needed)
- If `statusLine` already points to a non-OMB command (A11 was SKIP), do NOT overwrite — warn the user instead

Report: FIXED statusline ... HUD configured in ~/.claude/settings.json

---

## Phase C: Configure + Finalize

### C1. Add OMB Section to CLAUDE.md

**Only if A9 was MISSING or PARTIAL.**

Read the current CLAUDE.md (if exists). The OMB section is wrapped in markers for
idempotent updates:

```markdown
<!-- OMB:START — Do not edit this section manually. Run 'setup omb' to update. -->
## Oh-My-Beads Quick Reference

### Keywords

| Keyword | Mode | Description |
|---------|------|-------------|
| `omb`, `oh-my-beads`, `mr.beads` | Mr.Beads | Full 8-step workflow with 3 HITL gates |
| `mr.fast`, `mrfast` | Mr.Fast | Lightweight 2-step fix (Scout → Executor) |
| `cancel omb`, `cancel mrfast` | Cancel | Stop active session cleanly |

### State Model

- Runtime state: `~/.oh-my-beads/projects/{hash}/` (system-level, never committed)
- Project artifacts: `{cwd}/.oh-my-beads/plans/`, `history/` (committed to repo)
- No per-project setup needed — SessionStart auto-creates dirs

### Skills

| Skill | Purpose |
|-------|---------|
| `/oh-my-beads:setup` | This setup wizard |
| `/oh-my-beads:doctor` | Diagnose workspace health |
| `/oh-my-beads:cancel` | Cancel active session |

### Agents

Master | Scout | Fast Scout | Architect | Worker | Reviewer |
Explorer | Executor | Verifier | Code Reviewer | Security Reviewer | Test Engineer
<!-- OMB:END -->
```

**If markers already exist:** Replace content between `<!-- OMB:START -->` and `<!-- OMB:END -->`.
**If no markers but OMB content exists:** Wrap existing content in markers, then update.
**If no OMB content:** Append the section to CLAUDE.md.

> "Add Oh-My-Beads quick-reference to CLAUDE.md?"
> 1. **Yes** — Add/update with merge markers
> 2. **Show me the content first** — Preview
> 3. **Skip** — I'll add it myself

Report: FIXED CLAUDE.md ... OMB section added/updated

### C2. Write Setup Completion State

Write `~/.oh-my-beads/setup.json`:

```json
{
  "setupCompleted": "<ISO-8601 timestamp>",
  "setupVersion": "<current plugin version>",
  "beadsVillageMethod": "global|npx|skip",
  "hooksWired": true,
  "mcpConfigured": true,
  "claudeMdUpdated": true
}
```

This file is the idempotency gate — next time `/oh-my-beads:setup` runs, it checks
this file first and offers a quick-update path instead of the full wizard.

### C3. Final Summary

```
=== Oh-My-Beads Setup Complete ===

| Component              | Status |
|------------------------|--------|
| Node.js                | PASS   |
| beads-village          | FIXED  |
| .mcp.json              | FIXED  |
| Hooks wiring           | FIXED  |
| Artifact dirs          | PASS   |
| Statusline             | FIXED  |
| CLAUDE.md              | FIXED  |

Oh-My-Beads v{version} is ready!

Quick start:
  "omb <feature request>"    → Mr.Beads (full 8-step workflow)
  "mr.fast <quick fix>"      → Mr.Fast (lightweight 2-step)
  "/oh-my-beads:doctor"      → Check workspace health

Note: Restart Claude Code to activate MCP changes.
```

</Steps>

<Tool_Usage>
- Read: Check existing files (settings.json, CLAUDE.md, .mcp.json, hooks.json, setup.json)
- Write: Create/update files when confirmed by user
- Edit: Merge config into existing files (settings.json, .mcp.json, CLAUDE.md)
- Bash: Install beads-village (npm install -g), create directories (mkdir -p)
- Glob: Verify directory existence
- AskUserQuestion: Every modification requires user confirmation
- mcp__beads-village__status: Test beads_village connectivity
</Tool_Usage>

<Idempotency>
This wizard is designed to be run multiple times safely:
- Phase A0 checks `~/.oh-my-beads/setup.json` to detect prior completion
- Phase A always checks current state before suggesting changes
- Phase B only modifies what is MISSING or PARTIAL
- Phase C1 uses `<!-- OMB:START/END -->` markers for surgical CLAUDE.md merge
- Phase C2 writes completion state for future idempotency
- Existing configurations from other plugins are preserved during merge
- Running the wizard when everything is configured results in "No changes needed"
</Idempotency>

<Error_Handling>
- If Node.js < 18: ERROR, stop (scripts won't work)
- If `.claude/settings.json` has invalid JSON: warn, offer to back up and recreate
- If `hooks/hooks.json` cannot be found: check common paths, report error with guidance
- If npm install fails: report error, suggest manual install or npx fallback
- If beads_village MCP is unreachable after install: note it as post-setup action (restart Claude Code)
- If directory creation fails: report error, suggest checking permissions
- If CLAUDE.md write fails: show content to add manually
</Error_Handling>
