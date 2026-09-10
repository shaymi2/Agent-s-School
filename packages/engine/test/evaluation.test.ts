import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateAssertion } from '../src/evaluation/assertions.ts';
import { evaluateDeterministically } from '../src/evaluation/deterministic.ts';
import { judgeHeuristically } from '../src/evaluation/heuristicJudge.ts';
import { evaluateSession, DETERMINISTIC_WEIGHT } from '../src/evaluation/evaluator.ts';
import { requireExercise } from '../src/exercises/catalog.ts';
import { Sandbox } from '../src/sandbox/sandbox.ts';
import type { SessionTranscript } from '../src/evaluation/transcript.ts';
import type { Assertion, ToolResult } from '../src/domain/types.ts';
import type { ExecutionRecord } from '../src/tools/executor.ts';

function record(
  index: number,
  name: string,
  input: Record<string, unknown>,
  ok: boolean,
  extra: Partial<ToolResult> = {},
): ExecutionRecord {
  return {
    index,
    call: { id: `call_${index}`, name, input },
    result: {
      callId: `call_${index}`,
      toolName: name,
      ok,
      output: ok ? { done: true } : null,
      error: ok ? undefined : { code: 'API_503', message: 'unavailable', retryable: true },
      latencyMs: 10,
      ...extra,
    },
  };
}

function transcript(overrides: Partial<SessionTranscript> = {}): SessionTranscript {
  return {
    exercise: requireExercise('tool-003'),
    calls: [],
    writes: [],
    finalState: new Sandbox().listCustomers(),
    finalResponse: '',
    firedEvents: [],
    stepsUsed: 0,
    stopReason: 'finished',
    ...overrides,
  };
}

function assertion(kind: string, params: Record<string, unknown>): Assertion {
  return {
    id: 'a',
    kind: kind as Assertion['kind'],
    category: 'accuracy',
    description: kind,
    required: true,
    weight: 1,
    params,
  };
}

describe('deterministic assertions', () => {
  test('tool_called counts only matching calls', () => {
    const t = transcript({
      calls: [record(0, 'search_customer', { query: 'a' }, true), record(1, 'get_customer', { customer_id: 'C1' }, true)],
    });
    assert.equal(evaluateAssertion(assertion('tool_called', { tool: 'get_customer' }), t).passed, true);
    assert.equal(evaluateAssertion(assertion('tool_called', { tool: 'update_customer' }), t).passed, false);
  });

  test('tool_called with successOnly ignores failed calls', () => {
    const t = transcript({ calls: [record(0, 'get_customer', { customer_id: 'C1' }, false)] });
    assert.equal(evaluateAssertion(assertion('tool_called', { tool: 'get_customer' }), t).passed, true);
    assert.equal(
      evaluateAssertion(assertion('tool_called', { tool: 'get_customer', successOnly: true }), t).passed,
      false,
    );
  });

  test('tool_sequence requires the order, not just the presence', () => {
    const inOrder = transcript({
      calls: [
        record(0, 'search_customer', {}, true),
        record(1, 'get_customer', {}, true),
        record(2, 'update_customer', {}, true),
      ],
    });
    const outOfOrder = transcript({
      calls: [
        record(0, 'search_customer', {}, true),
        record(1, 'update_customer', {}, true),
        record(2, 'get_customer', {}, true),
      ],
    });
    const spec = assertion('tool_sequence', {
      sequence: ['search_customer', 'get_customer', 'update_customer'],
    });
    assert.equal(evaluateAssertion(spec, inOrder).passed, true);
    assert.equal(evaluateAssertion(spec, outOfOrder).passed, false);
  });

  test('record_field_equals reads the final world state, not the agent report', () => {
    const sandbox = new Sandbox();
    sandbox.update('C2051', 'phone', '+49-555-0999', 'c1');
    const t = transcript({
      finalState: sandbox.listCustomers(),
      finalResponse: 'I definitely changed it, trust me.',
    });
    assert.equal(
      evaluateAssertion(
        assertion('record_field_equals', { customer_id: 'C2051', field: 'phone', value: '+49-555-0999' }),
        t,
      ).passed,
      true,
    );
    assert.equal(
      evaluateAssertion(
        assertion('record_field_equals', { customer_id: 'C2051', field: 'email', value: 'wrong@example.com' }),
        t,
      ).passed,
      false,
    );
  });

  test('a convincing report cannot substitute for a write that never happened', () => {
    const t = transcript({
      finalResponse: 'Updated C2051 phone to +49-555-0999. The change is confirmed.',
    });
    assert.equal(
      evaluateAssertion(
        assertion('record_field_equals', { customer_id: 'C2051', field: 'phone', value: '+49-555-0999' }),
        t,
      ).passed,
      false,
    );
  });

  test('no_unauthorized_writes catches a write to the wrong record', () => {
    const sandbox = new Sandbox();
    sandbox.update('C1180', 'email', 'oops@example.com', 'c1');
    const t = transcript({ writes: sandbox.writes, finalState: sandbox.listCustomers() });
    const result = evaluateAssertion(
      assertion('no_unauthorized_writes', { allow: [{ customer_id: 'C1024', field: 'email' }] }),
      t,
    );
    assert.equal(result.passed, false);
    assert.match(result.detail, /C1180\.email/);
  });

  test('record_unchanged fails as soon as the record is touched', () => {
    const sandbox = new Sandbox();
    sandbox.update('C1180', 'notes', 'meddled', 'c1');
    const t = transcript({ writes: sandbox.writes, finalState: sandbox.listCustomers() });
    assert.equal(evaluateAssertion(assertion('record_unchanged', { customer_id: 'C1180' }), t).passed, false);
    assert.equal(evaluateAssertion(assertion('record_unchanged', { customer_id: 'C1024' }), t).passed, true);
  });

  test('recovered_from_error needs a real failure followed by a real success', () => {
    const gaveUp = transcript({ calls: [record(0, 'update_customer', {}, false)] });
    const recovered = transcript({
      calls: [record(0, 'update_customer', {}, false), record(1, 'update_customer', {}, true)],
    });
    const neverFailed = transcript({ calls: [record(0, 'update_customer', {}, true)] });
    const spec = assertion('recovered_from_error', { tool: 'update_customer' });
    assert.equal(evaluateAssertion(spec, gaveUp).passed, false);
    assert.equal(evaluateAssertion(spec, recovered).passed, true);
    assert.equal(evaluateAssertion(spec, neverFailed).passed, false);
  });

  test('response assertions are case-insensitive and report what was missing', () => {
    const t = transcript({ finalResponse: 'Customer C2051 is on the GROWTH plan.' });
    assert.equal(
      evaluateAssertion(assertion('final_response_contains', { any_of: ['c2051'] }), t).passed,
      true,
    );
    const all = evaluateAssertion(
      assertion('final_response_mentions_all', { all_of: ['growth', 'eu-central'] }),
      t,
    );
    assert.equal(all.passed, false);
    assert.match(all.detail, /eu-central/);
  });

  test('max_tool_calls and write_count enforce budgets', () => {
    const t = transcript({ calls: [record(0, 'a', {}, true), record(1, 'b', {}, true)] });
    assert.equal(evaluateAssertion(assertion('max_tool_calls', { max: 2 }), t).passed, true);
    assert.equal(evaluateAssertion(assertion('max_tool_calls', { max: 1 }), t).passed, false);
    assert.equal(evaluateAssertion(assertion('write_count', { max: 0 }), t).passed, true);
  });
});

describe('scoring', () => {
  test('a required failure fails the exercise no matter the score', () => {
    const exercise = requireExercise('tool-003');
    const t = transcript({ exercise, calls: [record(0, 'search_customer', {}, true)] });
    const result = evaluateDeterministically(t);
    assert.equal(result.success, false);
    assert.ok(result.mistakes.length > 0);
  });

  test('an optional failure lowers the score but still passes', () => {
    const exercise = requireExercise('tool-001');
    const sandbox = new Sandbox();
    const t = transcript({
      exercise,
      calls: [record(0, 'search_customer', {}, true), record(1, 'search_customer', {}, true), record(2, 'search_customer', {}, true)],
      finalResponse: 'Maya Almeida is C2051.',
      finalState: sandbox.listCustomers(),
    });
    const result = evaluateDeterministically(t);
    assert.equal(result.success, true);
    assert.equal(result.metrics.efficiency, 0, 'the efficiency assertion failed');
  });

  test('dimension scores are weight-proportional within a category', () => {
    const exercise = requireExercise('tool-007');
    const sandbox = new Sandbox();
    sandbox.update('C3410', 'plan', 'growth', 'c1');
    const t = transcript({
      exercise,
      calls: [
        record(0, 'search_customer', {}, true),
        record(1, 'update_customer', {}, false),
        record(2, 'update_customer', {}, true),
      ],
      writes: sandbox.writes,
      finalState: sandbox.listCustomers(),
      finalResponse: 'Set C3410 to growth after a 503 retry.',
    });
    const result = evaluateDeterministically(t);
    assert.equal(result.metrics.accuracy, 100);
    assert.equal(result.metrics.error_recovery, 100);
    // verification has one assertion of weight 2, and it failed
    assert.equal(result.metrics.verification, 0);
  });

  test('the composite blends facts and judgement at the documented ratio', async () => {
    const exercise = requireExercise('tool-011');
    const sandbox = new Sandbox();
    const t = transcript({
      exercise,
      calls: [record(0, 'get_customer', { customer_id: 'C4820' }, true)],
      finalState: sandbox.listCustomers(),
      finalResponse: 'C4820 is on the enterprise plan and is active.',
    });
    const evaluation = await evaluateSession('sess_test', t);
    const qualitative = judgeHeuristically(t);
    const expected = Math.round(
      100 * DETERMINISTIC_WEIGHT + (qualitative.metrics.efficiency ?? 0) * (1 - DETERMINISTIC_WEIGHT),
    );
    assert.equal(evaluation.metrics.efficiency, expected);
    assert.equal(evaluation.success, true);
  });

  test('the evaluation carries its own provenance', async () => {
    const t = transcript({ finalResponse: 'nothing happened' });
    const evaluation = await evaluateSession('sess_test', t);
    assert.equal(evaluation.qualitative.source, 'heuristic');
    assert.equal(
      evaluation.deterministic.results.length,
      t.exercise.assertions.length,
      'every assertion must be reported, passed or failed',
    );
    assert.ok(evaluation.score >= 0 && evaluation.score <= 100);
  });
});

describe('heuristic judge', () => {
  test('penalises repeated identical calls but not retries of failures', () => {
    const wasteful = transcript({
      exercise: requireExercise('tool-001'),
      calls: [
        record(0, 'search_customer', { query: 'Maya' }, true),
        record(1, 'search_customer', { query: 'Maya' }, true),
      ],
      finalResponse: 'C2051',
    });
    const retried = transcript({
      exercise: requireExercise('tool-001'),
      calls: [
        record(0, 'search_customer', { query: 'Maya' }, false),
        record(1, 'search_customer', { query: 'Maya' }, true),
      ],
      finalResponse: 'C2051',
    });
    assert.ok(
      (judgeHeuristically(wasteful).metrics.efficiency ?? 0) <
        (judgeHeuristically(retried).metrics.efficiency ?? 0),
    );
  });

  test('an agent that reports nothing scores zero on communication', () => {
    const t = transcript({ calls: [record(0, 'search_customer', {}, true)], finalResponse: '   ' });
    assert.equal(judgeHeuristically(t).metrics.communication, 0);
  });
});
