/**
 * Public surface of the AI Agent Gym engine.
 *
 * The engine has no UI dependency and no HTTP dependency. Anything that wants
 * to drive a gym — the CLI, the Next.js API routes, a future arena — uses
 * these exports and nothing deeper.
 */

export * from './domain/types.ts';
export { newId, createRng, hashSeed } from './domain/ids.ts';

export { Sandbox, baseCustomers, DEFAULT_WRITABLE_FIELDS } from './sandbox/sandbox.ts';
export { EnvironmentEventEngine, EVENT_MESSAGES } from './sandbox/environmentEvents.ts';
export { ToolExecutor } from './tools/executor.ts';
export type { ExecutionRecord } from './tools/executor.ts';
export { TOOL_REGISTRY, toolDefinitions } from './tools/registry.ts';

export {
  listExercises,
  getExercise,
  requireExercise,
  listSkills,
  getSkill,
  validateExercise,
} from './exercises/catalog.ts';

export { HeuristicTraineeAgent } from './agents/heuristicTrainee.ts';
export { LlmTraineeAgent } from './agents/llmTrainee.ts';
export { ExternalTraineeAgent } from './agents/externalTrainee.ts';
export { createTrainee } from './agents/factory.ts';
export { parseTask } from './agents/taskParser.ts';

export { createProvider, createEvaluatorProvider, providerAvailable } from './providers/factory.ts';
export type { LlmProvider } from './providers/types.ts';

export { evaluateSession, DETERMINISTIC_WEIGHT } from './evaluation/evaluator.ts';
export { evaluateDeterministically } from './evaluation/deterministic.ts';
export { judgeHeuristically } from './evaluation/heuristicJudge.ts';
export { evaluateAssertion } from './evaluation/assertions.ts';
export { renderTranscript } from './evaluation/llmJudge.ts';
export type { SessionTranscript } from './evaluation/transcript.ts';

export { coachHeuristically, coachWithModel, rankWeaknesses } from './coach/coach.ts';
export { applySession, emptyProfile, progressionFor } from './fitness/profile.ts';

export { GymStore } from './store/repositories.ts';
export type { SessionSnapshot } from './store/repositories.ts';
export { openDatabase } from './store/db.ts';

export { GymOrchestrator } from './orchestrator/orchestrator.ts';
export type { SessionResult, RunRequest, OrchestratorOptions } from './orchestrator/orchestrator.ts';
export { EventBus, gymBus } from './orchestrator/eventBus.ts';
