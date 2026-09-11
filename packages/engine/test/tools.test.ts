import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Sandbox } from '../src/sandbox/sandbox.ts';
import { ToolExecutor } from '../src/tools/executor.ts';
import { toolDefinitions } from '../src/tools/registry.ts';
import type { EnvironmentEventRule, ToolCall } from '../src/domain/types.ts';

const ALL_TOOLS = ['search_customer', 'get_customer', 'update_customer'];

function call(name: string, input: Record<string, unknown>, id = 'call_1'): ToolCall {
  return { id, name, input };
}

function makeExecutor(rules: EnvironmentEventRule[] = [], tools = ALL_TOOLS, spec = {}) {
  const sandbox = new Sandbox(spec);
  return { sandbox, executor: new ToolExecutor(sandbox, tools, rules) };
}

describe('tool executor', () => {
  test('exposes exactly the three tools with usable schemas', () => {
    const definitions = toolDefinitions(ALL_TOOLS);
    assert.equal(definitions.length, 3);
    for (const definition of definitions) {
      assert.ok(definition.description.length > 20, `${definition.name} needs a real description`);
      assert.ok(definition.inputSchema.required.length > 0);
    }
    assert.equal(definitions.find((d) => d.name === 'update_customer')?.mutates, true);
    assert.equal(definitions.find((d) => d.name === 'search_customer')?.mutates, false);
  });

  test('runs a successful call and logs it', () => {
    const { executor } = makeExecutor();
    const result = executor.execute(call('search_customer', { query: 'Maya' }));
    assert.equal(result.ok, true);
    assert.equal(executor.log.length, 1);
    assert.equal(executor.log[0].call.name, 'search_customer');
  });

  test('refuses a tool the exercise did not make available', () => {
    const { executor } = makeExecutor([], ['search_customer']);
    const result = executor.execute(call('update_customer', { customer_id: 'C2051', field: 'plan', value: 'growth' }));
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, 'TOOL_NOT_AVAILABLE');
  });

  test('rejects a call missing a required parameter before it reaches the sandbox', () => {
    const { sandbox, executor } = makeExecutor();
    const result = executor.execute(call('update_customer', { customer_id: 'C2051', field: 'plan' }));
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, 'INVALID_PARAMETER');
    assert.equal(sandbox.writes.length, 0);
  });

  test('every tool invocation is logged, successful or not', () => {
    const { executor } = makeExecutor();
    executor.execute(call('get_customer', { customer_id: 'C2051' }, 'a'));
    executor.execute(call('get_customer', { customer_id: 'C9999' }, 'b'));
    assert.equal(executor.log.length, 2);
    assert.deepEqual(executor.log.map((r) => r.result.ok), [true, false]);
  });
});

describe('environment events', () => {
  test('an error event fires exactly the configured number of times', () => {
    const { executor } = makeExecutor([
      { trigger: 'search_customer', response: 'API_503', occurrences: 2 },
    ]);
    const first = executor.execute(call('search_customer', { query: 'Maya' }, 'a'));
    const second = executor.execute(call('search_customer', { query: 'Maya' }, 'b'));
    const third = executor.execute(call('search_customer', { query: 'Maya' }, 'c'));
    assert.equal(first.ok, false);
    assert.equal(first.error?.code, 'API_503');
    assert.equal(first.error?.retryable, true);
    assert.equal(second.ok, false);
    assert.equal(third.ok, true, 'the third call is past the configured occurrences');
  });

  test('skipFirst lets an exercise fail the second call rather than the first', () => {
    const { executor } = makeExecutor([
      { trigger: 'get_customer', response: 'API_TIMEOUT', occurrences: 1, skipFirst: 1 },
    ]);
    assert.equal(executor.execute(call('get_customer', { customer_id: 'C2051' }, 'a')).ok, true);
    assert.equal(executor.execute(call('get_customer', { customer_id: 'C2051' }, 'b')).ok, false);
  });

  test('a "when" clause targets one specific input', () => {
    const { executor } = makeExecutor([
      {
        trigger: 'get_customer',
        response: 'MISSING_RECORD',
        occurrences: 1,
        when: { customer_id: 'C1180' },
      },
    ]);
    assert.equal(executor.execute(call('get_customer', { customer_id: 'C1024' }, 'a')).ok, true);
    assert.equal(executor.execute(call('get_customer', { customer_id: 'C1180' }, 'b')).ok, false);
  });

  test('a denied write never reaches the data store', () => {
    const { sandbox, executor } = makeExecutor([
      { trigger: 'update_customer', response: 'PERMISSION_DENIED', occurrences: 1 },
    ]);
    const before = sandbox.get('C2051');
    executor.execute(call('update_customer', { customer_id: 'C2051', field: 'plan', value: 'starter' }));
    assert.equal(sandbox.writes.length, 0);
    assert.deepEqual(sandbox.get('C2051'), before);
  });

  test('INCOMPLETE_RESPONSE succeeds but strips fields from the payload', () => {
    const { executor } = makeExecutor([
      { trigger: 'search_customer', response: 'INCOMPLETE_RESPONSE', occurrences: 1 },
    ]);
    const result = executor.execute(call('search_customer', { query: 'Tomas' }));
    assert.equal(result.ok, true);
    assert.equal(result.output?.truncated, true);
    const first = (result.output?.results as Array<Record<string, unknown>>)[0];
    assert.equal(first.email, undefined, 'the partial payload must not carry an email');
    assert.ok(first.id);
  });

  test('CONFLICTING_DATA serves the stale index value while get_customer stays authoritative', () => {
    const { executor } = makeExecutor(
      [{ trigger: 'search_customer', response: 'CONFLICTING_DATA', occurrences: 1 }],
      ALL_TOOLS,
      { conflictingIndex: [{ id: 'C3092', field: 'email', value: 'stale@old-domain.example' }] },
    );
    const search = executor.execute(call('search_customer', { query: 'Priya' }, 'a'));
    const record = executor.execute(call('get_customer', { customer_id: 'C3092' }, 'b'));
    const summary = (search.output?.results as Array<Record<string, unknown>>)[0];
    assert.equal(summary.email, 'stale@old-domain.example');
    assert.equal((record.output?.customer as Record<string, unknown>).email, 'priya.r@example.com');
  });

  test('fired events are recorded for the timeline', () => {
    const { executor } = makeExecutor([
      { trigger: 'search_customer', response: 'API_TIMEOUT', occurrences: 1 },
    ]);
    executor.execute(call('search_customer', { query: 'Maya' }));
    assert.deepEqual(executor.firedEvents.map((e) => e.kind), ['API_TIMEOUT']);
  });
});
