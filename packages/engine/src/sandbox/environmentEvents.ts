/**
 * Controlled failure injection.
 *
 * Real enterprise APIs time out, rate limit, return half a payload and
 * disagree with each other. An exercise declares which of those an agent will
 * meet and how often; this engine fires them in a fixed, replayable order.
 */

import type { EnvironmentEventKind, EnvironmentEventRule, ToolCall } from '../domain/types.ts';

/** Events that replace the tool result with a failure. */
const ERROR_EVENTS: EnvironmentEventKind[] = [
  'API_TIMEOUT',
  'API_503',
  'INVALID_PARAMETER',
  'MISSING_RECORD',
  'PERMISSION_DENIED',
  'DUPLICATE_RECORD',
];

/** Events that keep the call successful but degrade what comes back. */
const MUTATION_EVENTS: EnvironmentEventKind[] = ['INCOMPLETE_RESPONSE', 'CONFLICTING_DATA'];

export function isErrorEvent(kind: EnvironmentEventKind): boolean {
  return ERROR_EVENTS.includes(kind);
}

export function isMutationEvent(kind: EnvironmentEventKind): boolean {
  return MUTATION_EVENTS.includes(kind);
}

export const EVENT_MESSAGES: Record<EnvironmentEventKind, { message: string; retryable: boolean }> = {
  API_TIMEOUT: { message: 'upstream request timed out after 30000ms', retryable: true },
  API_503: { message: 'service unavailable (503), the upstream is briefly overloaded', retryable: true },
  INVALID_PARAMETER: { message: 'the upstream rejected one of the supplied parameters', retryable: false },
  MISSING_RECORD: { message: 'the requested record could not be located', retryable: false },
  PERMISSION_DENIED: { message: 'the caller is not permitted to perform this operation', retryable: false },
  DUPLICATE_RECORD: {
    message: 'the request matched more than one record and was refused as ambiguous',
    retryable: false,
  },
  INCOMPLETE_RESPONSE: { message: 'the upstream returned a partial payload', retryable: false },
  CONFLICTING_DATA: { message: 'the index disagrees with the system of record', retryable: false },
};

interface RuleState {
  rule: EnvironmentEventRule;
  matched: number;
  fired: number;
}

export class EnvironmentEventEngine {
  private readonly states: RuleState[];
  /** Every event that actually fired, in order. */
  readonly fired: Array<{ kind: EnvironmentEventKind; tool: string; callId: string }> = [];

  constructor(rules: EnvironmentEventRule[] = []) {
    this.states = rules.map((rule) => ({ rule, matched: 0, fired: 0 }));
  }

  /**
   * Decide whether this call is hit by an event. Called exactly once per tool
   * call, so the counters advance in lockstep with the transcript.
   */
  consume(call: ToolCall): EnvironmentEventRule | null {
    for (const state of this.states) {
      if (state.rule.trigger !== call.name) continue;
      if (!matchesWhen(state.rule.when, call.input)) continue;
      state.matched += 1;
      if (state.matched <= (state.rule.skipFirst ?? 0)) continue;
      if (state.fired >= state.rule.occurrences) continue;
      state.fired += 1;
      this.fired.push({ kind: state.rule.response, tool: call.name, callId: call.id });
      return state.rule;
    }
    return null;
  }
}

function matchesWhen(when: Record<string, string> | undefined, input: Record<string, unknown>): boolean {
  if (!when) return true;
  return Object.entries(when).every(
    ([key, value]) => String(input[key] ?? '').toLowerCase() === value.toLowerCase(),
  );
}
