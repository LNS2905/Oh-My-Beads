---
name: prompt-leverage
description: >-
  Automatically strengthens raw user prompts into execution-ready instruction sets.
  Runs transparently on every keyword-triggered invocation (both Mr.Beads and Mr.Fast).
  Detects task type (coding/research/writing/review/planning/analysis), infers effort
  intensity (Light/Standard/Deep), and injects structured framework blocks: Objective,
  Context, Work Style, Tool Rules, Output Contract, Verification, Done Criteria.
  Can also be invoked manually for standalone prompt improvement.
level: 2
---

<Purpose>
Turn raw user prompts into stronger working prompts without changing the underlying intent.
Preserve the task, fill in missing execution structure, and add only enough scaffolding to
improve reliability. Runs automatically on every oh-my-beads keyword detection.
</Purpose>

<Use_When>
- Automatically on every Mr.Beads/Mr.Fast invocation (built into keyword-detector)
- Manually when the user wants to improve an existing prompt
- When building reusable prompt templates
</Use_When>

<Do_Not_Use_When>
- The user has already provided a fully structured prompt with all framework blocks
- The prompt is a one-word command or trivial request
</Do_Not_Use_When>

<Why_This_Exists>
Raw prompts often lack execution structure — missing verification criteria, vague output
expectations, no tool rules. Prompt-leverage adds just enough scaffolding to guide agents
toward correct, useful results instead of merely plausible ones. The key insight from
research: prompts that include explicit verification steps and done criteria produce
measurably better outputs.
</Why_This_Exists>

<Execution_Policy>
- Preserve the user's objective, constraints, and tone
- Prefer adding missing structure over rewriting everything
- Keep prompts proportional — don't over-specify simple tasks
- Mr.Fast mode caps intensity at Standard (speed over thoroughness)
</Execution_Policy>

<Steps>
1. **Task Detection**
   Classify the prompt by scanning for keywords:
   | Task Type | Trigger Words |
   |-----------|--------------|
   | coding | code, bug, fix, implement, api, endpoint, refactor, test |
   | research | research, compare, find, investigate, sources |
   | writing | write, draft, email, memo, document, readme |
   | review | review, audit, critique, evaluate, assess |
   | planning | plan, roadmap, strategy, design, architect |
   | analysis | analyze, explain, diagnose, root cause, debug |

2. **Intensity Inference**
   | Level | Trigger |
   |-------|---------|
   | Deep | "careful", "thorough", "production", "critical", "security" |
   | Standard | coding, research, review, analysis tasks (default) |
   | Light | writing, planning, simple tasks |

   Mr.Fast mode: caps at Standard (never Deep).

3. **Framework Block Injection**
   Add structured blocks selectively:
   - **Objective** — task + success definition
   - **Context** — preserve intent, surface assumptions
   - **Work Style** — task type, intensity, first-principles reasoning
   - **Tool Rules** — task-specific tool guidance
   - **Output Contract** — expected result format
   - **Verification** — task-specific correctness checks
   - **Done Criteria** — when to stop

4. **Output**
   Returns both the original prompt and the augmented version with metadata:
   `[Task: coding | Intensity: Standard]`
</Steps>

<Tool_Usage>
- This skill has NO tool requirements — it operates on text only
- Implementation: `scripts/prompt-leverage.mjs` (zero-dependency ESM module)
- Integration point: `scripts/keyword-detector.mjs` imports and applies it automatically
</Tool_Usage>

<Examples>
<Good>
Input: "fix the login validation bug"
Output task: coding, intensity: Standard
Augmented adds: file inspection rules, lint/test verification, regression check criteria
Why good: Original intent preserved, useful structure added for coding work
</Good>

<Good>
Input: "mr.fast analyze why the API returns 500 errors"
Output task: analysis, intensity: Standard (capped from Deep by mr.fast)
Augmented adds: systematic tracing guidance, root cause verification, evidence requirements
Why good: Analysis task correctly detected, intensity right-sized for fast mode
</Good>

<Bad>
Input: "fix typo in README"
If prompt-leverage adds Deep intensity + 6 framework blocks:
Why bad: Over-specified. A simple fix needs Light intensity with minimal scaffolding.
</Bad>
</Examples>

<Advanced>
## Framework Reference

The framework blocks follow the synthesis from `references/framework.md`:

```
Goal → Context → Work Style → Tool Rules → Output Contract → Verification → Done
```

### Intensity Levels

- **Light**: simple edits, formatting, quick rewrites — minimal scaffolding
- **Standard**: typical coding, research, drafting — balanced structure
- **Deep**: debugging, architecture, security, high-stakes — full verification loop

### Task-Specific Tool Rules

| Task | Tool Guidance |
|------|--------------|
| coding | Inspect files/deps first, validate narrowly before broadening |
| research | Retrieve evidence from reliable sources, don't guess checkable facts |
| review | Read context for intent before critiquing, distinguish confirmed vs plausible |
| analysis | Trace systematically, read actual code/data before hypothesizing |
| planning | Explore existing structure before proposing new architecture |

### Integration Architecture

```
User prompt → keyword-detector.mjs
                  ↓
              prompt-leverage.mjs (upgradePrompt)
                  ↓
              Augmented prompt + metadata → additionalContext
                  ↓
              Skill invocation (mr-fast or using-oh-my-beads)
                  ↓
              Agent receives both original + augmented prompt
```

The augmented prompt is advisory — agents use it to guide their execution style but
the original user request remains the source of truth for what to build.
</Advanced>
