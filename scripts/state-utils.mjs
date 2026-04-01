/**
 * oh-my-beads state utilities — shared state management for all scripts.
 *
 * Hybrid state model:
 *   Runtime state → system-level: ~/.oh-my-beads/projects/{hash}/
 *   Project artifacts → project-level: {cwd}/.oh-my-beads/
 *
 * State layout (system-level):
 *   ~/.oh-my-beads/projects/{hash}/session.json
 *   ~/.oh-my-beads/projects/{hash}/sessions/{sessionId}/session.json
 *   ~/.oh-my-beads/projects/{hash}/sessions/{sessionId}/tool-tracking.json
 *   ~/.oh-my-beads/projects/{hash}/sessions/{sessionId}/subagent-tracking.json
 *   ~/.oh-my-beads/projects/{hash}/handoffs/
 *
 * Legacy fallback (read-only):
 *   {cwd}/.oh-my-beads/state/session.json (read-only for migration)
 *
 * NOTE: StateManager class and createStateManager() factory were removed
 * as dead code. All scripts use resolveStateDir + shared helpers directly.
 */
