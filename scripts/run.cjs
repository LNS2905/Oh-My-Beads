#!/usr/bin/env node
"use strict";

/**
 * Hook runner for oh-my-beads plugin.
 * Spawns .mjs hook scripts using the current Node binary.
 * Handles stale CLAUDE_PLUGIN_ROOT paths and propagates exit codes.
 *
 * Usage: node run.cjs <path-to-hook-script.mjs> [args...]
 */

const { execFileSync } = require("child_process");
const { existsSync, readdirSync } = require("fs");
const { join, dirname, resolve } = require("path");

function resolveTarget(target) {
  if (existsSync(target)) return target;

  // If CLAUDE_PLUGIN_ROOT is stale (version changed), scan for the script
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (!pluginRoot) return target;

  // Try walking up to the cache directory and scanning version dirs
  const cacheParent = dirname(pluginRoot);
  if (!existsSync(cacheParent)) return target;

  try {
    const versions = readdirSync(cacheParent).sort().reverse();
    for (const ver of versions) {
      const candidate = join(cacheParent, ver, target.replace(pluginRoot, "").replace(/^[/\\]/, ""));
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // Fall through
  }
  return target;
}

const args = process.argv.slice(2);
if (args.length === 0) {
  process.exit(0);
}

const target = resolveTarget(args[0]);
const scriptArgs = args.slice(1);

try {
  execFileSync(process.execPath, [target, ...scriptArgs], {
    stdio: "inherit",
    env: process.env,
    timeout: 60_000,
  });
} catch (err) {
  // Propagate exit code but never block Claude Code hooks
  const code = err.status ?? 0;
  process.exit(code);
}
