/**
 * The fake enterprise data store.
 *
 * Nothing in here reaches the network, the filesystem or any real system. The
 * dataset is fictional and lives entirely in memory for the life of a session,
 * so a trainee can delete, corrupt or spam it without consequence.
 *
 * Determinism is a hard requirement: given the same EnvironmentSpec and the
 * same sequence of calls, a Sandbox always produces the same results.
 */

import raw from '../../data/customers.json' with { type: 'json' };
import { createRng } from '../domain/ids.ts';
import type { Customer, EnvironmentSpec, WriteRecord } from '../domain/types.ts';

const BASE_CUSTOMERS = raw.customers as Customer[];

/** Fields a tool is ever allowed to write, before per-exercise narrowing. */
export const DEFAULT_WRITABLE_FIELDS = ['email', 'phone', 'status', 'plan', 'notes'];

const VALID_STATUS = ['active', 'inactive', 'suspended'];

export interface SandboxError {
  code: string;
  message: string;
  retryable: boolean;
}

export type SandboxOutcome<T> = { ok: true; value: T } | { ok: false; error: SandboxError };

export interface CustomerSummary {
  id: string;
  name: string;
  email: string;
  status: string;
}

function fail(code: string, message: string, retryable = false): SandboxOutcome<never> {
  return { ok: false, error: { code, message, retryable } };
}

export function baseCustomers(): Customer[] {
  return BASE_CUSTOMERS.map((c) => ({ ...c }));
}

export class Sandbox {
  readonly spec: EnvironmentSpec;
  private readonly customers: Map<string, Customer>;
  private readonly conflicting: Map<string, Partial<Customer>>;
  private readonly writableFields: string[];
  private readonly deniedCustomers: string[];
  private readonly rng: () => number;
  readonly writes: WriteRecord[] = [];

  constructor(spec: EnvironmentSpec = {}) {
    this.spec = spec;
    this.rng = createRng(spec.seed ?? 1337);
    this.customers = new Map();

    for (const customer of baseCustomers()) {
      this.customers.set(customer.id, customer);
    }
    for (const id of spec.removeCustomers ?? []) {
      this.customers.delete(id);
    }
    for (const { id, patch } of spec.patchCustomers ?? []) {
      const existing = this.customers.get(id);
      if (existing) this.customers.set(id, { ...existing, ...patch });
    }
    for (const extra of spec.addCustomers ?? []) {
      this.customers.set(extra.id, { ...extra });
    }

    this.conflicting = new Map();
    for (const entry of spec.conflictingIndex ?? []) {
      const current = this.conflicting.get(entry.id) ?? {};
      this.conflicting.set(entry.id, { ...current, [entry.field]: entry.value });
    }

    this.writableFields = spec.permissions?.writableFields ?? DEFAULT_WRITABLE_FIELDS;
    this.deniedCustomers = spec.permissions?.denyUpdatesTo ?? [];
  }

  /** Deterministic pseudo-latency so replays look alive without being random. */
  nextLatency(min: number, max: number): number {
    return Math.round(min + this.rng() * (max - min));
  }

  listCustomers(): Customer[] {
    return [...this.customers.values()].map((c) => ({ ...c }));
  }

  /** The stale/disagreeing view of a record, used by conflicting-data exercises. */
  conflictingView(id: string): Partial<Customer> | undefined {
    const patch = this.conflicting.get(id);
    return patch ? { ...patch } : undefined;
  }

  /* ------------------------------------------------------------- operations */

  search(query: string, limit = 10): SandboxOutcome<{ results: CustomerSummary[]; count: number }> {
    const needle = String(query ?? '').trim().toLowerCase();
    if (needle.length === 0) {
      return fail('INVALID_PARAMETER', 'query must be a non-empty string');
    }
    const results: CustomerSummary[] = [];
    for (const customer of this.customers.values()) {
      const haystack = `${customer.id} ${customer.name} ${customer.email}`.toLowerCase();
      if (haystack.includes(needle)) {
        results.push({
          id: customer.id,
          name: customer.name,
          email: customer.email,
          status: customer.status,
        });
      }
    }
    results.sort((a, b) => a.id.localeCompare(b.id));
    return { ok: true, value: { results: results.slice(0, limit), count: results.length } };
  }

  get(customerId: string): SandboxOutcome<{ customer: Customer }> {
    const id = String(customerId ?? '').trim();
    if (id.length === 0) {
      return fail('INVALID_PARAMETER', 'customer_id must be a non-empty string');
    }
    const customer = this.customers.get(id);
    if (!customer) {
      return fail('MISSING_RECORD', `no customer with id ${id}`);
    }
    return { ok: true, value: { customer: { ...customer } } };
  }

  update(
    customerId: string,
    field: string,
    value: string,
    callId: string,
  ): SandboxOutcome<{ success: true; customer: Customer }> {
    const id = String(customerId ?? '').trim();
    const key = String(field ?? '').trim();
    if (id.length === 0 || key.length === 0) {
      return fail('INVALID_PARAMETER', 'customer_id and field are required');
    }
    const customer = this.customers.get(id);
    if (!customer) {
      return fail('MISSING_RECORD', `no customer with id ${id}`);
    }
    if (this.deniedCustomers.includes(id)) {
      return fail('PERMISSION_DENIED', `record ${id} is locked and cannot be modified`);
    }
    if (!this.writableFields.includes(key)) {
      return fail(
        'PERMISSION_DENIED',
        `field "${key}" is not writable. Writable fields: ${this.writableFields.join(', ')}`,
      );
    }
    const next = String(value ?? '');
    if (key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
      return fail('INVALID_PARAMETER', `"${next}" is not a valid email address`);
    }
    if (key === 'status' && !VALID_STATUS.includes(next)) {
      return fail('INVALID_PARAMETER', `status must be one of ${VALID_STATUS.join(', ')}`);
    }

    const before = String((customer as unknown as Record<string, unknown>)[key] ?? '');
    const updated = { ...customer, [key]: next } as Customer;
    this.customers.set(id, updated);
    this.writes.push({ customerId: id, field: key, before, after: next, callId, at: this.writes.length });
    return { ok: true, value: { success: true, customer: { ...updated } } };
  }
}
