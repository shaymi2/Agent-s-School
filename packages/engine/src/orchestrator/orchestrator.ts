/**
 * The Gym Orchestrator.
 *
 * It owns the session: it builds the world, hands the trainee a tool
 * invoker, records every observable step as an event, then calls the Judge,
 * the Coach and the fitness ledger in that order.
 *
 * The trainee cannot reach the sandbox except through the invoker here, and
 * the judge cannot see anything the event stream did not record.
 */

import { createTrainee } from '../agents/factory.ts';
import { coachHeuristically, coachWithModel } from '../coach/coach.ts';
import { evaluateSession } from '../evaluation/evaluator.ts';
import { renderTranscript } from '../evaluation/llmJudge.ts';
import { requireExercise } from '../exercises/catalog.ts';
import { applySession } from '../fitness/profile.ts';
import { newId } from '../domain/ids.ts';
import { Sandbox } from '../sandbox/sandbox.ts';
import { ToolExecutor } from '../tools/executor.ts';
import { toolDefinitions } from '../tools/registry.ts';
import { GymStore } from '../store/repositories.ts';
import { EventBus, gymBus } from './eventBus.ts';
import type { SessionTranscript } from '../evaluation/transcript.ts';
import type { LlmProvider } from '../providers/types.ts';
import type {
  CoachFeedback,
  CoachGuidance,
  Evaluation,
  FitnessProfile,
  GymEvent,
  GymEventType,
  Session,
  ToolCall,
  ToolResult,
} from '../domain/types.ts';

export interface OrchestratorOptions {
  store?: GymStore;
  bus?: EventBus;
  judgeProvider?: LlmProvider | null;
  coachProvider?: LlmProvider | null;
  /** Slows the loop so a browser can watch it. Zero in tests and the CLI. */
  stepDelayMs?: number;
}

export interface SessionResult {
  session: Session;
  evaluation: Evaluation;
  feedback: CoachFeedback;
  profile: FitnessProfile;
  events: GymEvent[];
  transcript: SessionTranscript;
}

export interface RunRequest {
  agentId: string;
  exerciseId: string;
  /** Override the coaching carried forward. Rarely needed outside tests. */
  guidance?: CoachGuidance | null;
}

export class GymOrchestrator {
  readonly store: GymStore;
  readonly bus: EventBus;
  private readonly judgeProvider: LlmProvider | null;
  private readonly coachProvider: LlmProvider | null;
  private readonly stepDelayMs: number;

  constructor(options: OrchestratorOptions = {}) {
    this.store = options.store ?? new GymStore();
    this.bus = options.bus ?? gymBus;
    this.judgeProvider = options.judgeProvider ?? null;
    this.coachProvider = options.coachProvider ?? null;
    this.stepDelayMs = options.stepDelayMs ?? 0;
  }

  /** Create the session row up front so the UI can subscribe before it runs. */
  prepareSession(request: RunRequest): Session {
    const agent = this.store.getAgent(request.agentId);
    if (!agent) throw new Error(`Unknown agent "${request.agentId}"`);
    const exercise = requireExercise(request.exerciseId);

    const carried =
      request.guidance !== undefined
        ? request.guidance
        : (this.store.getLatestGuidance(agent.id, exercise.skill)?.guidance ?? null);

    const session: Session = {
      id: newId('sess'),
      agentId: agent.id,
      exerciseId: exercise.id,
      skill: exercise.skill,
      attempt: this.store.countAttempts(agent.id, exercise.id) + 1,
      status: 'pending',
      startedAt: Date.now(),
      guidance: carried,
    };
    return this.store.createSession(session);
  }

  async run(request: RunRequest): Promise<SessionResult> {
    return this.runPrepared(this.prepareSession(request));
  }

  async runPrepared(session: Session): Promise<SessionResult> {
    const agent = this.store.getAgent(session.agentId)!;
    const exercise = requireExercise(session.exerciseId);
    const events: GymEvent[] = [];
    let seq = 0;

    const emit = (type: GymEventType, label: string, payload: Record<string, unknown> = {}): void => {
      const event: GymEvent = {
        id: newId('evt'),
        sessionId: session.id,
        agentId: session.agentId,
        exerciseId: session.exerciseId,
        seq: seq++,
        type,
        at: Date.now(),
        label,
        payload,
      };
      events.push(event);
      this.store.appendEvent(event);
      this.bus.publish(event);
      observe(event);
    };

    session.status = 'running';
    this.store.updateSession(session);

    emit('SESSION_STARTED', `${agent.name} entered the ${exercise.skill.replace('_', ' ')} gym`, {
      agent: { id: agent.id, name: agent.name, provider: agent.provider, model: agent.model },
      attempt: session.attempt,
      guidance: session.guidance,
    });
    emit('EXERCISE_STARTED', `Workout: ${exercise.title} (level ${exercise.difficulty})`, {
      exerciseId: exercise.id,
      title: exercise.title,
      difficulty: exercise.difficulty,
      tools: exercise.availableTools,
      optimalToolCalls: exercise.optimalToolCalls,
    });
    emit('TASK_RECEIVED', 'Task received', { task: exercise.task });

    const sandbox = new Sandbox(exercise.environment);
    const executor = new ToolExecutor(sandbox, exercise.availableTools, exercise.environment.events ?? []);
    const tools = toolDefinitions(exercise.availableTools);

    const invoke = async (call: ToolCall): Promise<ToolResult> => {
      emit('TOOL_CALL_STARTED', `Calling ${call.name}`, { call });
      if (this.stepDelayMs > 0) await sleep(this.stepDelayMs);
      const result = executor.execute(call);
      if (result.environmentEvent) {
        emit('ENVIRONMENT_EVENT', `Environment: ${result.environmentEvent}`, {
          kind: result.environmentEvent,
          tool: call.name,
          callId: call.id,
        });
      }
      if (result.ok) {
        emit('TOOL_CALL_COMPLETED', `${call.name} returned`, { call, result });
      } else {
        emit('TOOL_ERROR', `${call.name} failed: ${result.error?.code}`, { call, result });
      }
      return result;
    };

    let finalResponse = '';
    let stopReason = 'finished';
    let stepsUsed = 0;

    try {
      const trainee = createTrainee(agent);
      const outcome = await trainee.run(
        {
          sessionId: session.id,
          agent,
          exercise,
          tools,
          guidance: session.guidance,
          attempt: session.attempt,
          maxSteps: agent.maxSteps,
        },
        invoke,
      );
      finalResponse = outcome.finalResponse;
      stopReason = outcome.stopReason;
      stepsUsed = outcome.stepsUsed;
      if (outcome.providerError) {
        session.error = outcome.providerError;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      session.status = 'failed';
      session.error = message;
      session.finishedAt = Date.now();
      this.store.updateSession(session);
      emit('SESSION_FAILED', `Session could not run: ${message}`, { error: message });
      throw error;
    }

    emit('AGENT_RESPONSE', 'Agent reported back', { response: finalResponse });
    emit('EXERCISE_COMPLETED', 'Workout finished', { stepsUsed, stopReason });

    const transcript: SessionTranscript = {
      exercise,
      calls: executor.log,
      writes: sandbox.writes,
      finalState: sandbox.listCustomers(),
      finalResponse,
      firedEvents: executor.firedEvents,
      stepsUsed,
      stopReason,
    };

    session.status = 'evaluating';
    session.finalResponse = finalResponse;
    this.store.updateSession(session);

    emit('EVALUATION_STARTED', 'Judge is scoring the session', {
      assertions: exercise.assertions.length,
    });
    const evaluation = await evaluateSession(session.id, transcript, {
      judgeProvider: this.judgeProvider,
    });
    this.store.saveEvaluation(evaluation);
    emit('EVALUATION_COMPLETED', `Score ${evaluation.score}/100 — ${evaluation.success ? 'PASS' : 'FAIL'}`, {
      score: evaluation.score,
      success: evaluation.success,
      metrics: evaluation.metrics,
      mistakes: evaluation.mistakes,
      strengths: evaluation.strengths,
      source: evaluation.qualitative.source,
    });

    const profileBefore = this.store.getProfile(session.agentId, session.skill);
    const coachInput = {
      sessionId: session.id,
      agentId: session.agentId,
      exercise,
      evaluation,
      profile: profileBefore,
      activeGuidance: session.guidance,
      toolCallCount: executor.log.length,
    };

    let feedback: CoachFeedback;
    if (this.coachProvider) {
      try {
        feedback = await coachWithModel(this.coachProvider, coachInput, renderTranscript(transcript));
      } catch {
        feedback = coachHeuristically(coachInput);
      }
    } else {
      feedback = coachHeuristically(coachInput);
    }
    this.store.saveFeedback(feedback);
    emit('COACH_FEEDBACK', feedback.headline, {
      headline: feedback.headline,
      message: feedback.message,
      weaknesses: feedback.weaknesses,
      strengths: feedback.strengths,
      drills: feedback.drills,
      guidance: feedback.guidance,
      source: feedback.source,
    });

    session.status = 'completed';
    session.score = evaluation.score;
    session.success = evaluation.success;
    session.finishedAt = Date.now();
    this.store.updateSession(session);

    const profile = applySession(profileBefore, session, evaluation, feedback);
    this.store.saveProfile(profile);
    emit('SCORE_UPDATED', `Fitness updated: overall ${profile.overall}`, {
      overall: profile.overall,
      dimensions: profile.dimensions,
      bestScore: profile.bestScore,
      attempts: profile.attempts,
      successRate: profile.successRate,
    });

    this.store.saveSnapshot(session.id, {
      exerciseId: exercise.id,
      agent,
      calls: executor.log,
      writes: sandbox.writes,
      finalState: transcript.finalState,
      firedEvents: executor.firedEvents,
      finalResponse,
      stopReason,
    });

    emit('SESSION_COMPLETED', `Session complete: ${evaluation.score}/100`, {
      score: evaluation.score,
      success: evaluation.success,
      attempt: session.attempt,
    });

    return { session, evaluation, feedback, profile, events, transcript };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Structured observability. One line per event, no payload contents beyond
 * ids and metrics, so a failed training session can be reconstructed from
 * logs without leaking the sandbox record contents into them.
 */
function observe(event: GymEvent): void {
  if (process.env.GYM_LOG !== '1') return;
  const payload = event.payload as Record<string, unknown>;
  const call = payload.call as { name?: string } | undefined;
  const result = payload.result as { latencyMs?: number; ok?: boolean } | undefined;
  process.stderr.write(
    `${JSON.stringify({
      at: new Date(event.at).toISOString(),
      session_id: event.sessionId,
      agent_id: event.agentId,
      exercise_id: event.exerciseId,
      seq: event.seq,
      event_type: event.type,
      tool_name: call?.name,
      tool_ok: result?.ok,
      latency_ms: result?.latencyMs,
      score: payload.score,
    })}\n`,
  );
}
