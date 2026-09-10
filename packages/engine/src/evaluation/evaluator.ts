/**
 * The composite judge: facts first, opinion second.
 *
 *   deterministic assertions (facts about the world)
 *            +
 *   qualitative judgement (model, or measured proxies when there is no model)
 *            v
 *   one Evaluation with a stable schema
 *
 * Where a dimension has both, the facts carry three quarters of the weight.
 * A dimension with no evidence at all is left out of the score rather than
 * being filled in with a guess.
 */

import { evaluateDeterministically } from './deterministic.ts';
import { judgeHeuristically } from './heuristicJudge.ts';
import { judgeWithModel } from './llmJudge.ts';
import type { SessionTranscript } from './transcript.ts';
import type { LlmProvider } from '../providers/types.ts';
import type { DimensionId, DimensionScores, Evaluation } from '../domain/types.ts';

/** How much of a dimension's score comes from deterministic evidence. */
export const DETERMINISTIC_WEIGHT = 0.75;

export interface EvaluateOptions {
  judgeProvider?: LlmProvider | null;
}

export async function evaluateSession(
  sessionId: string,
  transcript: SessionTranscript,
  options: EvaluateOptions = {},
): Promise<Evaluation> {
  const deterministic = evaluateDeterministically(transcript);

  let qualitativeMetrics: DimensionScores;
  let notes: string[];
  let extraStrengths: string[] = [];
  let source: 'llm' | 'heuristic' = 'heuristic';
  let model: string | undefined;

  const fallback = judgeHeuristically(transcript);
  if (options.judgeProvider) {
    try {
      const llm = await judgeWithModel(options.judgeProvider, transcript, deterministic);
      qualitativeMetrics = { ...fallback.metrics, ...llm.metrics };
      notes = llm.notes;
      extraStrengths = llm.strengths;
      source = 'llm';
      model = llm.model;
    } catch (error) {
      qualitativeMetrics = fallback.metrics;
      notes = [
        ...fallback.notes,
        `The model judge was unavailable, so measured proxies were used instead (${error instanceof Error ? error.message : String(error)}).`,
      ];
    }
  } else {
    qualitativeMetrics = fallback.metrics;
    notes = fallback.notes;
  }

  const weights = transcript.exercise.evaluation;
  const metrics: DimensionScores = {};
  let weighted = 0;
  let weightUsed = 0;

  for (const [dimension, weight] of Object.entries(weights) as Array<[DimensionId, number]>) {
    const det = deterministic.metrics[dimension];
    const qual = qualitativeMetrics[dimension];
    let value: number | undefined;
    if (det !== undefined && qual !== undefined) {
      value = Math.round(det * DETERMINISTIC_WEIGHT + qual * (1 - DETERMINISTIC_WEIGHT));
    } else if (det !== undefined) {
      value = det;
    } else if (qual !== undefined) {
      value = qual;
    }
    if (value === undefined) continue;
    metrics[dimension] = value;
    weighted += value * weight;
    weightUsed += weight;
  }

  // Dimensions the judge measured that the exercise does not score are still
  // reported, so a fitness profile can accumulate them over time.
  for (const [dimension, value] of Object.entries(qualitativeMetrics) as Array<[DimensionId, number]>) {
    if (metrics[dimension] === undefined) metrics[dimension] = value;
  }

  const score = weightUsed === 0 ? 0 : Math.round(weighted / weightUsed);

  return {
    sessionId,
    success: deterministic.success,
    score,
    metrics,
    mistakes: [...deterministic.mistakes, ...notes],
    strengths: [...new Set([...deterministic.strengths, ...extraStrengths])],
    deterministic: {
      passed: deterministic.passed,
      failed: deterministic.failed,
      results: deterministic.results,
    },
    qualitative: { source, model, metrics: qualitativeMetrics, notes },
    createdAt: Date.now(),
  };
}
