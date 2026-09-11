/**
 * Server-side gym singleton.
 *
 * One store, one orchestrator, one event bus for the whole process, cached on
 * globalThis so a dev-server hot reload does not open a second SQLite handle
 * or orphan a running session's subscribers.
 */

import {
  ExternalTraineeAgent,
  GymOrchestrator,
  GymStore,
  createEvaluatorProvider,
  gymBus,
  listExercises,
  listSkills,
  providerAvailable,
} from '@gym/engine';
import type { AgentConfig, Session } from '@gym/engine';

interface GymRuntime {
  store: GymStore;
  orchestrator: GymOrchestrator;
  /** Sessions currently executing, so a double start is a no-op. */
  running: Map<string, Promise<unknown>>;
  /** Live handles for sessions driven by an outside caller. */
  external: Map<string, ExternalTraineeAgent>;
}

const globalRef = globalThis as unknown as { __agentGym?: GymRuntime };

export function gym(): GymRuntime {
  if (!globalRef.__agentGym) {
    const store = new GymStore();
    const orchestrator = new GymOrchestrator({
      store,
      bus: gymBus,
      judgeProvider: createEvaluatorProvider('judge'),
      coachProvider: createEvaluatorProvider('coach'),
      // A human is watching this one, so the loop is paced to be readable.
      stepDelayMs: Number(process.env.GYM_STEP_DELAY_MS ?? 500),
    });
    globalRef.__agentGym = { store, orchestrator, running: new Map(), external: new Map() };
    bootstrapAgents(store);
  }
  return globalRef.__agentGym;
}

/** Every gym needs at least one athlete on the floor. */
function bootstrapAgents(store: GymStore): void {
  const existing = store.listAgents();
  if (!existing.some((a) => a.provider === 'heuristic')) {
    store.createAgent({
      name: 'DataBot',
      provider: 'heuristic',
      model: 'reflex-v1',
      maxSteps: 12,
    });
  }
  if (providerAvailable('anthropic') && !existing.some((a) => a.provider === 'anthropic')) {
    store.createAgent({
      name: 'Claude Trainee',
      provider: 'anthropic',
      model: process.env.GYM_TRAINEE_MODEL ?? 'claude-opus-5',
      maxSteps: 12,
    });
  }
}

/**
 * How many sessions may execute at once.
 *
 * A session can call a paid model, and the API has no authentication, so the
 * number of runs in flight is bounded. Without this one unattended caller can
 * spend the operator's credits as fast as the server accepts connections.
 */
export const MAX_CONCURRENT_SESSIONS = Number(process.env.GYM_MAX_CONCURRENT_SESSIONS ?? 4);

/**
 * Start a prepared session in the background and let its events stream.
 *
 * An `external` agent gets a handle the API routes can push tool calls into;
 * every other provider drives itself.
 */
export function startSession(session: Session, provider: string): void {
  const runtime = gym();
  if (runtime.running.has(session.id)) return;
  if (runtime.running.size >= MAX_CONCURRENT_SESSIONS) {
    throw new Error(
      `Too many sessions are already running (limit ${MAX_CONCURRENT_SESSIONS}). Wait for one to finish.`,
    );
  }

  let trainee: ExternalTraineeAgent | undefined;
  if (provider === 'external') {
    trainee = new ExternalTraineeAgent();
    runtime.external.set(session.id, trainee);
  }

  const task = runtime.orchestrator
    .runPrepared(session, trainee)
    .catch((error: unknown) => {
      console.error(`[gym] session ${session.id} failed`, error);
    })
    .finally(() => {
      runtime.running.delete(session.id);
      runtime.external.delete(session.id);
    });
  runtime.running.set(session.id, task);
}

/** The live handle for an externally driven session, if it is still open. */
export function externalTrainee(sessionId: string): ExternalTraineeAgent | undefined {
  return gym().external.get(sessionId);
}

/** Resolves once the session has finished evaluating and coaching. */
export async function awaitSession(sessionId: string): Promise<void> {
  await gym().running.get(sessionId);
}

export function isRunning(sessionId: string): boolean {
  return gym().running.has(sessionId);
}

export function agentsWithAvailability(): Array<AgentConfig & { available: boolean }> {
  return gym()
    .store.listAgents()
    .map((agent) => ({ ...agent, available: providerAvailable(agent.provider) }));
}

export { listExercises, listSkills, providerAvailable };
