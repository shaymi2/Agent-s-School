/**
 * Generic OpenAI-compatible provider.
 *
 * This exists so the gym is not welded to a single vendor: point it at any
 * endpoint that speaks the /chat/completions shape (local runtimes included)
 * with GYM_OPENAI_BASE_URL. It is a separate provider, not a shim for Claude.
 */

import { extractJson, ProviderUnavailableError } from './types.ts';
import type { CompleteRequest, JsonRequest, LlmCompletion, LlmProvider } from './types.ts';

interface ChatChoice {
  message: {
    content: string | null;
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  };
  finish_reason: string;
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai_compatible';
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(model: string, baseUrl: string, apiKey: string) {
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  private async post(body: Record<string, unknown>): Promise<ChatChoice> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, ...body }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new ProviderUnavailableError(
        `${this.baseUrl} returned ${response.status}: ${detail.slice(0, 300)}`,
      );
    }
    const payload = (await response.json()) as { choices?: ChatChoice[] };
    const choice = payload.choices?.[0];
    if (!choice) throw new Error('Provider returned no choices');
    return choice;
  }

  async complete(request: CompleteRequest): Promise<LlmCompletion> {
    const messages: Array<Record<string, unknown>> = [{ role: 'system', content: request.system }];
    for (const turn of request.turns) {
      const text = turn.blocks
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('\n');
      const toolUses = turn.blocks.filter((b) => b.type === 'tool_use');
      const toolResults = turn.blocks.filter((b) => b.type === 'tool_result');

      if (turn.role === 'assistant') {
        messages.push({
          role: 'assistant',
          content: text || null,
          ...(toolUses.length > 0
            ? {
                tool_calls: toolUses.map((b) => {
                  const use = b as { id: string; name: string; input: Record<string, unknown> };
                  return {
                    id: use.id,
                    type: 'function',
                    function: { name: use.name, arguments: JSON.stringify(use.input) },
                  };
                }),
              }
            : {}),
        });
        continue;
      }

      for (const block of toolResults) {
        const result = block as { toolUseId: string; content: string };
        messages.push({ role: 'tool', tool_call_id: result.toolUseId, content: result.content });
      }
      if (text) messages.push({ role: 'user', content: text });
    }

    const choice = await this.post({
      messages,
      max_tokens: request.maxTokens ?? 4096,
      tools: request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      })),
    });

    return {
      text: (choice.message.content ?? '').trim(),
      toolCalls: (choice.message.tool_calls ?? []).map((call) => ({
        id: call.id,
        name: call.function.name,
        input: safeParse(call.function.arguments),
      })),
      stopReason: choice.finish_reason,
    };
  }

  async json<T>(request: JsonRequest): Promise<T> {
    const choice = await this.post({
      messages: [
        { role: 'system', content: request.system },
        {
          role: 'user',
          content: `${request.prompt}\n\nRespond with JSON matching this schema and nothing else:\n${JSON.stringify(request.schema)}`,
        },
      ],
      max_tokens: request.maxTokens ?? 4096,
      response_format: { type: 'json_object' },
    });
    return extractJson<T>(choice.message.content ?? '');
  }
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
