# Prompt Leverage Framework

Use this reference for the structured blocks that compose an execution-ready prompt.

## Source Synthesis

- Agent Flywheel contributes behavior controls: intensity, wider search, deeper analysis,
  fresh eyes, first-principles thinking, and future-self clarity.
- OpenAI prompt guidance contributes execution controls: clear objectives, explicit output
  contracts, tool persistence, dependency checks, verification loops, and completion criteria.

## Block Definitions

### Objective
State the task in one or two lines. Define success in observable terms.

### Context
Specify relevant files, URLs, constraints, assumptions, and information boundaries.
Say when the agent must retrieve facts instead of guessing.

### Work Style
Control how the agent approaches the task:
- Go broad first when system understanding matters
- Go deep where risk or complexity is highest
- Use first-principles reasoning before changing things
- Re-check with fresh eyes for non-trivial tasks

### Tool Rules
Define when browsing, file inspection, tests, or external tools are required.
Prevent skipping prerequisite checks.

### Output Contract
Define exact structure, tone, formatting, depth, and any required sections.

### Verification
Require checks for correctness, grounding, completeness, side effects, and alternatives.

### Done Criteria
Define what must be true before the agent stops.

## Intensity Levels

| Level | Use For | Scaffolding |
|-------|---------|-------------|
| Light | Simple edits, formatting, quick rewrites | Objective + Output + Done |
| Standard | Typical coding, research, drafting | All blocks, standard verification |
| Deep | Debugging, architecture, security, high-stakes | All blocks, full verification loop |

## Upgrade Rubric

An upgraded prompt is good when it:
1. Preserves original intent
2. Reduces ambiguity
3. Sets the right depth and care level
4. Defines the expected output clearly
5. Includes appropriate verification for the task
6. Tells the agent when to stop
