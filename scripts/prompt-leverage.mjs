#!/usr/bin/env node

/**
 * oh-my-beads prompt leverage — upgrades raw user prompts into
 * execution-ready instruction sets with structured framework blocks.
 *
 * Zero-dependency Node.js port of khuym's augment_prompt.py.
 * Used by keyword-detector.mjs to strengthen prompts before
 * routing to Mr.Beads or Mr.Fast workflows.
 *
 * Exports: upgradePrompt(rawPrompt, options?)
 */

// --- Task Detection ---

const TASK_KEYWORDS = {
  coding: ["code", "bug", "repo", "refactor", "test", "implement", "fix", "function", "api", "endpoint", "component", "migration"],
  research: ["research", "compare", "find", "latest", "sources", "analyze market", "look up", "investigate", "explore"],
  writing: ["write", "rewrite", "draft", "email", "memo", "blog", "copy", "tone", "document", "readme"],
  review: ["review", "audit", "critique", "inspect", "evaluate", "assess", "check"],
  planning: ["plan", "roadmap", "strategy", "framework", "outline", "design", "architect"],
  analysis: ["analyze", "explain", "break down", "diagnose", "root cause", "debug", "trace", "why"],
};

export function detectTask(prompt) {
  const lowered = prompt.toLowerCase();
  const scores = {};
  for (const [task, keywords] of Object.entries(TASK_KEYWORDS)) {
    scores[task] = keywords.filter((kw) => lowered.includes(kw)).length;
  }
  let bestTask = "analysis";
  let bestScore = 0;
  for (const [task, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestTask = task;
      bestScore = score;
    }
  }
  return bestTask;
}

// --- Intensity Inference ---

const DEEP_TOKENS = ["careful", "deep", "thorough", "high stakes", "production", "critical", "complex", "security", "architecture"];
const STANDARD_TASKS = new Set(["coding", "research", "review", "analysis"]);

export function inferIntensity(prompt, task) {
  const lowered = prompt.toLowerCase();
  if (DEEP_TOKENS.some((t) => lowered.includes(t))) return "Deep";
  if (STANDARD_TASKS.has(task)) return "Standard";
  return "Light";
}

// --- Framework Blocks ---

function buildToolRules(task) {
  switch (task) {
    case "coding":
      return "Inspect relevant files and dependencies first. Validate with the narrowest useful checks before broadening scope.";
    case "research":
      return "Retrieve evidence from reliable sources before concluding. Do not guess facts that can be checked.";
    case "review":
      return "Read enough surrounding context to understand intent before critiquing. Distinguish confirmed issues from plausible risks.";
    case "analysis":
      return "Trace the problem systematically. Read actual code/data before forming hypotheses.";
    case "planning":
      return "Explore existing codebase structure before proposing new architecture. Understand constraints first.";
    default:
      return "Use tools or extra context only when they materially improve correctness or completeness.";
  }
}

function buildOutputContract(task) {
  switch (task) {
    case "coding":
      return "Concise summary, concrete changes or code, validation notes, and any remaining risks.";
    case "research":
      return "Structured synthesis with key findings, supporting evidence, uncertainty where relevant, and a concise bottom line.";
    case "writing":
      return "Polished final copy in the requested tone and format. Include rationale for major editorial choices if useful.";
    case "review":
      return "Findings grouped by severity, explain why each matters, suggest the smallest credible next step.";
    case "planning":
      return "Structured plan with phases, risks, dependencies, and clear acceptance criteria per step.";
    case "analysis":
      return "Root cause analysis with evidence, affected scope, and recommended action.";
    default:
      return "Clear, well-structured response matched to the task, with no unnecessary verbosity.";
  }
}

function buildVerification(task) {
  switch (task) {
    case "coding":
      return "Verify: code compiles/passes lint, tests cover the change, no regressions introduced, edge cases considered.";
    case "research":
      return "Verify: claims are sourced, alternative perspectives considered, conclusions follow from evidence.";
    case "review":
      return "Verify: findings are reproducible, severity is calibrated, no false positives from misunderstanding context.";
    default:
      return "Check correctness, completeness, and edge cases. Improve obvious weaknesses if a better approach is available within scope.";
  }
}

// --- Main Export ---

/**
 * Upgrade a raw prompt into a clean, natural-sounding execution prompt.
 *
 * The output reads like a well-written user request — no framework labels
 * or scaffolding visible. Guardrails are woven into the prose so the
 * receiving agent doesn't see "Objective:" / "Tool Rules:" noise.
 *
 * @param {string} rawPrompt - The user's raw prompt text
 * @param {object} [options] - Optional overrides
 * @param {string} [options.task] - Force a specific task type
 * @param {string} [options.mode] - "mr.beads" or "mr.fast" — adjusts depth
 * @returns {{ augmented: string, task: string, intensity: string }}
 */
export function upgradePrompt(rawPrompt, options = {}) {
  const normalized = rawPrompt.replace(/\s+/g, " ").trim();
  const task = options.task || detectTask(normalized);
  let intensity = inferIntensity(normalized, task);

  // Mr.Fast caps at Light intensity — speed over thoroughness
  if (options.mode === "mr.fast" && (intensity === "Deep" || intensity === "Standard")) {
    intensity = "Light";
  }

  const toolRules = buildToolRules(task);
  const outputContract = buildOutputContract(task);
  const verification = buildVerification(task);

  // Build a natural-sounding enhanced prompt — no framework labels
  const parts = [normalized];

  // Append concise guardrails as natural sentences
  parts.push("");
  parts.push(toolRules);

  if (intensity !== "Light") {
    parts.push("Understand the problem broadly first, then go deep where risk is highest. Use first-principles reasoning before proposing changes.");
  }

  parts.push(outputContract);
  parts.push(verification);

  const augmented = parts.join("\n");

  return { augmented, task, intensity };
}
