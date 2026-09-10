import { gym, startSession } from '@/lib/gym';
import { json, fail } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

/** POST /api/sessions/:id/start — begin the workout. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const store = gym().store;
  const session = store.getSession(id);
  if (!session) return fail(`No session "${id}"`, 404);
  if (session.status !== 'pending') {
    return fail(`Session "${id}" is already ${session.status}`, 409);
  }
  const agent = store.getAgent(session.agentId);
  if (!agent) return fail(`Session "${id}" has no agent`, 409);

  startSession(session, agent.provider);
  return json({ started: true, sessionId: id, mode: agent.provider === 'external' ? 'manual' : 'auto' });
}
