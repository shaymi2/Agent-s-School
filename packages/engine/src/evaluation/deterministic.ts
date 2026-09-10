/**
 * The deterministic half of the judge.
 *
 * Runs every assertion an exercise declares and turns the results into
 * per-dimension scores. Success is not a judgement call: an exercise is passed
 * when every assertion marked `required` passes, and failed otherwise.
 */

import { evaluateAssertion } from './assertions.ts';
import type { SessionTranscript } from './transcript.ts';
import type { AssertionResult, DimensionId, DimensionScores } from '../domain/types.ts';

export interface DeterministicEvaluation {
  success: boolean;
  results: AssertionResult[];
  passed: number;
  failed: number;
  /** Only dimensions the exercise actually asserted on appear here. */
  metrics: DimensionScores;
  mistakes: string[];
  strengths: string[];
}

export function evaluateDeterministically(transcript: SessionTranscript): DeterministicEvaluation {
  const results = transcript.exercise.assertions.map((assertion) =>
    evaluateAssertion(assertion, transcript),
  );

  const byDimension = new Map<DimensionId, { earned: number; total: number }>();
  for (const result of results) {
    const bucket = byDimension.get(result.category) ?? { earned: 0, total: 0 };
    bucket.total += result.weight;
    if (result.passed) bucket.earned += result.weight;
    byDimension.set(result.category, bucket);
  }

  const metrics: DimensionScores = {};
  for (const [dimension, bucket] of byDimension) {
    metrics[dimension] = bucket.total === 0 ? 100 : Math.round((bucket.earned / bucket.total) * 100);
  }

  const failures = results.filter((r) => !r.passed);
  const successes = results.filter((r) => r.passed);

  return {
    success: results.every((r) => r.passed || !r.required),
    results,
    passed: successes.length,
    failed: failures.length,
    metrics,
    mistakes: failures.map((r) => `${r.description} (${r.detail})`),
    strengths: successes.filter((r) => r.weight >= 2).map((r) => r.description),
  };
}
