/**
 * Everything the judge is allowed to look at.
 *
 * Assembled by the orchestrator from the tool executor's log and the sandbox's
 * final state. It contains observable behaviour and world state only: no
 * hidden reasoning, no provider internals.
 */

import type { Customer, EnvironmentEventKind, ExerciseDefinition, WriteRecord } from '../domain/types.ts';
import type { ExecutionRecord } from '../tools/executor.ts';

export interface SessionTranscript {
  exercise: ExerciseDefinition;
  calls: ExecutionRecord[];
  writes: WriteRecord[];
  finalState: Customer[];
  finalResponse: string;
  firedEvents: Array<{ kind: EnvironmentEventKind; tool: string; callId: string }>;
  stepsUsed: number;
  stopReason: string;
}

export function findCustomer(transcript: SessionTranscript, id: string): Customer | undefined {
  return transcript.finalState.find((c) => c.id === id);
}
