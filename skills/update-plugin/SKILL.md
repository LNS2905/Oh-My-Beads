---
name: update-plugin
description: >-
  Check for and apply Oh-My-Beads plugin updates from the marketplace.
  Compares installed version against remote, pulls latest, and re-runs setup.
level: 4
model: claude-sonnet-4-6
trigger: "update omb|omb update|update oh-my-beads|upgrade omb|omb upgrade"
---

<Purpose>
Check for Oh-My-Beads plugin updates from the configured marketplace, apply the update
if available, and re-run the setup wizard to ensure hooks, config, and CLAUDE.md are current.
Designed to be safe — shows what will change before applying.
</Purpose>

<Use_When>
- User says "update omb", "omb update", "upgrade omb", or "/oh-my-beads:update-plugin"
- Session-start showed an `[UPDATE]` banner indicating version mismatch
- User wants to check if a newer version is available
- After a known plugin release
</Use_When>

<Do_Not_Use_When>
- User wants to configure OMB from scratch (use `/oh-my-beads:setup` instead)
- User wants to diagnose issues (use `/oh-my-beads:doctor` instead)
- An active Mr.Beads or Mr.Fast session is running (update after cancelling)
</Do_Not_Use_When>

<Why_This_Exists>
Plugin updates require pulling from the marketplace git repo, updating the cache,
and re-wiring hooks/config. Without a dedicated command, users must manually manage
git pulls, version checks, and re-running setup. This skill automates the full cycle.
</Why_This_Exists>

<Execution_Policy>
- Always show current vs available versions before applying
- Never update during an active OMB session (check session.json first)
- After update, automatically invoke setup wizard for config refresh
- Idempotent — running when already up-to-date reports "No update available"
</Execution_Policy>

<Steps>

## Step 1: Check for Active Session

Read session state (system-level or legacy) to ensure no active workflow:

```
Read: ~/.oh-my-beads/projects/{hash}/session.json
```

If `active: true` and phase is not `complete`/`cancelled`/`failed`:
> "An active Oh-My-Beads session is running (phase: {phase}). Cancel it first with 'cancel omb', then retry the update."
> STOP.

## Step 2: Detect Current Installation

Read the installed plugin metadata:

```
Read: ~/.claude/plugins/installed_plugins.json
```

Find the `oh-my-beads@oh-my-beads` entry (or matching marketplace key).
Extract:
- `version` — currently installed version
- `installPath` — where the plugin is cached
- `gitCommitSha` — current commit (if available)
- `lastUpdated` — when it was last updated

Also read the marketplace source:

```
Read: ~/.claude/plugins/known_marketplaces.json
```

Find the `oh-my-beads` marketplace entry. Extract:
- `source.repo` or `source.url` — git remote
- `installLocation` — local marketplace clone path

If no oh-my-beads entry found in either file:
> "Oh-My-Beads is not installed via marketplace. Install it first:
> `/install oh-my-beads from github:LNS2905/oh-my-beads`"
> STOP.

Report:
```
Current installation:
  Version: {version}
  Installed: {lastUpdated}
  Cache: {installPath}
  Marketplace: {source.repo}
```

## Step 3: Check for Updates

Fetch the latest version from the marketplace git repo:

```bash
cd {installLocation} && git fetch origin main --quiet 2>&1
```

Compare local HEAD with remote:

```bash
cd {installLocation} && git log HEAD..origin/main --oneline 2>&1
```

Also read the remote plugin.json version:

```bash
cd {installLocation} && git show origin/main:.claude-plugin/plugin.json 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).version)}catch{console.log('unknown')}})"
```

**If no new commits:**
> "Oh-My-Beads is up to date (v{version}). No update available."
> STOP.

**If new commits exist:**
Show the changelog:
```
Update available: v{current} → v{remote}

New commits:
{git log output}
```

> "Apply this update?"
> 1. **Yes — update now** (Recommended)
> 2. **Show full changelog** — see all changes before deciding
> 3. **Skip** — update later

## Step 4: Apply Update

Pull the latest from the marketplace:

```bash
cd {installLocation} && git pull origin main --quiet 2>&1
```

Read the new version from plugin.json:

```
Read: {installLocation}/.claude-plugin/plugin.json
```

Update the plugin cache. Claude Code uses `installPath` from `installed_plugins.json`:

```bash
# Copy new version to cache
NEW_VERSION=$(node -e "console.log(require('{installLocation}/.claude-plugin/plugin.json').version)")
CACHE_DIR=~/.claude/plugins/cache/oh-my-beads/oh-my-beads/${NEW_VERSION}
mkdir -p "${CACHE_DIR}"
cp -r {installLocation}/. "${CACHE_DIR}/"
```

Update `installed_plugins.json` — edit the `oh-my-beads@oh-my-beads` entry:
- Set `version` to the new version
- Set `installPath` to the new cache path
- Set `lastUpdated` to current ISO timestamp
- Set `gitCommitSha` to the new HEAD sha

```bash
cd {installLocation} && git rev-parse HEAD
```

## Step 5: Post-Update Setup

After applying the update, run the setup wizard to refresh config:

> "Update applied (v{old} → v{new}). Running setup wizard to refresh configuration..."

Invoke setup:
```
Skill: oh-my-beads:setup
```

The setup wizard (with `--update` mode awareness) will:
- Re-check hooks wiring against the new hooks.json
- Update CLAUDE.md OMB section if content changed
- Update `~/.oh-my-beads/setup.json` with new `setupVersion`
- Report any new prerequisites

## Step 6: Final Report

```
=== Oh-My-Beads Update Complete ===

  Previous: v{old}
  Updated:  v{new}
  Changes:  {N} commits applied

Post-update actions:
  - Hooks: {refreshed|unchanged}
  - CLAUDE.md: {updated|unchanged}
  - setup.json: updated to v{new}

NOTE: Restart Claude Code to fully activate plugin changes.
      MCP server configuration may require a restart.
```

</Steps>

<Tool_Usage>
- Read: installed_plugins.json, known_marketplaces.json, plugin.json, session.json, setup.json
- Bash: git fetch, git log, git pull, cp, mkdir, git rev-parse
- Edit: Update installed_plugins.json with new version info
- Skill: Invoke oh-my-beads:setup for post-update config refresh
- AskUserQuestion: Confirm update before applying
</Tool_Usage>

<Error_Handling>
- Git fetch fails (network): Report error, suggest manual `git pull` in marketplace dir
- Git pull conflicts: Report conflict, suggest resolving manually or re-cloning
- Plugin.json parse error: Report, suggest checking marketplace repo integrity
- Cache directory write fails: Report permission error, suggest manual copy
- installed_plugins.json not writable: Report, suggest checking permissions
- Setup wizard fails post-update: Report but mark update as successful (config can be fixed later)
</Error_Handling>

<Rollback>
If the update causes issues, the user can rollback:

1. The previous version remains in the cache at `~/.claude/plugins/cache/oh-my-beads/oh-my-beads/{old_version}/`
2. Edit `~/.claude/plugins/installed_plugins.json` to point `installPath` back to the old version dir
3. Restart Claude Code

Include this guidance if the update reports errors.
</Rollback>

<Final_Checklist>
- [ ] Active session check passed (no running workflows)
- [ ] Current version detected from installed_plugins.json
- [ ] Remote version fetched from marketplace git repo
- [ ] User confirmed update (or no update available)
- [ ] Marketplace pulled to latest
- [ ] Cache directory created with new version
- [ ] installed_plugins.json updated
- [ ] Setup wizard invoked for config refresh
- [ ] setup.json updated with new version
- [ ] Final report presented with restart reminder
</Final_Checklist>
