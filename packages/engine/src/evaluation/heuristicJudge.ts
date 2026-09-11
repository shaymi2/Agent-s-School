/**
 * The qualitative half of the judge, without a model.
 *
 * These are measurements of process rather than outcome: how much of the work
 * was wasted, whether failures were answered, whether the report actually says
 * anything. They are proxies and are labelled as such in the evaluation, but
 * they are computed from the transcript, not invented.
 */

import type { SessionTranscript } from './transcript.ts';
import type { DimensionScores } from '../domain/types.ts';

export interface QualitativeEvaluation {
  metrics: DimensionScores;
  notes: string[];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function judgeHeuristically(transcript: SessionTranscript): QualitativeEvaluation {
  const notes: string[] = [];
  const metrics: DimensionScores = {};
  const calls = transcript.calls;
  const optimal = Math.max(1, transcript.exercise.optimalToolCalls);

  /* efficiency: distance from the optimal path, minus repeated identical calls */
  if (calls.length === 0) {
    metrics.efficiency = 0;
    notes.push('No tools were used at all.');
  } else {
    // Repeating a call that already succeeded is waste. Repeating one that
    // failed is a retry, which is exactly what error recovery looks like.
    const succeededBefore = new Map<string, boolean>();
    let wasteful = 0;
    for (const call of calls) {
      const signature = `${call.call.name}:${JSON.stringify(call.call.input)}`;
      if (succeededBefore.get(signature) === true) wasteful += 1;
      succeededBefore.set(signature, call.result.ok);
    }
    metrics.efficiency = clamp((optimal / calls.length) * 100 - wasteful * 15);
    if (calls.length > optimal) {
      notes.push(`Used ${calls.length} tool calls where ${optimal} were sufficient.`);
    }
    if (wasteful > 0) {
      notes.push(`${wasteful} tool call(s) repeated work that had already succeeded.`);
    }
  }

  /* tool_selection: share of calls that were valid and productive */
  const rejected = calls.filter(
    (r) => r.result.error?.code === 'TOOL_NOT_AVAILABLE' || r.result.error?.code === 'INVALID_PARAMETER',
  ).length;
  if (calls.length > 0) {
    metrics.tool_selection = clamp(((calls.length - rejected) / calls.length) * 100);
    if (rejected > 0) notes.push(`${rejected} call(s) were malformed or used an unavailable tool.`);
  }

  /* error_recovery: only meaningful when something actually broke */
  const failures = calls.filter((r) => !r.result.ok);
  if (failures.length > 0) {
    const answered = failures.filter((failure, index) =>
      calls.slice(index + 1).some((later) => later.call.name === failure.call.name && later.result.ok),
    ).length;
    const acknowledged = /(fail|error|unavailable|timeout|could not|unable|denied|permission)/i.test(
      transcript.finalResponse,
    );
    metrics.error_recovery = clamp((answered / failures.length) * 100 * 0.8 + (acknowledged ? 20 : 0));
    if (answered < failures.length && !acknowledged) {
      notes.push('A tool failure was neither retried nor mentioned in the final report.');
    }
  }

  /* communication: does the report carry concrete, checkable content */
  const response = transcript.finalResponse.trim();
  if (response.length === 0) {
    metrics.communication = 0;
    notes.push('The agent finished without reporting anything.');
  } else {
    const concrete = (response.match(/\bC\d{3,6}\b|@|\+\d|\b\d{4}-\d{2}-\d{2}\b/g) ?? []).length;
    const tooLong = response.length > 1500;
    metrics.communication = clamp(45 + Math.min(concrete, 4) * 14 - (tooLong ? 20 : 0));
    if (concrete === 0) notes.push('The report contains no concrete identifiers or values.');
    if (tooLong) notes.push('The report is long enough to bury its own conclusion.');
  }

  if (transcript.stopReason === 'max_steps') {
    notes.push('The agent ran out of its tool-call budget before finishing.');
  }

  return { metrics, notes };
}
