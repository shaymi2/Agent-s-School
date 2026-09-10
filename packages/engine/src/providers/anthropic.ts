/**
 * Anthropic provider, built on the official SDK.
 *
 * The SDK is imported lazily so the whole gym still runs, and its tests still
 * pass, on a machine with no API key and no network.
 */

import { extractJson, ProviderUnavailableError } from './types.ts';
import type {
  CompleteRequest,
  JsonRequest,
  LlmCompletion,
  LlmProvider,
  LlmTurn,
} from './types.ts';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5';

/** Beta flag for server-side refusal fallbacks. */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

type AnthropicClient = {
  messages: { create(body: Record<string, unknown>): Promise<AnthropicMessage> };
  beta: { messages: { create(body: Record<string, unknown>): Promise<AnthropicMessage> } };
};

interface AnthropicMessage {
  content: Array<Record<string, unknown>>;
  stop_reason?: string | null;
  stop_details?: { category?: string | null; explanation?: string } | null;
}

let clientPromise: Promise<AnthropicClient> | null = null;

async function getClient(apiKey?: string): Promise<AnthropicClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      let mod: { default: new (opts?: Record<string, unknown>) => AnthropicClient };
      try {
        mod = (await import('@anthropic-ai/sdk')) as never;
      } catch {
        throw new ProviderUnavailableError(
          'The Anthropic provider needs @anthropic-ai/sdk. Run `npm install` at the repository root.',
        );
      }
      const Anthropic = mod.default;
      return new Anthropic(apiKey ? { apiKey } : {});
    })();
  }
  return clientPromise;
}

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly apiKey?: string;
  /** Flipped off permanently if the account or model rejects the fallback beta. */
  private useFallbacks = true;

  constructor(model: string = DEFAULT_ANTHROPIC_MODEL, apiKey?: string) {
    this.model = model;
    this.apiKey = apiKey;
  }

  private async send(body: Record<string, unknown>): Promise<AnthropicMessage> {
    const client = await getClient(this.apiKey);
    if (this.useFallbacks) {
      try {
        return await client.beta.messages.create({
          ...body,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/fallback|beta/i.test(message)) throw error;
        // The account or model does not accept server-side fallbacks; carry on without.
        this.useFallbacks = false;
      }
    }
    return client.messages.create(body);
  }

  private static guardRefusal(message: AnthropicMessage): void {
    if (message.stop_reason === 'refusal') {
      const category = message.stop_details?.category ?? 'unspecified';
      throw new Error(
        `The model declined this request (category: ${category}). The gym cannot score a refused turn.`,
      );
    }
  }

  async complete(request: CompleteRequest): Promise<LlmCompletion> {
    const response = await this.send({
      model: this.model,
      max_tokens: request.maxTokens ?? 4096,
      system: request.system,
      tools: request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      })),
      messages: request.turns.map(toAnthropicTurn),
    });
    AnthropicProvider.guardRefusal(response);

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => String(block.text ?? ''))
      .join('\n')
      .trim();

    const toolCalls = response.content
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({
        id: String(block.id),
        name: String(block.name),
        input: (block.input ?? {}) as Record<string, unknown>,
      }));

    return { text, toolCalls, stopReason: response.stop_reason ?? 'end_turn' };
  }

  async json<T>(request: JsonRequest): Promise<T> {
    const response = await this.send({
      model: this.model,
      max_tokens: request.maxTokens ?? 4096,
      system: request.system,
      messages: [{ role: 'user', content: [{ type: 'text', text: request.prompt }] }],
      output_config: { format: { type: 'json_schema', schema: request.schema } },
    });
    AnthropicProvider.guardRefusal(response);
    const parsed = (response as { parsed_output?: unknown }).parsed_output;
    if (parsed && typeof parsed === 'object') return parsed as T;
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => String(block.text ?? ''))
      .join('\n');
    return extractJson<T>(text);
  }
}

function toAnthropicTurn(turn: LlmTurn): Record<string, unknown> {
  return {
    role: turn.role,
    content: turn.blocks.map((block) => {
      if (block.type === 'text') return { type: 'text', text: block.text };
      if (block.type === 'tool_use') {
        return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
      }
      return {
        type: 'tool_result',
        tool_use_id: block.toolUseId,
        content: block.content,
        is_error: block.isError,
      };
    }),
  };
}
