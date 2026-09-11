/**
 * Tool definitions for the Tool Usage gym.
 *
 * A tool is a definition (what the trainee is told) plus a handler (what the
 * sandbox actually does). Adding a gym means adding a registry like this one;
 * nothing else in the engine changes.
 */

import type { Sandbox, SandboxOutcome } from '../sandbox/sandbox.ts';
import type { ToolDefinition } from '../domain/types.ts';

export interface ToolImplementation {
  definition: ToolDefinition;
  handler(
    sandbox: Sandbox,
    input: Record<string, unknown>,
    callId: string,
  ): SandboxOutcome<Record<string, unknown>>;
}

const searchCustomer: ToolImplementation = {
  definition: {
    name: 'search_customer',
    mutates: false,
    description:
      'Search the customer directory by name, email or id. Returns a list of matching summaries. Use it to find candidate records; it does not return the full record.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name, email fragment or customer id to search for.' },
        limit: { type: 'number', description: 'Maximum number of results to return (default 10).' },
      },
      required: ['query'],
    },
  },
  handler(sandbox, input) {
    const limit = typeof input.limit === 'number' ? input.limit : 10;
    const outcome = sandbox.search(String(input.query ?? ''), limit);
    if (!outcome.ok) return outcome;
    return { ok: true, value: { results: outcome.value.results, count: outcome.value.count } };
  },
};

const getCustomer: ToolImplementation = {
  definition: {
    name: 'get_customer',
    mutates: false,
    description:
      'Retrieve the authoritative, complete record for one customer id. This is the source of truth; search results can be stale.',
    inputSchema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string', description: 'The customer id, for example C1024.' },
      },
      required: ['customer_id'],
    },
  },
  handler(sandbox, input) {
    const outcome = sandbox.get(String(input.customer_id ?? ''));
    if (!outcome.ok) return outcome;
    return { ok: true, value: { customer: outcome.value.customer } };
  },
};

const updateCustomer: ToolImplementation = {
  definition: {
    name: 'update_customer',
    mutates: true,
    description:
      'Write a single field on one customer record. This is a destructive operation: it overwrites the stored value immediately and cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string', description: 'The customer id to modify, for example C1024.' },
        field: {
          type: 'string',
          description: 'Field to write.',
          enum: ['email', 'phone', 'status', 'plan', 'notes'],
        },
        value: { type: 'string', description: 'New value for the field.' },
      },
      required: ['customer_id', 'field', 'value'],
    },
  },
  handler(sandbox, input, callId) {
    const outcome = sandbox.update(
      String(input.customer_id ?? ''),
      String(input.field ?? ''),
      String(input.value ?? ''),
      callId,
    );
    if (!outcome.ok) return outcome;
    return { ok: true, value: { success: true, customer: outcome.value.customer } };
  },
};

export const TOOL_REGISTRY: Record<string, ToolImplementation> = {
  search_customer: searchCustomer,
  get_customer: getCustomer,
  update_customer: updateCustomer,
};

export function toolDefinitions(names: string[]): ToolDefinition[] {
  return names.map((name) => {
    const impl = TOOL_REGISTRY[name];
    if (!impl) throw new Error(`Unknown tool "${name}"`);
    return impl.definition;
  });
}
