import { gym } from '@/lib/gym';
import { toWireFitness, json, fail } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

/** GET /api/agents/:id/fitness */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const store = gym().store;
  const agent = store.getAgent(id);
  if (!agent) return fail(`No agent "${id}"`, 404);
  return json({ fitness: toWireFitness(agent.id, agent.name, store.listProfiles(agent.id)) });
}
