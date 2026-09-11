/**
 * A deterministic, rule-based trainee.
 *
 * This is NOT a language model and does not pretend to be one. It is the
 * baseline athlete: a reflex policy that reads the brief, calls tools, reacts
 * to what comes back, and — crucially — obeys coaching when it is given any.
 *
 * Untrained it behaves the way careless agents actually behave: it writes
 * without reading the record first, trusts the search index, gives up on the
 * first transient error and searches for ids it already holds. Each of those
 * habits is switched off by a specific coaching flag, which is what makes the
 * improvement loop causal rather than decorative.
 *
 * It also keeps the whole engine runnable and testable with no API key.
 */

import { parseTask, SUMMARY_FIELDS } from './taskParser.ts';
import type {
  Customer,
  ToolCall,
  ToolInvoker,
  ToolResult,
  TraineeAgent,
  TraineeContext,
  TraineeOutcome,
} from '../domain/types.ts';

interface Summary {
  id: string;
  name: string;
  email?: string;
  status?: string;
}

const FIELD_LABELS: Record<string, string> = {
  id: 'customer id',
  name: 'name',
  email: 'email',
  phone: 'phone',
  status: 'status',
  plan: 'plan',
  region: 'region',
  accountOwner: 'account owner',
  notes: 'notes',
  createdAt: 'created',
};

export class HeuristicTraineeAgent implements TraineeAgent {
  readonly kind = 'heuristic' as const;
  readonly model: string;

  constructor(model = 'reflex-v1') {
    this.model = model;
  }

  async run(context: TraineeContext, invoke: ToolInvoker): Promise<TraineeOutcome> {
    const run = new PolicyRun(context, invoke);
    return run.execute();
  }
}

class PolicyRun {
  private readonly ctx: TraineeContext;
  private readonly invoke: ToolInvoker;
  private readonly notes: string[] = [];
  private steps = 0;
  private readonly budget: number;

  private readonly verify: boolean;
  private readonly retryTransient: boolean;
  private readonly disambiguate: boolean;
  private readonly avoidRedundantSearch: boolean;

  constructor(context: TraineeContext, invoke: ToolInvoker) {
    this.ctx = context;
    this.invoke = invoke;
    const g = context.guidance;
    this.verify = g?.requireVerification ?? false;
    this.retryTransient = g?.retryTransientErrors ?? false;
    this.disambiguate = g?.disambiguateBeforeActing ?? false;
    this.avoidRedundantSearch = g?.avoidRedundantSearch ?? false;
    this.budget = Math.min(context.maxSteps, g?.maxToolCalls ?? context.maxSteps);
  }

  private has(tool: string): boolean {
    return this.ctx.tools.some((t) => t.name === tool);
  }

  private get exhausted(): boolean {
    return this.steps >= this.budget;
  }

  private async call(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    this.steps += 1;
    const call: ToolCall = { id: `call_${this.steps}`, name, input };
    return this.invoke(call);
  }

  /** Retries only what the environment said was retryable, and only when coached to. */
  private async callWithRetry(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    let result = await this.call(name, input);
    let retries = 0;
    while (!result.ok && result.error?.retryable && this.retryTransient && retries < 2 && !this.exhausted) {
      retries += 1;
      this.notes.push(`${name} returned ${result.error.code}; retried and continued.`);
      result = await this.call(name, input);
    }
    return result;
  }

  private done(finalResponse: string): TraineeOutcome {
    const extra = this.notes.length > 0 ? `\n\nNotes:\n- ${this.notes.join('\n- ')}` : '';
    return { finalResponse: finalResponse + extra, stepsUsed: this.steps, stopReason: 'finished' };
  }

  async execute(): Promise<TraineeOutcome> {
    const task = parseTask(this.ctx.exercise.task);

    let targetId = task.customerId;
    let summary: Summary | null = null;
    let record: Customer | null = null;
    let indexSaidSomethingElse: Record<string, string> | null = null;

    /* ---------------------------------------------------------- locate ---- */

    const searchIsRedundant = targetId !== null && this.avoidRedundantSearch;
    if (!searchIsRedundant && this.has('search_customer') && !this.exhausted) {
      const query = task.subjectName ?? targetId ?? '';
      const result = await this.callWithRetry('search_customer', { query });
      if (!result.ok) {
        return this.done(
          `I could not complete the task. search_customer failed with ${result.error?.code}: ${result.error?.message}. No records were changed.`,
        );
      }
      const output = result.output ?? {};
      const results = (output.results as Summary[]) ?? [];
      const fromIndex = output.source === 'search-index';

      if (results.length === 0) {
        return this.done(
          `No customer matching "${query}" was found in the directory. Nothing was changed. Please confirm the name or provide a customer id.`,
        );
      }

      let candidates = results;
      if (task.statusQualifier && results.some((r) => r.status !== undefined)) {
        const narrowed = results.filter((r) => r.status === task.statusQualifier);
        if (narrowed.length > 0) {
          candidates = narrowed;
          this.notes.push(
            `${results.length} records matched "${query}"; narrowed to the ${task.statusQualifier} one.`,
          );
        }
      }

      if (candidates.length > 1 && this.disambiguate && this.has('get_customer')) {
        const inspected: Customer[] = [];
        for (const candidate of candidates) {
          if (this.exhausted) break;
          const detail = await this.callWithRetry('get_customer', { customer_id: candidate.id });
          if (detail.ok && detail.output?.customer) inspected.push(detail.output.customer as Customer);
        }
        const chosen = task.statusQualifier
          ? inspected.filter((c) => c.status === task.statusQualifier)
          : inspected;
        if (chosen.length !== 1) {
          return this.done(
            `${candidates.length} records match "${query}" (${candidates.map((c) => c.id).join(', ')}) and I could not tell them apart from the brief. I did not change anything. Please confirm which customer id is correct.`,
          );
        }
        record = chosen[0];
        targetId = record.id;
        summary = { id: record.id, name: record.name, email: record.email, status: record.status };
      } else {
        if (candidates.length > 1) {
          this.notes.push(
            `${candidates.length} records matched "${query}"; used the first one (${candidates[0].id}).`,
          );
        }
        summary = candidates[0];
        targetId = summary.id;
        if (fromIndex) indexSaidSomethingElse = { ...summary } as Record<string, string>;
      }
    }

    if (!targetId) {
      return this.done(
        `I could not identify a customer from the brief, so no record was found and nothing was changed.`,
      );
    }

    /* ------------------------------------------------------------ read ---- */

    const wantsFullRecord =
      this.verify ||
      task.intent === 'write' ||
      task.requestedFields.some((f) => !SUMMARY_FIELDS.includes(f)) ||
      task.requestedFields.some((f) => summary !== null && (summary as unknown as Record<string, unknown>)[f] === undefined);

    const shouldFetch =
      this.has('get_customer') &&
      record === null &&
      !this.exhausted &&
      (this.verify || (wantsFullRecord && task.intent === 'read') || (task.intent === 'write' && this.verify));

    if (shouldFetch) {
      const detail = await this.callWithRetry('get_customer', { customer_id: targetId });
      if (detail.ok && detail.output?.customer) {
        record = detail.output.customer as Customer;
      } else if (!detail.ok) {
        return this.done(
          `I could not retrieve customer ${targetId}: ${detail.error?.code} ${detail.error?.message}. Nothing was changed.`,
        );
      }
    }

    if (task.intent === 'read') {
      return this.done(this.reportRead(task.requestedFields, record, summary, indexSaidSomethingElse));
    }

    /* ----------------------------------------------------------- write ---- */

    if (!this.has('update_customer')) {
      return this.done(
        `This task asks for a change, but update_customer is not available in this exercise, so I cannot apply it. Nothing was changed.`,
      );
    }

    if (record && (task.requiresJudgement || this.verify)) {
      const locked = /do not modify|without approval|pending .*review/i.test(record.notes ?? '');
      if (locked || record.status === 'suspended') {
        return this.done(
          `I did not apply the change. Record ${record.id} (${record.name}) is ${record.status} and its notes read: "${record.notes}". A change like this needs approval from the account owner (${record.accountOwner}) before it can be made, so I am escalating rather than writing. No record was modified.`,
        );
      }
    }

    if (!task.targetField || !task.targetValue) {
      return this.done(
        `The brief asks for a change but I could not determine which field and value to write, so I did not modify ${targetId}.`,
      );
    }

    if (this.exhausted) {
      return {
        finalResponse: `I ran out of my tool-call budget before applying the change to ${targetId}. Nothing was modified.`,
        stepsUsed: this.steps,
        stopReason: 'max_steps',
      };
    }

    const write = await this.callWithRetry('update_customer', {
      customer_id: targetId,
      field: task.targetField,
      value: task.targetValue,
    });

    if (!write.ok) {
      return this.done(
        `The update did not go through. update_customer returned ${write.error?.code}: ${write.error?.message}. I cannot apply this change with the tools I have, so ${targetId} was left unchanged.`,
      );
    }

    const updated = write.output?.customer as Customer | undefined;
    return this.done(
      `Updated ${FIELD_LABELS[task.targetField] ?? task.targetField} on ${targetId}` +
        (updated ? ` (${updated.name})` : '') +
        ` to ${task.targetValue}. The change is confirmed against the record.`,
    );
  }

  private reportRead(
    requested: string[],
    record: Customer | null,
    summary: Summary | null,
    indexValues: Record<string, string> | null,
  ): string {
    const source = record ?? summary;
    if (!source) return 'I was not able to retrieve any customer data for this request.';

    const fields = requested.length > 0 ? requested : ['id', 'email', 'status', 'plan'];
    const lines: string[] = [];
    for (const field of fields) {
      const value = (source as unknown as Record<string, unknown>)[field];
      lines.push(
        value === undefined || value === ''
          ? `- ${FIELD_LABELS[field] ?? field}: not returned by the tools I used`
          : `- ${FIELD_LABELS[field] ?? field}: ${String(value)}`,
      );
    }

    let conflictNote = '';
    if (record && indexValues) {
      const disagreements = Object.keys(FIELD_LABELS).filter(
        (f) =>
          indexValues[f] !== undefined &&
          String((record as unknown as Record<string, unknown>)[f]) !== String(indexValues[f]),
      );
      if (disagreements.length > 0) {
        conflictNote =
          `\n\nThe search index and the full record disagree on ${disagreements.join(', ')}. ` +
          `I reported the value from get_customer, because the full record is the authoritative system of record and the search index can lag behind it.`;
      }
    }

    const header = `Customer ${source.name} (${source.id}):`;
    return `${header}\n${lines.join('\n')}${conflictNote}`;
  }
}
