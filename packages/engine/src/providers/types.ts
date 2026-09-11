/**
 * The provider boundary.
 *
 * Trainee, Judge and Coach all talk to a model through this interface, so the
 * gym is not welded to one vendor. Two implementations ship: Anthropic (via
 * the official SDK) and a generic OpenAI-compatible endpoint.
 */

import type { ToolDefinition } from '../domain/types.ts';

export type LlmBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean };

export interface LlmTurn {
  role: 'user' | 'assistant';
  blocks: LlmBlock[];
}

export interface LlmCompletion {
  text: string;
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason: string;
}

export interface CompleteRequest {
  system: string;
  turns: LlmTurn[];
  tools: ToolDefinition[];
  maxTokens?: number;
}

export interface JsonRequest {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  /** One assistant turn, which may contain tool calls. */
  complete(request: CompleteRequest): Promise<LlmCompletion>;
  /** One assistant turn constrained to a JSON schema. Used by Judge and Coach. */
  json<T>(request: JsonRequest): Promise<T>;
}

/** Thrown when a provider is asked for but not usable, with the fix in the message. */
export class ProviderUnavailableError extends Error {}

/** Pull the first JSON object out of a model response that wrapped it in prose. */
export function extractJson<T>(text: string): T {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Model response contained no JSON object: ${text.slice(0, 200)}`);
  }
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}
