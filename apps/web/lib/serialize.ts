/**
 * Engine objects to wire objects.
 *
 * One place that knows both shapes, so a change to the domain model does not
 * ripple into every route handler and every component.
 */

import { getExercise, listExercises, listSkills } from '@gym/engine';
import type {
  CoachFeedback,
  Evaluation,
  ExerciseDefinition,
  FitnessProfile,
  GymEvent,
  Session,
} from '@gym/engine';
import type {
  WireCoachFeedback,
  WireEvaluation,
  WireEvent,
  WireExercise,
  WireFitness,
  WireSession,
  WireSkill,
} from './dto.ts';

export function toWireEvent(event: GymEvent): WireEvent {
  return {
    id: event.id,
    sessionId: event.sessionId,
    agentId: event.agentId,
    exerciseId: event.exerciseId,
    seq: event.seq,
    type: event.type,
    at: event.at,
    label: event.label,
    payload: event.payload,
  };
}

export function toWireSkills(): WireSkill[] {
  const all = listExercises();
  return listSkills().map((skill) => ({
    ...skill,
    exerciseCount: all.filter((e) => e.skill === skill.id).length,
  }));
}

export function toWireExercise(exercise: ExerciseDefinition): WireExercise {
  return {
    id: exercise.id,
    skill: exercise.skill,
    difficulty: exercise.difficulty,
    title: exercise.title,
    task: exercise.task,
    intent: exercise.intent,
    availableTools: exercise.availableTools,
    optimalToolCalls: exercise.optimalToolCalls,
    tags: exercise.tags,
    evaluation: exercise.evaluation as Record<string, number>,
  };
}

export function toWireSession(session: Session, agentName: string): WireSession {
  return {
    id: session.id,
    agentId: session.agentId,
    agentName,
    exerciseId: session.exerciseId,
    exerciseTitle: getExercise(session.exerciseId)?.title ?? session.exerciseId,
    skill: session.skill,
    attempt: session.attempt,
    status: session.status,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    score: session.score,
    success: session.success,
    finalResponse: session.finalResponse,
    guidanceRules: session.guidance?.rules ?? [],
    error: session.error,
  };
}

export function toWireEvaluation(evaluation: Evaluation): WireEvaluation {
  return {
    success: evaluation.success,
    score: evaluation.score,
    metrics: evaluation.metrics as Record<string, number>,
    mistakes: evaluation.mistakes,
    strengths: evaluation.strengths,
    deterministic: {
      passed: evaluation.deterministic.passed,
      failed: evaluation.deterministic.failed,
      results: evaluation.deterministic.results.map((r) => ({
        id: r.id,
        category: r.category,
        description: r.description,
        required: r.required,
        passed: r.passed,
        detail: r.detail,
      })),
    },
    qualitative: {
      source: evaluation.qualitative.source,
      model: evaluation.qualitative.model,
      notes: evaluation.qualitative.notes,
    },
  };
}

export function toWireFeedback(feedback: CoachFeedback): WireCoachFeedback {
  return {
    headline: feedback.headline,
    message: feedback.message,
    strengths: feedback.strengths,
    weaknesses: feedback.weaknesses,
    drills: feedback.drills,
    guidance: {
      focusDimensions: feedback.guidance.focusDimensions,
      rules: feedback.guidance.rules,
      maxToolCalls: feedback.guidance.maxToolCalls,
    },
    source: feedback.source,
  };
}

export function toWireFitness(
  agentId: string,
  agentName: string,
  profiles: FitnessProfile[],
): WireFitness {
  const skills = profiles.map((profile) => ({
    skill: profile.skill,
    overall: profile.overall,
    attempts: profile.attempts,
    successes: profile.successes,
    successRate: profile.successRate,
    bestScore: profile.bestScore,
    dimensions: profile.dimensions as WireFitness['skills'][number]['dimensions'],
    weaknesses: profile.weaknesses,
    recommended: profile.recommended,
    history: profile.history,
  }));

  const trained = new Set(skills.map((s) => s.skill));
  return {
    agentId,
    agentName,
    overall:
      skills.length === 0
        ? 0
        : Math.round(skills.reduce((sum, s) => sum + s.overall, 0) / skills.length),
    skills,
    untrained: listSkills()
      .map((s) => s.id)
      .filter((id) => !trained.has(id)),
  };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export function fail(message: string, status = 400): Response {
  return json({ error: message }, status);
}
