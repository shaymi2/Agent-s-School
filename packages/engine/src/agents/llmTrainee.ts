/**
 * A trainee driven by a real language model.
 *
 * The loop is deliberately manual: the orchestrator owns the tool executor,
 * the step budget and the event stream, and all three have to stay in the
 * engine rather than inside an SDK helper.
 *
 * Only observable behaviour leaves this class. Thinking blocks are never
 * requested, never stored and never emitted.
 */

import { buildSystemPrompt, buildTaskMessage } from './prompt.ts';
import type { LlmProvider, LlmTurn } from '../providers/types.ts';
import type {
  ProviderKind,
  ToolInvoker,
  TraineeAgent,
  TraineeContext,
  TraineeOutcome,
} from '../domain/types.ts';

export class LlmTraineeAgent implements TraineeAgent {
  readonly kind: ProviderKind;
  readonly model: string;
  private readonly provider: LlmProvider;

  constructor(provider: LlmProvider, kind: ProviderKind) {
    this.provider = provider;
    this.kind = kind;
    this.model = provider.model;
  }

  async run(context: TraineeContext, invoke: ToolInvoker): Promise<TraineeOutcome> {
    const system = buildSystemPrompt(context);
    const turns: LlmTurn[] = [
      { role: 'user', blocks: [{ type: 'text', text: buildTaskMessage(context) }] },
    ];

    let steps = 0;
    let lastText = '';

    while (steps < context.maxSteps) {
      let completion;
      try {
        completion = await this.provider.complete({ system, turns, tools: context.tools });
      } catch (error) {
        return {
          finalResponse: lastText,
          stepsUsed: steps,
          stopReason: 'error',
          providerError: error instanceof Error ? error.message : String(error),
        };
      }

      if (completion.text) lastText = completion.text;

      if (completion.toolCalls.length === 0) {
        return { finalResponse: completion.text || lastText, stepsUsed: steps, stopReason: 'finished' };
      }

      turns.push({
        role: 'assistant',
        blocks: [
          ...(completion.text ? [{ type: 'text' as const, text: completion.text }] : []),
          ...completion.toolCalls.map((call) => ({
            type: 'tool_use' as const,
            id: call.id,
            name: call.name,
            input: call.input,
          })),
        ],
      });

      const resultBlocks = [];
      for (const call of completion.toolCalls) {
        if (steps >= context.maxSteps) break;
        steps += 1;
        const result = await invoke({ id: call.id, name: call.name, input: call.input });
        resultBlocks.push({
          type: 'tool_result' as const,
          toolUseId: call.id,
          content: JSON.stringify(result.ok ? result.output : { error: result.error }),
          isError: !result.ok,
        });
      }
      turns.push({ role: 'user', blocks: resultBlocks });
    }

    // Budget spent mid-task: ask once for a final report so the session still
    // ends with something the judge can read.
    turns.push({
      role: 'user',
      blocks: [
        {
          type: 'text',
          text: 'You have used your entire tool budget. Report what you found or changed, and what is still outstanding. Do not call any more tools.',
        },
      ],
    });
    try {
      const wrapUp = await this.provider.complete({ system, turns, tools: [] });
      return {
        finalResponse: wrapUp.text || lastText,
        stepsUsed: steps,
        stopReason: 'max_steps',
      };
    } catch {
      return { finalResponse: lastText, stepsUsed: steps, stopReason: 'max_steps' };
    }
  }
}
