import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { GymOrchestrator } from '../src/orchestrator/orchestrator.ts';
import { GymStore } from '../src/store/repositories.ts';
import { EventBus } from '../src/orchestrator/eventBus.ts';
import { progressionFor } from '../src/fitness/profile.ts';
import type { AgentConfig, GymEvent } from '../src/domain/types.ts';

let store: GymStore;
let orchestrator: GymOrchestrator;
let agent: AgentConfig;

beforeEach(() => {
  store = new GymStore(':memory:');
  orchestrator = new GymOrchestrator({ store, bus: new EventBus() });
  agent = store.createAgent({ name: 'TestBot', provider: 'heuristic', model: 'reflex-v1', maxSteps: 12 });
});

afterEach(() => {
  store.close();
});

describe('end to end: exercise -> agent -> tool -> sandbox -> evaluation -> score', () => {
  test('a complete session runs the whole loop and produces a score', async () => {
    const result = await orchestrator.run({ agentId: agent.id, exerciseId: 'tool-001' });

    assert.equal(result.session.status, 'completed');
    assert.ok(result.transcript.calls.length > 0, 'the agent actually called a tool');
    assert.equal(result.transcript.calls[0].call.name, 'search_customer');
    assert.equal(result.transcript.calls[0].result.ok, true);
    assert.match(result.session.finalResponse ?? '', /C2051/);
    assert.equal(result.evaluation.success, true);
    assert.ok(result.evaluation.score > 0 && result.evaluation.score <= 100);
    assert.ok(result.feedback.message.length > 0);
    assert.equal(result.profile.attempts, 1);
  });

  test('the session emits the documented event sequence, in order', async () => {
    const result = await orchestrator.run({ agentId: agent.id, exerciseId: 'tool-003' });
    const types = result.events.map((e) => e.type);

    for (const expected of [
      'SESSION_STARTED',
      'EXERCISE_STARTED',
      'TASK_RECEIVED',
      'TOOL_CALL_STARTED',
      'TOOL_CALL_COMPLETED',
      'AGENT_RESPONSE',
      'EXERCISE_COMPLETED',
      'EVALUATION_STARTED',
      'EVALUATION_COMPLETED',
      'COACH_FEEDBACK',
      'SCORE_UPDATED',
      'SESSION_COMPLETED',
    ]) {
      assert.ok(types.includes(expected as never), `missing ${expected}`);
    }
    assert.equal(types[0], 'SESSION_STARTED');
    assert.equal(types.at(-1), 'SESSION_COMPLETED');
    assert.ok(
      types.indexOf('EVALUATION_COMPLETED') < types.indexOf('COACH_FEEDBACK'),
      'the coach must see the verdict before it speaks',
    );
    assert.deepEqual(
      result.events.map((e) => e.seq),
      result.events.map((_, index) => index),
      'sequence numbers must be gapless so a replay cannot silently skip a step',
    );
  });

  test('no event ever carries chain of thought', async () => {
    const result = await orchestrator.run({ agentId: agent.id, exerciseId: 'tool-004' });
    for (const event of result.events) {
      const serialised = JSON.stringify(event.payload);
      assert.doesNotMatch(serialised, /"thinking"|"reasoning"|<thinking>/i, `${event.type} leaked reasoning`);
    }
  });

  test('subscribers receive events live while the session runs', async () => {
    const bus = new EventBus();
    const live: GymEvent[] = [];
    const unsubscribe = bus.subscribe('*', (event) => live.push(event));
    const watched = new GymOrchestrator({ store, bus });

    const result = await watched.run({ agentId: agent.id, exerciseId: 'tool-002' });
    unsubscribe();

    assert.deepEqual(live.map((e) => e.id), result.events.map((e) => e.id));
  });

  test('an environment failure reaches the agent as a tool error', async () => {
    const result = await orchestrator.run({ agentId: agent.id, exerciseId: 'tool-006' });
    const injected = result.events.filter((e) => e.type === 'ENVIRONMENT_EVENT');
    assert.equal(injected.length, 1);
    assert.equal(injected[0].payload.kind, 'API_TIMEOUT');
    const errors = result.events.filter((e) => e.type === 'TOOL_ERROR');
    assert.equal(errors.length, 1);
  });

  test('a destructive instruction against a locked record changes nothing', async () => {
    const result = await orchestrator.run({ agentId: agent.id, exerciseId: 'tool-010' });
    assert.equal(result.transcript.writes.length, 0, 'the sandbox must be untouched');
    const suspended = result.transcript.finalState.find((c) => c.id === 'C2318');
    assert.equal(suspended?.status, 'suspended');
  });
});

describe('retry and improvement', () => {
  test('a retry carries the coach guidance from the previous attempt', async () => {
    const first = await orchestrator.run({ agentId: agent.id, exerciseId: 'tool-003' });
    assert.equal(first.session.guidance, null, 'the first attempt is uncoached');

    const second = await orchestrator.run({ agentId: agent.id, exerciseId: 'tool-003' });
    assert.equal(second.session.attempt, 2);
    assert.notEqual(second.session.guidance, null);
    assert.deepEqual(second.session.guidance?.rules, first.feedback.guidance.rules);
  });

  test('coaching measurably improves the next attempt', async () => {
    const first = await orchestrator.run({ agentId: agent.id, exerciseId: 'tool-003' });
    const second = await orchestrator.run({ agentId: agent.id, exerciseId: 'tool-003' });

    assert.equal(first.evaluation.success, false, 'the untrained run skips verification');
    assert.equal(second.evaluation.success, true, 'the coached run verifies first');
    assert.ok(
      second.evaluation.score > first.evaluation.score,
      `expected improvement, got ${first.evaluation.score} then ${second.evaluation.score}`,
    );
    assert.deepEqual(
      second.transcript.calls.map((c) => c.call.name),
      ['search_customer', 'get_customer', 'update_customer'],
    );
  });

  test('improvement is visible in the fitness profile over three attempts', async () => {
    const scores: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const result = await orchestrator.run({ agentId: agent.id, exerciseId: 'tool-007' });
      scores.push(result.evaluation.score);
    }
    const profile = store.getProfile(agent.id, 'tool_usage')!;
    assert.deepEqual(progressionFor(profile, 'tool-007'), scores);
    assert.ok(scores[2] > scores[0], `expected a rising trend, got ${scores.join(' -> ')}`);
    assert.equal(profile.attempts, 3);
    assert.equal(profile.bestScore, Math.max(...scores));
  });

  test('guidance can be reset so a baseline can be re-measured', async () => {
    await orchestrator.run({ agentId: agent.id, exerciseId: 'tool-003' });
    const uncoached = await orchestrator.run({ agentId: agent.id, exerciseId: 'tool-003', guidance: null });
    assert.equal(uncoached.session.guidance, null);
    assert.equal(uncoached.evaluation.success, false);
  });
});

describe('persistence and replay', () => {
  test('everything the session produced survives a store round trip', async () => {
    const result = await orchestrator.run({ agentId: agent.id, exerciseId: 'tool-004' });

    const session = store.getSession(result.session.id);
    assert.equal(session?.score, result.evaluation.score);
    assert.equal(session?.success, result.evaluation.success);

    const events = store.listEvents(result.session.id);
    assert.deepEqual(events.map((e) => e.type), result.events.map((e) => e.type));

    assert.equal(store.getEvaluation(result.session.id)?.score, result.evaluation.score);
    assert.equal(store.getFeedback(result.session.id)?.headline, result.feedback.headline);
    assert.equal(store.getProfile(agent.id, 'tool_usage')?.attempts, 1);
  });

  test('a snapshot can reconstruct the session without re-running the agent', async () => {
    const result = await orchestrator.run({ agentId: agent.id, exerciseId: 'tool-007' });
    const snapshot = store.getSnapshot(result.session.id)!;

    assert.equal(snapshot.exerciseId, 'tool-007');
    assert.equal((snapshot.agent as AgentConfig).id, agent.id);
    assert.equal((snapshot.calls as unknown[]).length, result.transcript.calls.length);
    assert.equal(snapshot.finalResponse, result.session.finalResponse);
    assert.equal((snapshot.finalState as unknown[]).length, result.transcript.finalState.length);
    assert.deepEqual(snapshot.firedEvents, result.transcript.firedEvents);
  });

  test('events can be replayed incrementally from any point', async () => {
    const result = await orchestrator.run({ agentId: agent.id, exerciseId: 'tool-001' });
    const tail = store.listEvents(result.session.id, 2);
    assert.equal(tail.length, result.events.length - 3);
    assert.equal(tail[0].seq, 3);
  });

  test('attempt numbers keep counting across separate runs', async () => {
    await orchestrator.run({ agentId: agent.id, exerciseId: 'tool-001' });
    await orchestrator.run({ agentId: agent.id, exerciseId: 'tool-001' });
    assert.equal(store.countAttempts(agent.id, 'tool-001'), 2);
    assert.equal(store.listSessions({ agentId: agent.id }).length, 2);
  });

  test('an unknown agent or exercise fails loudly', async () => {
    await assert.rejects(
      () => orchestrator.run({ agentId: 'agent_nope', exerciseId: 'tool-001' }),
      /Unknown agent/,
    );
    await assert.rejects(
      () => orchestrator.run({ agentId: agent.id, exerciseId: 'tool-999' }),
      /Unknown exercise/,
    );
  });
});
