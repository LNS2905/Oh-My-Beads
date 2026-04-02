#!/usr/bin/env node

/**
 * oh-my-beads Project Memory — cross-session knowledge persistence.
 *
 * Stores what the agent learns about a project: tech stack, build commands,
 * frequently accessed files, user directives, and custom notes.
 *
 * Stored at: ~/.oh-my-beads/projects/{hash}/project-memory.json
 *
 * Zero dependencies — uses only fs/path.
 *
 * Exports:
 *   detectProjectEnv(cwd)            — Auto-detect tech stack from config files.
 *   loadMemory(stateDir)             — Read project-memory.json or return default.
 *   saveMemory(stateDir, memory)     — Atomic write via writeJsonAtomic.
 *   formatSummary(memory, budget)    — Tiered 650-char summary.
 *   addHotPath(memory, path, type)   — Track file access frequency (max 50).
 *   addNote(memory, content, cat)    — Add timestamped note (max 20).
 *   addDirective(memory, dir, pri)   — Add user directive (max 20).
 */

import { readFileSync, existsSync } from "fs";
import { join, basename } from "path";
import { writeJsonAtomic } from "./helpers.mjs";

const MEMORY_FILE = "project-memory.json";
const MAX_HOT_PATHS = 50;
const MAX_NOTES = 20;
const MAX_DIRECTIVES = 20;
const RESCAN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// --- Default empty memory structure ---

function createDefaultMemory() {
  return {
    version: 1,
    lastScanned: 0,
    techStack: { languages: [], frameworks: [], pkgManager: "", runtime: "" },
    build: { test: "", build: "", lint: "", dev: "", scripts: {} },
    customNotes: [],
    hotPaths: [],
    userDirectives: [],
  };
}

// --- Helpers ---

function readJsonFile(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch { return null; }
}

function readTextFile(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, "utf8");
  } catch { return null; }
}

// --- detectProjectEnv ---

/**
 * Auto-detect project environment from config files.
 * Scans: package.json, tsconfig.json, pyproject.toml, Cargo.toml, go.mod, etc.
 * Returns: { techStack, build } fields.
 *
 * @param {string} cwd — Project root directory.
 * @returns {{ techStack: object, build: object }}
 */
export function detectProjectEnv(cwd) {
  const techStack = { languages: [], frameworks: [], pkgManager: "", runtime: "" };
  const build = { test: "", build: "", lint: "", dev: "", scripts: {} };

  // --- Node.js / package.json ---
  const pkg = readJsonFile(join(cwd, "package.json"));
  if (pkg) {
    if (!techStack.languages.includes("JavaScript")) techStack.languages.push("JavaScript");
    techStack.runtime = "node";

    // Detect package manager
    if (existsSync(join(cwd, "pnpm-lock.yaml"))) techStack.pkgManager = "pnpm";
    else if (existsSync(join(cwd, "yarn.lock"))) techStack.pkgManager = "yarn";
    else if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) techStack.pkgManager = "bun";
    else techStack.pkgManager = "npm";

    // Extract scripts
    const scripts = pkg.scripts || {};
    build.scripts = { ...scripts };
    if (scripts.test) build.test = `${techStack.pkgManager} test`;
    if (scripts.build) build.build = `${techStack.pkgManager} run build`;
    if (scripts.lint) build.lint = `${techStack.pkgManager} run lint`;
    if (scripts.dev) build.dev = `${techStack.pkgManager} run dev`;

    // Detect frameworks from deps + devDeps
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

    // TypeScript
    if (allDeps.typescript || existsSync(join(cwd, "tsconfig.json"))) {
      if (!techStack.languages.includes("TypeScript")) techStack.languages.push("TypeScript");
    }

    // Frameworks
    const frameworkMap = {
      react: "React", "react-dom": "React", next: "Next.js",
      vue: "Vue", nuxt: "Nuxt", svelte: "Svelte", "@sveltejs/kit": "SvelteKit",
      angular: "Angular", "@angular/core": "Angular",
      express: "Express", fastify: "Fastify", koa: "Koa", hono: "Hono",
      nestjs: "NestJS", "@nestjs/core": "NestJS",
      tailwindcss: "Tailwind CSS",
      prisma: "Prisma", "@prisma/client": "Prisma",
      drizzle: "Drizzle", "drizzle-orm": "Drizzle",
      vitest: "Vitest", jest: "Jest", mocha: "Mocha",
      electron: "Electron",
    };

    for (const [dep, name] of Object.entries(frameworkMap)) {
      if (allDeps[dep] && !techStack.frameworks.includes(name)) {
        techStack.frameworks.push(name);
      }
    }
  }

  // --- TypeScript (standalone check) ---
  if (existsSync(join(cwd, "tsconfig.json"))) {
    if (!techStack.languages.includes("TypeScript")) techStack.languages.push("TypeScript");
  }

  // --- Python / pyproject.toml ---
  const pyproject = readTextFile(join(cwd, "pyproject.toml"));
  if (pyproject) {
    if (!techStack.languages.includes("Python")) techStack.languages.push("Python");
    techStack.runtime = techStack.runtime || "python";

    // Detect package manager
    if (existsSync(join(cwd, "poetry.lock"))) techStack.pkgManager = techStack.pkgManager || "poetry";
    else if (existsSync(join(cwd, "uv.lock"))) techStack.pkgManager = techStack.pkgManager || "uv";
    else if (existsSync(join(cwd, "Pipfile.lock"))) techStack.pkgManager = techStack.pkgManager || "pipenv";
    else techStack.pkgManager = techStack.pkgManager || "pip";

    // Detect frameworks from pyproject.toml content
    if (pyproject.includes("django") || pyproject.includes("Django")) {
      if (!techStack.frameworks.includes("Django")) techStack.frameworks.push("Django");
    }
    if (pyproject.includes("fastapi") || pyproject.includes("FastAPI")) {
      if (!techStack.frameworks.includes("FastAPI")) techStack.frameworks.push("FastAPI");
    }
    if (pyproject.includes("flask") || pyproject.includes("Flask")) {
      if (!techStack.frameworks.includes("Flask")) techStack.frameworks.push("Flask");
    }
    if (pyproject.includes("pytest")) {
      if (!build.test) build.test = "pytest";
    }
  } else if (existsSync(join(cwd, "requirements.txt")) || existsSync(join(cwd, "setup.py"))) {
    if (!techStack.languages.includes("Python")) techStack.languages.push("Python");
    techStack.runtime = techStack.runtime || "python";
    techStack.pkgManager = techStack.pkgManager || "pip";
  }

  // --- Rust / Cargo.toml ---
  if (existsSync(join(cwd, "Cargo.toml"))) {
    if (!techStack.languages.includes("Rust")) techStack.languages.push("Rust");
    techStack.runtime = techStack.runtime || "cargo";
    techStack.pkgManager = techStack.pkgManager || "cargo";
    if (!build.test) build.test = "cargo test";
    if (!build.build) build.build = "cargo build";
    if (!build.lint) build.lint = "cargo clippy";
  }

  // --- Go / go.mod ---
  if (existsSync(join(cwd, "go.mod"))) {
    if (!techStack.languages.includes("Go")) techStack.languages.push("Go");
    techStack.runtime = techStack.runtime || "go";
    techStack.pkgManager = techStack.pkgManager || "go";
    if (!build.test) build.test = "go test ./...";
    if (!build.build) build.build = "go build ./...";
    if (!build.lint) build.lint = "golangci-lint run";
  }

  // --- Ruby / Gemfile ---
  if (existsSync(join(cwd, "Gemfile"))) {
    if (!techStack.languages.includes("Ruby")) techStack.languages.push("Ruby");
    techStack.runtime = techStack.runtime || "ruby";
    techStack.pkgManager = techStack.pkgManager || "bundler";
    const gemfileContent = readTextFile(join(cwd, "Gemfile"));
    if (gemfileContent && gemfileContent.includes("rails")) {
      if (!techStack.frameworks.includes("Rails")) techStack.frameworks.push("Rails");
    }
  }

  // --- Java / build.gradle or pom.xml ---
  if (existsSync(join(cwd, "build.gradle")) || existsSync(join(cwd, "build.gradle.kts"))) {
    if (!techStack.languages.includes("Java")) techStack.languages.push("Java");
    techStack.runtime = techStack.runtime || "jvm";
    techStack.pkgManager = techStack.pkgManager || "gradle";
    if (!build.test) build.test = "./gradlew test";
    if (!build.build) build.build = "./gradlew build";
  } else if (existsSync(join(cwd, "pom.xml"))) {
    if (!techStack.languages.includes("Java")) techStack.languages.push("Java");
    techStack.runtime = techStack.runtime || "jvm";
    techStack.pkgManager = techStack.pkgManager || "maven";
    if (!build.test) build.test = "mvn test";
    if (!build.build) build.build = "mvn package";
  }

  return { techStack, build };
}

// --- loadMemory ---

/**
 * Load project memory from stateDir/project-memory.json.
 * Returns parsed data or a default empty structure.
 *
 * @param {string} stateDir — System-level state directory for the project.
 * @returns {object} Project memory object.
 */
export function loadMemory(stateDir) {
  const filePath = join(stateDir, MEMORY_FILE);
  const data = readJsonFile(filePath);
  if (data && data.version) return data;
  return createDefaultMemory();
}

// --- saveMemory ---

/**
 * Save project memory atomically.
 *
 * @param {string} stateDir — System-level state directory.
 * @param {object} memory — Project memory object.
 */
export function saveMemory(stateDir, memory) {
  const filePath = join(stateDir, MEMORY_FILE);
  writeJsonAtomic(filePath, memory);
}

// --- needsRescan ---

/**
 * Check if project memory needs a rescan (>24h since last scan).
 *
 * @param {object} memory — Project memory object.
 * @returns {boolean}
 */
export function needsRescan(memory) {
  if (!memory.lastScanned) return true;
  return (Date.now() - memory.lastScanned) > RESCAN_INTERVAL_MS;
}

// --- rescan ---

/**
 * Rescan the project and update memory, preserving user data.
 * Preserves: customNotes, hotPaths, userDirectives.
 * Updates: techStack, build, lastScanned, version.
 *
 * @param {string} cwd — Project root directory.
 * @param {object} memory — Existing project memory.
 * @returns {object} Updated project memory.
 */
export function rescan(cwd, memory) {
  const { techStack, build } = detectProjectEnv(cwd);
  return {
    ...memory,
    version: 1,
    lastScanned: Date.now(),
    techStack,
    build,
    // Preserve user data across rescans
    customNotes: memory.customNotes || [],
    hotPaths: memory.hotPaths || [],
    userDirectives: memory.userDirectives || [],
  };
}

// --- formatSummary ---

/**
 * Format a tiered summary of project memory within a character budget.
 *
 * Tiers (in priority order):
 *   [Environment] lang|framework|pkgMgr + commands
 *   [Hot Paths]   top 3 most accessed files
 *   [Directives]  top 3 user directives
 *   [Notes]       top 3 most recent notes
 *
 * @param {object} memory — Project memory object.
 * @param {number} [budget=650] — Maximum character count.
 * @returns {string} Formatted summary.
 */
export function formatSummary(memory, budget = 650) {
  const sections = [];

  // Tier 1: Environment
  const env = formatEnvironment(memory);
  if (env) sections.push(env);

  // Tier 2: Hot Paths
  const paths = formatHotPaths(memory);
  if (paths) sections.push(paths);

  // Tier 3: Directives
  const directives = formatDirectives(memory);
  if (directives) sections.push(directives);

  // Tier 4: Notes
  const notes = formatNotes(memory);
  if (notes) sections.push(notes);

  // Join and truncate to budget
  let result = sections.join("\n");
  if (result.length <= budget) return result;

  // Progressively drop lower-priority sections to fit budget
  while (sections.length > 1 && result.length > budget) {
    sections.pop();
    result = sections.join("\n");
  }

  // Final truncation if even tier 1 exceeds budget
  if (result.length > budget) {
    result = result.slice(0, budget - 3) + "...";
  }

  return result;
}

function formatEnvironment(memory) {
  const { techStack, build } = memory;
  if (!techStack?.languages?.length) return null;

  const parts = [];
  parts.push(techStack.languages.join(", "));
  if (techStack.frameworks?.length) parts.push(techStack.frameworks.join(", "));
  if (techStack.pkgManager) parts.push(techStack.pkgManager);

  let line = `[Environment] ${parts.join(" | ")}`;

  // Add commands
  const cmds = [];
  if (build?.test) cmds.push(`test: ${build.test}`);
  if (build?.build) cmds.push(`build: ${build.build}`);
  if (build?.lint) cmds.push(`lint: ${build.lint}`);
  if (build?.dev) cmds.push(`dev: ${build.dev}`);
  if (cmds.length) line += `\n  ${cmds.join(", ")}`;

  return line;
}

function formatHotPaths(memory) {
  const paths = (memory.hotPaths || [])
    .sort((a, b) => b.accessCount - a.accessCount)
    .slice(0, 3);
  if (!paths.length) return null;
  const items = paths.map(p => `${p.path} (${p.accessCount}×)`).join(", ");
  return `[Hot Paths] ${items}`;
}

function formatDirectives(memory) {
  const dirs = (memory.userDirectives || []).slice(0, 3);
  if (!dirs.length) return null;
  const items = dirs.map(d => d.directive).join("; ");
  return `[Directives] ${items}`;
}

function formatNotes(memory) {
  const notes = (memory.customNotes || [])
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 3);
  if (!notes.length) return null;
  const items = notes.map(n => `[${n.category}] ${n.content}`).join("; ");
  return `[Notes] ${items}`;
}

// --- addHotPath ---

/**
 * Track file/directory access frequency.
 * Increments accessCount if path exists, otherwise adds new entry.
 * Bounded to MAX_HOT_PATHS (50). Evicts least-accessed entry when full.
 *
 * @param {object} memory — Project memory object (mutated in place).
 * @param {string} path — File or directory path.
 * @param {string} [type="file"] — "file" or "dir".
 * @returns {object} The same memory object.
 */
export function addHotPath(memory, path, type = "file") {
  if (!memory.hotPaths) memory.hotPaths = [];

  const existing = memory.hotPaths.find(p => p.path === path);
  if (existing) {
    existing.accessCount++;
    existing.lastAccessed = Date.now();
    existing.type = type;
    return memory;
  }

  // At capacity — evict least accessed
  if (memory.hotPaths.length >= MAX_HOT_PATHS) {
    memory.hotPaths.sort((a, b) => a.accessCount - b.accessCount);
    memory.hotPaths.shift();
  }

  memory.hotPaths.push({
    path,
    accessCount: 1,
    lastAccessed: Date.now(),
    type,
  });

  return memory;
}

// --- addNote ---

/**
 * Add a custom note. Bounded to MAX_NOTES (20). Evicts oldest when full.
 *
 * @param {object} memory — Project memory object (mutated in place).
 * @param {string} content — Note content.
 * @param {string} [category="general"] — Note category.
 * @returns {object} The same memory object.
 */
export function addNote(memory, content, category = "general") {
  if (!memory.customNotes) memory.customNotes = [];

  // At capacity — evict oldest
  if (memory.customNotes.length >= MAX_NOTES) {
    memory.customNotes.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    memory.customNotes.shift();
  }

  memory.customNotes.push({
    timestamp: new Date().toISOString(),
    category,
    content,
  });

  return memory;
}

// --- addDirective ---

/**
 * Add a user directive. Bounded to MAX_DIRECTIVES (20). Evicts oldest when full.
 *
 * @param {object} memory — Project memory object (mutated in place).
 * @param {string} directive — Directive text.
 * @param {string} [priority="normal"] — Priority level ("high", "normal", "low").
 * @returns {object} The same memory object.
 */
export function addDirective(memory, directive, priority = "normal") {
  if (!memory.userDirectives) memory.userDirectives = [];

  // At capacity — evict oldest
  if (memory.userDirectives.length >= MAX_DIRECTIVES) {
    memory.userDirectives.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    memory.userDirectives.shift();
  }

  memory.userDirectives.push({
    timestamp: new Date().toISOString(),
    directive,
    priority,
  });

  return memory;
}
