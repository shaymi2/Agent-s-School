import { agentsWithAvailability, gym } from '@/lib/gym';
import { AGENT_LIMITS, PROVIDER_KINDS, clampText, clampToolBudget, providerAvailable } from '@gym/engine';
import { json, fail } from '@/lib/serialize';
import { guardMutation, safeError } from '@/lib/guard';
import type { ProviderKind } from '@gym/engine';

export const dynamic = 'force-dynamic';

/** GET /api/agents */
export function GET(): Response {
  return json({ agents: agentsWithAvailability() });
}

/** POST /api/agents — register a trainee. */
export async function POST(request: Request): Promise<Response> {
  const guarded = await guardMutation(request);
  if (guarded instanceof Response) return guarded;
  const { body } = guarded;

  const name = clampText(body.name, AGENT_LIMITS.maxNameLength);
  if (name.length === 0) return fail('name is required');

  const provider = String(body.provider ?? 'heuristic') as ProviderKind;
  if (!PROVIDER_KINDS.includes(provider)) {
    return fail('Unknown provider. Use one of: heuristic, anthropic, openai_compatible, external.');
  }
  if (!providerAvailable(provider)) {
    return fail(`Provider "${provider}" has no credentials configured on this server.`, 409);
  }

  try {
    // Every field is clamped again inside the store, so the bounds hold for
    // any caller, not just this route.
    const agent = gym().store.createAgent({
      name,
      provider,
      model: clampText(
        body.model,
        AGENT_LIMITS.maxModelLength,
        provider === 'heuristic' ? 'reflex-v1' : 'claude-opus-5',
      ),
      maxSteps: clampToolBudget(body.maxSteps),
      systemPrompt:
        body.systemPrompt === undefined
          ? undefined
          : clampText(body.systemPrompt, AGENT_LIMITS.maxSystemPromptLength) || undefined,
    });
    return json({ agent: { ...agent, available: true } }, 201);
  } catch (error) {
    return safeError('Creating the agent', error);
  }
}
