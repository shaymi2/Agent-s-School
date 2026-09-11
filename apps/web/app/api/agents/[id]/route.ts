import { gym } from '@/lib/gym';
import { providerAvailable } from '@gym/engine';
import { json, fail } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

/** GET /api/agents/:id */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const agent = gym().store.getAgent(id);
  if (!agent) return fail('No such agent', 404);
  return json({ agent: { ...agent, available: providerAvailable(agent.provider) } });
}
