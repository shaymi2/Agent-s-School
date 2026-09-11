import { agentsWithAvailability, gym } from '@/lib/gym';
import { providerAvailable } from '@gym/engine';
import { json, fail } from '@/lib/serialize';
import type { ProviderKind } from '@gym/engine';

export const dynamic = 'force-dynamic';

/** GET /api/agents */
export function GET(): Response {
  return json({ agents: agentsWithAvailability() });
}

/** POST /api/agents — register a trainee. */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name ?? '').trim();
  if (name.length === 0) return fail('name is required');

  const provider = String(body.provider ?? 'heuristic') as ProviderKind;
  if (!['heuristic', 'anthropic', 'openai_compatible', 'external'].includes(provider)) {
    return fail(`Unknown provider "${provider}"`);
  }
  if (!providerAvailable(provider)) {
    return fail(`Provider "${provider}" has no credentials configured on this server.`, 409);
  }

  const agent = gym().store.createAgent({
    name,
    provider,
    model: String(body.model ?? (provider === 'heuristic' ? 'reflex-v1' : 'claude-opus-5')),
    maxSteps: Number(body.maxSteps ?? 12),
    systemPrompt: body.systemPrompt ? String(body.systemPrompt) : undefined,
  });
  return json({ agent: { ...agent, available: true } }, 201);
}
