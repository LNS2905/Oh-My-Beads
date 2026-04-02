---
name: statusline
description: Configure Claude Code status line to show Oh-My-Beads HUD (mode, phase, context %, agents, beads, session duration)
level: 3
model: claude-sonnet-4-6
trigger: "omb status|omb statusline|omb hud"
---

<Purpose>
Configure Claude Code's status line to display a rich Oh-My-Beads HUD, matching the OMC Hub style.
Shows mode, current phase, context window %, session duration, active agents, beads progress, and counters.
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
The HUD is powered by `scripts/statusline.mjs` in the Oh-My-Beads plugin directory.
It reads stdin JSON from Claude Code (context_window, model info) plus `.oh-my-beads/state/` files.

## Output Format

Active session (Mr.Beads):
```
[OMB#1.1.0] Mr.Beads | Phase 6: Execution | ctx:[████████░░]80% COMPRESS? | session:12m | agents:WSR | beads:3/8 | files:5 | R:3 F:0
```

Active session (Mr.Fast):
```
[OMB#1.1.0] Mr.Fast | Implementing | ctx:42% | session:2m | agents:x | F:0
```

Idle / no session:
```
[OMB#1.1.0] idle | ctx:15%
```

## Display Elements

| Element | Format | Source |
|---------|--------|--------|
| Label | `[OMB#1.1.0]` | plugin.json version |
| Mode | `Mr.Beads` / `Mr.Fast` | session.json mode |
| Phase | `Phase 6: Execution` | session.json current_phase |
| Context | `ctx:[████░░░░░░]42%` | stdin context_window.used_percentage |
| Session | `session:12m` | session.json started_at |
| Agents | `agents:WSR` | subagent-tracking.json (running agents) |
| Beads | `beads:3/8` | session.json beads_closed/beads_created |
| Files | `files:5` | tool-tracking.json files_modified count |
| Counters | `R:3 F:0` | session.json reinforcement_count, failure_count |

## Color Coding

| Element | Green | Yellow | Red |
|---------|-------|--------|-----|
| Context | <70% | 70-84% | >=85% CRITICAL |
| Session | <60m | 60-120m | >120m |
| Reinforcements | <=5 | 6-10 | >10 |
| Failures | 0 | 1-3 | >3 |

Context window thresholds:
- 70%: yellow warning
- 80%: yellow + "COMPRESS?" suffix
- 85%: red + "CRITICAL" suffix

## Agent Codes

| Agent | Code | Model Color |
|-------|------|-------------|
| Master | M | Magenta (Opus) |
| Scout | S | Yellow (Sonnet) |
| Fast Scout | F | Yellow (Sonnet) |
| Architect | A | Magenta (Opus) |
| Worker | W | Yellow (Sonnet) |
| Reviewer | R | Yellow (Sonnet) |
| Explorer | e | Green (Haiku) |
| Executor | x | Yellow (Sonnet) |
| Verifier | V | Yellow (Sonnet) |
| Code Reviewer | CR | Magenta (Opus) |
| Security Reviewer | K | Yellow (Sonnet) |
| Test Engineer | T | Yellow (Sonnet) |

Phase display mapping (22 phases):
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
| fast_complete | Complete |
| complete | Complete |
| completed | Completed |
| cancelled | Cancelled |
| failed | Failed |
</Status_Script>

<Setup_Instructions>
Follow these steps to enable the OMB HUD:

### Step 1: Locate the plugin path

Find the Oh-My-Beads plugin directory. It is either:
- The current project if it contains `scripts/statusline.mjs`
- The installed plugin path under `~/.claude/plugins/oh-my-beads/`

Store the absolute path to `scripts/statusline.mjs` as SCRIPT_PATH.

### Step 2: Configure settings.json

Add the `statusLine` key to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node SCRIPT_PATH"
  }
}
```

Replace SCRIPT_PATH with the absolute path found in Step 1.

For example, if the plugin lives at `/home/user/Code/OhMyBeads`:
```json
{
  "statusLine": {
    "type": "command",
    "command": "node /home/user/Code/OhMyBeads/scripts/statusline.mjs"
  }
}
```

### Step 3: Project-scoped alternative

If you only want the HUD for a specific project, add it to the project's
`.claude/settings.json` instead of the global one.

### Step 4: Verify

After saving settings.json, the HUD should appear in Claude Code.
- If no OMB session is active, it shows: `[OMB#1.1.0] idle`
- Start an OMB session ("omb build me X") and the HUD updates with mode, phase, context, etc.
- Context window % updates in real-time from Claude Code's stdin

### Troubleshooting

If the HUD does not appear:
1. Verify the script path: `echo '{}' | node /path/to/scripts/statusline.mjs` should print `[OMB#1.1.0] idle`
2. Ensure `~/.claude/settings.json` is valid JSON
3. Check that Node.js 18+ is available
4. The script reads stdin JSON from Claude Code — when run manually, pipe `{}` as input
</Setup_Instructions>

<Implementation_Notes>
- Zero-dependency (only Node.js builtins)
- Never writes to stderr, never throws — always exits cleanly with status 0
- Reads stdin JSON from Claude Code (context_window, model, cwd)
- Falls back to argv directory or cwd when no stdin is provided
- Uses non-breaking spaces for terminal alignment (same as OMC)
- Context bar uses block characters (█/░) with color thresholds
- Agent codes follow OMC's single-character pattern with model-tier coloring
- ANSI colors: green (normal), yellow (warning), red (critical), cyan (info), magenta (opus)
</Implementation_Notes>
