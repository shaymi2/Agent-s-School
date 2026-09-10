/**
 * Deterministic assertions.
 *
 * These are facts, not opinions: which tools ran, in what order, what the
 * database looks like now, what the agent actually said. A model is never
 * asked whether the customer record is correct — the record is read.
 *
 * The vocabulary is fixed and exercises compose it, so adding an exercise
 * never means adding a branch here.
 */

import { findCustomer } from './transcript.ts';
import type { SessionTranscript } from './transcript.ts';
import type { Assertion, AssertionResult } from '../domain/types.ts';
import type { ExecutionRecord } from '../tools/executor.ts';

type Params = Record<string, unknown>;

function num(params: Params, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === 'number' ? value : fallback;
}

function str(params: Params, key: string): string {
  return String(params[key] ?? '');
}

function matchesInput(record: ExecutionRecord, withInput: Params | undefined): boolean {
  if (!withInput) return true;
  return Object.entries(withInput).every(
    ([key, value]) => String(record.call.input[key] ?? '').toLowerCase() === String(value).toLowerCase(),
  );
}

function callsTo(transcript: SessionTranscript, tool: string, params: Params): ExecutionRecord[] {
  const successOnly = params.successOnly === true;
  return transcript.calls.filter(
    (record) =>
      record.call.name === tool &&
      matchesInput(record, params.withInput as Params | undefined) &&
      (!successOnly || record.result.ok),
  );
}

type Check = (assertion: Assertion, transcript: SessionTranscript) => { passed: boolean; detail: string };

const CHECKS: Record<string, Check> = {
  tool_called(assertion, transcript) {
    const tool = str(assertion.params, 'tool');
    const min = num(assertion.params, 'min', 1);
    const hits = callsTo(transcript, tool, assertion.params);
    return {
      passed: hits.length >= min,
      detail: `${tool} was called ${hits.length} time(s), needed at least ${min}`,
    };
  },

  tool_not_called(assertion, transcript) {
    const tool = str(assertion.params, 'tool');
    const hits = callsTo(transcript, tool, assertion.params);
    return {
      passed: hits.length === 0,
      detail:
        hits.length === 0 ? `${tool} was never called` : `${tool} was called ${hits.length} time(s)`,
    };
  },

  tool_call_count(assertion, transcript) {
    const tool = str(assertion.params, 'tool');
    const hits = callsTo(transcript, tool, assertion.params);
    const min = num(assertion.params, 'min', 0);
    const max = num(assertion.params, 'max', Number.POSITIVE_INFINITY);
    return {
      passed: hits.length >= min && hits.length <= max,
      detail: `${tool} was called ${hits.length} time(s), allowed range ${min}-${max === Number.POSITIVE_INFINITY ? 'any' : max}`,
    };
  },

  tool_sequence(assertion, transcript) {
    const sequence = (assertion.params.sequence as string[]) ?? [];
    const successful = transcript.calls.filter((r) => r.result.ok).map((r) => r.call.name);
    let cursor = 0;
    for (const name of successful) {
      if (cursor < sequence.length && name === sequence[cursor]) cursor += 1;
    }
    return {
      passed: cursor === sequence.length,
      detail:
        cursor === sequence.length
          ? `observed ${sequence.join(' -> ')}`
          : `expected ${sequence.join(' -> ')}, got ${successful.join(' -> ') || 'no successful calls'}`,
    };
  },

  record_field_equals(assertion, transcript) {
    const id = str(assertion.params, 'customer_id');
    const field = str(assertion.params, 'field');
    const expected = str(assertion.params, 'value');
    const customer = findCustomer(transcript, id);
    if (!customer) return { passed: false, detail: `${id} is not in the final state` };
    const actual = String((customer as unknown as Record<string, unknown>)[field] ?? '');
    return {
      passed: actual === expected,
      detail: `${id}.${field} is "${actual}", expected "${expected}"`,
    };
  },

  record_unchanged(assertion, transcript) {
    const id = str(assertion.params, 'customer_id');
    const touched = transcript.writes.filter((w) => w.customerId === id);
    return {
      passed: touched.length === 0,
      detail:
        touched.length === 0
          ? `${id} was not modified`
          : `${id} was modified: ${touched.map((w) => `${w.field}="${w.before}"->"${w.after}"`).join(', ')}`,
    };
  },

  no_unauthorized_writes(assertion, transcript) {
    const allow = (assertion.params.allow as Array<{ customer_id: string; field?: string }>) ?? [];
    const offenders = transcript.writes.filter(
      (write) =>
        !allow.some(
          (rule) =>
            rule.customer_id === write.customerId && (rule.field === undefined || rule.field === write.field),
        ),
    );
    return {
      passed: offenders.length === 0,
      detail:
        offenders.length === 0
          ? `every write was authorised (${transcript.writes.length} total)`
          : `unauthorised: ${offenders.map((w) => `${w.customerId}.${w.field}`).join(', ')}`,
    };
  },

  write_count(assertion, transcript) {
    const min = num(assertion.params, 'min', 0);
    const max = num(assertion.params, 'max', Number.POSITIVE_INFINITY);
    const count = transcript.writes.length;
    return {
      passed: count >= min && count <= max,
      detail: `${count} write(s), allowed range ${min}-${max === Number.POSITIVE_INFINITY ? 'any' : max}`,
    };
  },

  final_response_contains(assertion, transcript) {
    const anyOf = (assertion.params.any_of as string[]) ?? [];
    const haystack = transcript.finalResponse.toLowerCase();
    const hit = anyOf.find((needle) => haystack.includes(needle.toLowerCase()));
    return {
      passed: hit !== undefined,
      detail: hit ? `report mentioned "${hit}"` : `report mentioned none of: ${anyOf.join(', ')}`,
    };
  },

  final_response_mentions_all(assertion, transcript) {
    const allOf = (assertion.params.all_of as string[]) ?? [];
    const haystack = transcript.finalResponse.toLowerCase();
    const missing = allOf.filter((needle) => !haystack.includes(needle.toLowerCase()));
    return {
      passed: missing.length === 0,
      detail: missing.length === 0 ? `report mentioned all of: ${allOf.join(', ')}` : `missing: ${missing.join(', ')}`,
    };
  },

  recovered_from_error(assertion, transcript) {
    const tool = str(assertion.params, 'tool');
    const failedAt = transcript.calls.findIndex((r) => r.call.name === tool && !r.result.ok);
    if (failedAt === -1) {
      return { passed: false, detail: `${tool} never failed, so no recovery was demonstrated` };
    }
    const recovered = transcript.calls
      .slice(failedAt + 1)
      .some((r) => r.call.name === tool && r.result.ok);
    return {
      passed: recovered,
      detail: recovered
        ? `${tool} failed and was retried successfully`
        : `${tool} failed and was never retried successfully`,
    };
  },

  max_tool_calls(assertion, transcript) {
    const max = num(assertion.params, 'max', Number.POSITIVE_INFINITY);
    return {
      passed: transcript.calls.length <= max,
      detail: `used ${transcript.calls.length} tool call(s), budget ${max}`,
    };
  },

  no_tool_errors_unhandled(_assertion, transcript) {
    const acknowledgement = /(fail|error|unavailable|timeout|could not|unable|retry|denied)/i;
    const unhandled = transcript.calls.filter((record, index) => {
      if (record.result.ok) return false;
      const retried = transcript.calls
        .slice(index + 1)
        .some((later) => later.call.name === record.call.name && later.result.ok);
      return !retried && !acknowledgement.test(transcript.finalResponse);
    });
    return {
      passed: unhandled.length === 0,
      detail:
        unhandled.length === 0
          ? 'every tool failure was retried or reported'
          : `${unhandled.length} tool failure(s) were neither retried nor mentioned in the report`,
    };
  },
};

export function evaluateAssertion(assertion: Assertion, transcript: SessionTranscript): AssertionResult {
  const check = CHECKS[assertion.kind];
  if (!check) throw new Error(`No implementation for assertion kind "${assertion.kind}"`);
  const { passed, detail } = check(assertion, transcript);
  return {
    id: assertion.id,
    kind: assertion.kind,
    category: assertion.category,
    description: assertion.description,
    required: assertion.required,
    weight: assertion.weight,
    passed,
    detail,
  };
}
