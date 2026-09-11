/**
 * A trainee driven from outside the process.
 *
 * This is how you bring your own agent: create a session, POST tool calls to
 * it one at a time, then POST the final report. The gym scores it exactly as
 * it scores an agent it ran itself — same sandbox, same environment events,
 * same assertions — because the only thing that changed is who decided which
 * tool to call next.
 */

import type {
  ProviderKind,
  ToolInvoker,
  ToolResult,
  TraineeAgent,
  TraineeContext,
  TraineeOutcome,
} from '../domain/types.ts';

export class ExternalTraineeAgent implements TraineeAgent {
  readonly kind: ProviderKind = 'external';
  readonly model = 'external';

  private invoker: ToolInvoker | null = null;
  private settle: ((outcome: TraineeOutcome) => void) | null = null;
  private steps = 0;
  private maxSteps = 0;
  private closed = false;

  run(context: TraineeContext, invoke: ToolInvoker): Promise<TraineeOutcome> {
    this.invoker = invoke;
    this.maxSteps = context.maxSteps;
    return new Promise<TraineeOutcome>((resolve) => {
      this.settle = resolve;
    });
  }

  get ready(): boolean {
    return this.invoker !== null && !this.closed;
  }

  get stepsUsed(): number {
    return this.steps;
  }

  get remainingSteps(): number {
    return Math.max(0, this.maxSteps - this.steps);
  }

  async submit(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    if (this.closed) throw new Error('This session has already been finished.');
    if (!this.invoker) throw new Error('This session has not been started yet.');
    if (this.steps >= this.maxSteps) {
      throw new Error(`Tool budget exhausted: ${this.maxSteps} calls have already been made.`);
    }
    this.steps += 1;
    return this.invoker({ id: `call_${this.steps}`, name, input });
  }

  finish(finalResponse: string): void {
    if (this.closed) return;
    this.closed = true;
    this.settle?.({
      finalResponse,
      stepsUsed: this.steps,
      stopReason: this.steps >= this.maxSteps ? 'max_steps' : 'finished',
    });
  }
}
