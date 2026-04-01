---
name: statusline
description: Configure Claude Code status line to show Oh-My-Beads session status (mode, phase, agents, failures)
level: 3
model: claude-sonnet-4-6
trigger: "omb status|omb statusline|omb hud"
---

<Purpose>
Configure Claude Code's status line to display real-time Oh-My-Beads session state.
Shows the active mode, current phase, reinforcement count, and failure count at a glance.
</Purpose>

<Use_When>
- User wants to see OMB session status in the Claude Code status line
- User triggers "omb status", "omb statusline", or "omb hud"
- Setting up a new workspace and wants persistent session visibility
</Use_When>

<Do_Not_Use_When>
- User is asking about beads_village task status (use `bv status` instead)
- User wants a one-time status check (just read session.json directly)
</Do_Not_Use_When>

<Status_Script>
The status line is powered by `scripts/statusline.mjs` in the Oh-My-Beads plugin directory.
This script reads `.oh-my-beads/state/session.json` from cwd and outputs a compact one-line status.

Output format:
- Active Mr.Beads: `OMB [Mr.Beads] Phase 6: Execution | R:3 F:0`
- Active Mr.Fast: `OMB [Mr.Fast] Analyzing | F:0`
- Idle or no session: `OMB idle`

Where R = reinforcement count, F = failure count.

Phase display mapping:
| Internal Phase | Display |
|---------------|---------|
| bootstrap | Bootstrapping |
| phase_1_exploration | Phase 1: Exploration |
| phase_2_planning | Phase 2: Planning |
| phase_3_persistence | Phase 3: Persistence |
| phase_4_decomposition | Phase 4: Decomposition |
| phase_5_validation | Phase 5: Validation |
| phase_6_execution | Phase 6: Execution |
| phase_7_review | Phase 7: Review |
| phase_8_summary | Phase 8: Summary |
| gate_1_pending | Gate 1: Awaiting User |
| gate_2_pending | Gate 2: Awaiting User |
| gate_3_pending | Gate 3: Awaiting User |
| fast_bootstrap | Bootstrapping |
| fast_scout | Analyzing |
| fast_execution | Implementing |
</Status_Script>

<Setup_Instructions>
Follow these steps to enable the OMB status line:

### Step 1: Locate the plugin path

Find the Oh-My-Beads plugin directory. It is either:
- The current project if it contains `scripts/statusline.mjs`
- The installed plugin path under `~/.claude/plugins/oh-my-beads/`

Store the absolute path to `scripts/statusline.mjs` as SCRIPT_PATH.

### Step 2: Configure settings.json

Add the `statusLine` key to `~/.claude/settings.json`. The value is a shell command
that Claude Code runs periodically; its stdout becomes the status text.

```json
{
  "statusLine": "node SCRIPT_PATH"
}
```

Replace SCRIPT_PATH with the absolute path found in Step 1.

For example, if the plugin lives at `/home/user/Code/OhMyBeads`:
```json
{
  "statusLine": "node /home/user/Code/OhMyBeads/scripts/statusline.mjs"
}
```

### Step 3: Project-scoped alternative

If you only want the status line for a specific project, add it to the project's
`.claude/settings.json` instead of the global one:

```json
{
  "statusLine": "node /path/to/OhMyBeads/scripts/statusline.mjs"
}
```

### Step 4: Verify

After saving settings.json, the status line should appear in Claude Code.
- If no OMB session is active, it shows: `OMB idle`
- Start an OMB session ("omb build me X") and the status updates to show mode and phase.

### Troubleshooting

If the status line does not appear:
1. Verify the script path is correct: `node /path/to/scripts/statusline.mjs` should print `OMB idle`
2. Ensure `~/.claude/settings.json` is valid JSON (no trailing commas)
3. Check that Node.js 18+ is available in the shell PATH used by Claude Code
</Setup_Instructions>

<Implementation_Notes>
- The script is zero-dependency (only Node.js builtins)
- It never writes to stderr, never throws — always exits cleanly with status 0
- Reads only from `.oh-my-beads/state/session.json` relative to cwd
- Accepts an optional directory argument: `node statusline.mjs /path/to/project`
- The statusLine command runs in the project cwd, so the default behavior works without arguments
</Implementation_Notes>
