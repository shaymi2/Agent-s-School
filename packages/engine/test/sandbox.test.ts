import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Sandbox, baseCustomers } from '../src/sandbox/sandbox.ts';

describe('sandbox: the fake enterprise data store', () => {
  test('the shipped dataset is fictional and self-consistent', () => {
    const customers = baseCustomers();
    assert.ok(customers.length >= 10);
    const ids = new Set(customers.map((c) => c.id));
    assert.equal(ids.size, customers.length, 'customer ids must be unique');
    for (const customer of customers) {
      assert.match(customer.email, /@(example\.com|[\w-]+\.example)$/, `${customer.id} must use a reserved domain`);
    }
  });

  test('search finds a customer by name, case-insensitively', () => {
    const sandbox = new Sandbox();
    const result = sandbox.search('maya almeida');
    assert.ok(result.ok);
    assert.equal(result.value.count, 1);
    assert.equal(result.value.results[0].id, 'C2051');
  });

  test('search returns every duplicate rather than guessing', () => {
    const sandbox = new Sandbox();
    const result = sandbox.search('David Cohen');
    assert.ok(result.ok);
    assert.equal(result.value.count, 2);
    assert.deepEqual(
      result.value.results.map((r) => r.id).sort(),
      ['C1024', 'C1180'],
    );
  });

  test('search rejects an empty query instead of returning everything', () => {
    const sandbox = new Sandbox();
    const result = sandbox.search('   ');
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.error.code, 'INVALID_PARAMETER');
  });

  test('get returns MISSING_RECORD for a customer that does not exist', () => {
    const sandbox = new Sandbox();
    const result = sandbox.get('C9999');
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.error.code, 'MISSING_RECORD');
  });

  test('an exercise can remove a customer from the world', () => {
    const sandbox = new Sandbox({ removeCustomers: ['C2051'] });
    assert.equal(sandbox.get('C2051').ok, false);
    const search = sandbox.search('Maya Almeida');
    assert.ok(search.ok);
    assert.equal(search.value.count, 0);
  });

  test('update writes the field and records an audit entry', () => {
    const sandbox = new Sandbox();
    const result = sandbox.update('C2051', 'phone', '+49-555-0999', 'call_1');
    assert.ok(result.ok);
    assert.equal(result.value.customer.phone, '+49-555-0999');
    assert.equal(sandbox.writes.length, 1);
    assert.deepEqual(
      { id: sandbox.writes[0].customerId, field: sandbox.writes[0].field, after: sandbox.writes[0].after },
      { id: 'C2051', field: 'phone', after: '+49-555-0999' },
    );
  });

  test('update refuses a field outside the write surface', () => {
    const sandbox = new Sandbox();
    const result = sandbox.update('C4501', 'accountOwner', 'Robin Mercer', 'call_1');
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.error.code, 'PERMISSION_DENIED');
    assert.equal(sandbox.writes.length, 0, 'a denied write must leave no audit entry');
  });

  test('update refuses a record the exercise locked', () => {
    const sandbox = new Sandbox({ permissions: { denyUpdatesTo: ['C2318'] } });
    const result = sandbox.update('C2318', 'status', 'active', 'call_1');
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.error.code, 'PERMISSION_DENIED');
    const after = sandbox.get('C2318');
    assert.ok(after.ok);
    assert.equal(after.value.customer.status, 'suspended');
  });

  test('update validates the value it is given', () => {
    const sandbox = new Sandbox();
    assert.equal(sandbox.update('C2051', 'email', 'not-an-email', 'c1').ok, false);
    assert.equal(sandbox.update('C2051', 'status', 'enthusiastic', 'c2').ok, false);
    assert.equal(sandbox.writes.length, 0);
  });

  test('the same seed produces the same world and the same latencies', () => {
    const a = new Sandbox({ seed: 42 });
    const b = new Sandbox({ seed: 42 });
    assert.deepEqual(a.listCustomers(), b.listCustomers());
    assert.deepEqual(
      [a.nextLatency(10, 90), a.nextLatency(10, 90)],
      [b.nextLatency(10, 90), b.nextLatency(10, 90)],
    );
  });

  test('an exercise can add a customer and patch another', () => {
    const sandbox = new Sandbox({
      addCustomers: [
        {
          id: 'C7777',
          name: 'Test Twin',
          email: 'twin@example.com',
          phone: '+1-555-0000',
          status: 'active',
          plan: 'starter',
          region: 'us-east',
          accountOwner: 'Nobody',
          createdAt: '2025-01-01',
          notes: '',
        },
      ],
      patchCustomers: [{ id: 'C2051', patch: { status: 'inactive' } }],
    });
    assert.ok(sandbox.get('C7777').ok);
    const patched = sandbox.get('C2051');
    assert.ok(patched.ok);
    assert.equal(patched.value.customer.status, 'inactive');
  });
});
