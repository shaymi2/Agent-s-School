import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { ExternalTraineeAgent } from '../src/agents/externalTrainee.ts';
import { GymOrchestrator } from '../src/orchestrator/orchestrator.ts';
import { GymStore } from '../src/store/repositories.ts';
import { EventBus } from '../src/orchestrator/eventBus.ts';
import type { AgentConfig } from '../src/domain/types.ts';

let store: GymStore;
let orchestrator: GymOrchestrator;
let agent: AgentConfig;

beforeEach(() => {
  store = new GymStore(':memory:');
  orchestrator = new GymOrchestrator({ store, bus: new EventBus() });
  agent = store.createAgent({ name: 'BringYourOwn', provider: 'external', model: 'external', maxSteps: 4 });
});

afterEach(() => store.close());

describe('externally driven sessions', () => {
  test('an outside caller can drive a session and is judged identically', async () => {
    const trainee = new ExternalTraineeAgent();
    const session = orchestrator.prepareSession({ agentId: agent.id, exerciseId: 'tool-003' });
    const run = orchestrator.runPrepared(session, trainee);

    // The orchestrator hands the trainee its invoker before anything else.
    while (!trainee.ready) await new Promise((r) => setImmediate(r));

    const search = await trainee.submit('search_customer', { query: 'Maya Almeida' });
    assert.equal(search.ok, true);
    const record = await trainee.submit('get_customer', { customer_id: 'C2051' });
    assert.equal(record.ok, true);
    const write = await trainee.submit('update_customer', {
      customer_id: 'C2051',
      field: 'phone',
      value: '+49-555-0999',
    });
    assert.equal(write.ok, true);

    trainee.finish('Verified C2051 first, then set the phone to +49-555-0999.');
    const result = await run;

    assert.equal(result.evaluation.success, true);
    assert.equal(result.transcript.calls.length, 3);
    assert.equal(result.session.status, 'completed');
  });

  test('the tool budget is enforced on external callers too', async () => {
    const trainee = new ExternalTraineeAgent();
    const session = orchestrator.prepareSession({ agentId: agent.id, exerciseId: 'tool-001' });
    const run = orchestrator.runPrepared(session, trainee);
    while (!trainee.ready) await new Promise((r) => setImmediate(r));

    for (let i = 0; i < 4; i += 1) {
      await trainee.submit('search_customer', { query: 'Maya' });
    }
    assert.equal(trainee.remainingSteps, 0);
    await assert.rejects(() => trainee.submit('search_customer', { query: 'Maya' }), /budget exhausted/);

    trainee.finish('Maya Almeida is C2051.');
    const result = await run;
    assert.equal(result.transcript.calls.length, 4);
  });

  test('a session cannot be driven after it is finished', async () => {
    const trainee = new ExternalTraineeAgent();
    const session = orchestrator.prepareSession({ agentId: agent.id, exerciseId: 'tool-001' });
    const run = orchestrator.runPrepared(session, trainee);
    while (!trainee.ready) await new Promise((r) => setImmediate(r));

    trainee.finish('Nothing to report.');
    await run;
    await assert.rejects(() => trainee.submit('search_customer', { query: 'Maya' }), /already been finished/);
  });
});
