/**
 * The fitness profile: what the gym remembers about an athlete.
 *
 * Dimensions are tracked separately and never collapsed away. "Overall" is a
 * view over them, computed on demand, and the dimensions stay visible next to
 * it so a single number can never hide a specific weakness.
 */

import type {
  CoachFeedback,
  DimensionId,
  DimensionStat,
  Evaluation,
  FitnessProfile,
  Session,
} from '../domain/types.ts';

/** Weight of the newest sample when updating a dimension. */
export const LEARNING_RATE = 0.4;

/** A dimension below this is called out as a weakness. */
export const WEAKNESS_THRESHOLD = 85;

export function emptyProfile(agentId: string, skill: string): FitnessProfile {
  return {
    agentId,
    skill,
    overall: 0,
    dimensions: {},
    attempts: 0,
    successes: 0,
    successRate: 0,
    bestScore: 0,
    history: [],
    weaknesses: [],
    recommended: [],
    updatedAt: Date.now(),
  };
}

export function applySession(
  previous: FitnessProfile | null,
  session: Session,
  evaluation: Evaluation,
  feedback: CoachFeedback | null,
): FitnessProfile {
  const profile = previous
    ? { ...previous, dimensions: { ...previous.dimensions }, history: [...previous.history] }
    : emptyProfile(session.agentId, session.skill);

  for (const [key, value] of Object.entries(evaluation.metrics) as Array<[DimensionId, number]>) {
    const existing = profile.dimensions[key];
    const next: DimensionStat = existing
      ? {
          current: Math.round(existing.current * (1 - LEARNING_RATE) + value * LEARNING_RATE),
          best: Math.max(existing.best, value),
          samples: existing.samples + 1,
          trend: value - existing.current,
        }
      : { current: value, best: value, samples: 1, trend: 0 };
    profile.dimensions[key] = next;
  }

  profile.attempts += 1;
  if (evaluation.success) profile.successes += 1;
  profile.successRate = Math.round((profile.successes / profile.attempts) * 100);
  profile.bestScore = Math.max(profile.bestScore, evaluation.score);
  profile.history.push({
    sessionId: session.id,
    exerciseId: session.exerciseId,
    score: evaluation.score,
    success: evaluation.success,
    at: session.finishedAt ?? Date.now(),
  });

  const measured = Object.values(profile.dimensions);
  profile.overall =
    measured.length === 0
      ? 0
      : Math.round(measured.reduce((sum, stat) => sum + stat.current, 0) / measured.length);

  // Only genuinely weak dimensions count. A profile where everything is
  // strong should report no weaknesses rather than the two least strong.
  profile.weaknesses = (Object.entries(profile.dimensions) as Array<[DimensionId, DimensionStat]>)
    .filter(([, stat]) => stat.current < WEAKNESS_THRESHOLD)
    .sort((a, b) => a[1].current - b[1].current)
    .slice(0, 2)
    .map(([dimension]) => dimension);

  if (feedback) profile.recommended = feedback.drills;
  profile.updatedAt = Date.now();
  return profile;
}

/** Score-over-time for one exercise, which is what "improvement" actually means. */
export function progressionFor(profile: FitnessProfile, exerciseId: string): number[] {
  return profile.history.filter((entry) => entry.exerciseId === exerciseId).map((entry) => entry.score);
}
