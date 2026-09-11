import { gym } from '@/lib/gym';
import { toWireSession, json, fail } from '@/lib/serialize';
import { boundedLimit } from '@/lib/guard';

export const dynamic = 'force-dynamic';

/** GET /api/agents/:id/history?limit=50 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const store = gym().store;
  const agent = store.getAgent(id);
  if (!agent) return fail('No such agent', 404);

  const limit = boundedLimit(new URL(request.url).searchParams.get('limit'), 50, 200);
  const sessions = store
    .listSessions({ agentId: agent.id, limit })
    .map((session) => toWireSession(session, agent.name));
  return json({ sessions });
}
