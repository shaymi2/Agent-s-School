/**
 * The only path from a trainee to the world.
 *
 * Every invocation is validated, permission-checked against the exercise's
 * allow-list, timed, logged and possibly hit by an environment event. Nothing
 * reaches the sandbox without passing through here, which is what makes the
 * audit trail the judge reads trustworthy.
 */

import { EnvironmentEventEngine, EVENT_MESSAGES, isErrorEvent } from '../sandbox/environmentEvents.ts';
import type { Sandbox } from '../sandbox/sandbox.ts';
import { TOOL_REGISTRY } from './registry.ts';
import type {
  Customer,
  EnvironmentEventKind,
  EnvironmentEventRule,
  ToolCall,
  ToolResult,
} from '../domain/types.ts';

export interface ExecutionRecord {
  index: number;
  call: ToolCall;
  result: ToolResult;
}

export class ToolExecutor {
  private readonly sandbox: Sandbox;
  private readonly allowed: Set<string>;
  private readonly events: EnvironmentEventEngine;
  readonly log: ExecutionRecord[] = [];

  constructor(sandbox: Sandbox, allowedTools: string[], rules: EnvironmentEventRule[] = []) {
    this.sandbox = sandbox;
    this.allowed = new Set(allowedTools);
    this.events = new EnvironmentEventEngine(rules);
  }

  get firedEvents(): Array<{ kind: EnvironmentEventKind; tool: string; callId: string }> {
    return this.events.fired;
  }

  execute(call: ToolCall): ToolResult {
    const started = Date.now();
    const record = (result: ToolResult): ToolResult => {
      this.log.push({ index: this.log.length, call, result });
      return result;
    };
    const finish = (
      partial: Omit<ToolResult, 'callId' | 'toolName' | 'latencyMs'>,
      latency: number,
    ): ToolResult =>
      record({
        callId: call.id,
        toolName: call.name,
        latencyMs: latency,
        ...partial,
      });

    // The allow-list is checked first and the registry is read with an
    // own-property lookup, so a name like "constructor" can never resolve to
    // something inherited from Object.prototype.
    const impl = this.allowed.has(call.name) && Object.hasOwn(TOOL_REGISTRY, call.name)
      ? TOOL_REGISTRY[call.name]
      : undefined;
    if (!impl) {
      return finish(
        {
          ok: false,
          output: null,
          error: {
            code: 'TOOL_NOT_AVAILABLE',
            message: `"${call.name}" is not one of the tools available for this exercise (${[...this.allowed].join(', ')})`,
            retryable: false,
          },
        },
        Date.now() - started,
      );
    }

    const missing = impl.definition.inputSchema.required.filter(
      (key) => call.input[key] === undefined || call.input[key] === null || call.input[key] === '',
    );
    if (missing.length > 0) {
      return finish(
        {
          ok: false,
          output: null,
          error: {
            code: 'INVALID_PARAMETER',
            message: `missing required parameter(s): ${missing.join(', ')}`,
            retryable: false,
          },
        },
        Date.now() - started,
      );
    }

    const rule = this.events.consume(call);

    if (rule && isErrorEvent(rule.response)) {
      const info = EVENT_MESSAGES[rule.response];
      const latency =
        rule.response === 'API_TIMEOUT' ? this.sandbox.nextLatency(1200, 1800) : this.sandbox.nextLatency(40, 120);
      return finish(
        {
          ok: false,
          output: null,
          error: {
            code: rule.response,
            message: rule.message ?? info.message,
            retryable: info.retryable,
          },
          environmentEvent: rule.response,
        },
        latency,
      );
    }

    const outcome = impl.handler(this.sandbox, call.input, call.id);
    const latency = this.sandbox.nextLatency(20, 90);

    if (!outcome.ok) {
      return finish(
        {
          ok: false,
          output: null,
          error: outcome.error,
          environmentEvent: rule?.response,
        },
        latency,
      );
    }

    let output = outcome.value;
    if (rule && !isErrorEvent(rule.response)) {
      output = this.degrade(rule.response, call, output);
    }

    return finish({ ok: true, output, environmentEvent: rule?.response }, latency);
  }

  /** Successful-but-degraded responses: partial payloads and stale indexes. */
  private degrade(
    kind: EnvironmentEventKind,
    call: ToolCall,
    output: Record<string, unknown>,
  ): Record<string, unknown> {
    if (kind === 'INCOMPLETE_RESPONSE') {
      if (Array.isArray(output.results)) {
        const results = (output.results as Array<Record<string, unknown>>).map((row) => ({
          id: row.id,
          name: row.name,
        }));
        return {
          results,
          count: output.count,
          truncated: true,
          note: 'This response is partial: email and status were omitted by the upstream index.',
        };
      }
      if (output.customer && typeof output.customer === 'object') {
        const customer = output.customer as Customer;
        return {
          customer: { id: customer.id, name: customer.name },
          truncated: true,
          note: 'This response is partial: most fields were omitted by the upstream.',
        };
      }
      return { ...output, truncated: true };
    }

    if (kind === 'CONFLICTING_DATA') {
      if (Array.isArray(output.results)) {
        const results = (output.results as Array<Record<string, unknown>>).map((row) => {
          const patch = this.sandbox.conflictingView(String(row.id));
          return patch ? { ...row, ...patch } : row;
        });
        return {
          results,
          count: output.count,
          source: 'search-index',
          note: 'Served from the search index, which can lag behind the system of record.',
        };
      }
      if (output.customer && typeof output.customer === 'object') {
        const customer = output.customer as Customer;
        const patch = this.sandbox.conflictingView(customer.id);
        if (patch) {
          return {
            customer: { ...customer, ...patch },
            source: 'search-index',
            note: 'Served from the search index, which can lag behind the system of record.',
          };
        }
      }
      return output;
    }

    void call;
    return output;
  }
}
