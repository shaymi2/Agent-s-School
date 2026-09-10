/**
 * Provider selection.
 *
 * The gym runs in one of two modes and is explicit about which:
 *   - no credentials: the deterministic heuristic trainee, judge and coach
 *   - credentials present: real model calls for whichever roles are enabled
 */

import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from './anthropic.ts';
import { OpenAiCompatibleProvider } from './openaiCompatible.ts';
import { ProviderUnavailableError } from './types.ts';
import type { LlmProvider } from './types.ts';
import type { ProviderKind } from '../domain/types.ts';

export interface ProviderEnv {
  ANTHROPIC_API_KEY?: string;
  GYM_TRAINEE_MODEL?: string;
  GYM_JUDGE_MODEL?: string;
  GYM_COACH_MODEL?: string;
  GYM_OPENAI_API_KEY?: string;
  GYM_OPENAI_BASE_URL?: string;
  GYM_OPENAI_MODEL?: string;
}

function env(): ProviderEnv {
  return process.env as ProviderEnv;
}

/** True when a real model can be reached for the given provider kind. */
export function providerAvailable(kind: ProviderKind): boolean {
  if (kind === 'heuristic') return true;
  if (kind === 'anthropic') return Boolean(env().ANTHROPIC_API_KEY);
  return Boolean(env().GYM_OPENAI_API_KEY && env().GYM_OPENAI_BASE_URL);
}

export function createProvider(kind: ProviderKind, model?: string): LlmProvider {
  const e = env();
  if (kind === 'anthropic') {
    if (!e.ANTHROPIC_API_KEY) {
      throw new ProviderUnavailableError(
        'ANTHROPIC_API_KEY is not set. Set it to train with a real model, or use the heuristic provider.',
      );
    }
    return new AnthropicProvider(model ?? e.GYM_TRAINEE_MODEL ?? DEFAULT_ANTHROPIC_MODEL, e.ANTHROPIC_API_KEY);
  }
  if (kind === 'openai_compatible') {
    if (!e.GYM_OPENAI_API_KEY || !e.GYM_OPENAI_BASE_URL) {
      throw new ProviderUnavailableError(
        'GYM_OPENAI_API_KEY and GYM_OPENAI_BASE_URL must both be set for the openai_compatible provider.',
      );
    }
    return new OpenAiCompatibleProvider(
      model ?? e.GYM_OPENAI_MODEL ?? 'gpt-4o-mini',
      e.GYM_OPENAI_BASE_URL,
      e.GYM_OPENAI_API_KEY,
    );
  }
  throw new ProviderUnavailableError(`"${kind}" is not an LLM provider.`);
}

/** The provider used for judging and coaching, when one is configured. */
export function createEvaluatorProvider(role: 'judge' | 'coach'): LlmProvider | null {
  const e = env();
  if (e.ANTHROPIC_API_KEY) {
    const model = (role === 'judge' ? e.GYM_JUDGE_MODEL : e.GYM_COACH_MODEL) ?? DEFAULT_ANTHROPIC_MODEL;
    return new AnthropicProvider(model, e.ANTHROPIC_API_KEY);
  }
  if (e.GYM_OPENAI_API_KEY && e.GYM_OPENAI_BASE_URL) {
    return new OpenAiCompatibleProvider(
      e.GYM_OPENAI_MODEL ?? 'gpt-4o-mini',
      e.GYM_OPENAI_BASE_URL,
      e.GYM_OPENAI_API_KEY,
    );
  }
  return null;
}
