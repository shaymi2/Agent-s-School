import { gym, startSession } from '@/lib/gym';
import { json, fail } from '@/lib/serialize';
import { crossSiteRejection, safeError } from '@/lib/guard';

export const dynamic = 'force-dynamic';

/** POST /api/sessions/:id/start — begin the workout. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const rejected = crossSiteRejection(request);
  if (rejected) return rejected;

  const { id } = await params;
  const store = gym().store;
  const session = store.getSession(id);
  if (!session) return fail('No such session', 404);
  if (session.status !== 'pending') {
    return fail(`Session is already ${session.status}`, 409);
  }
  const agent = store.getAgent(session.agentId);
  if (!agent) return fail('This session has no agent', 409);

  try {
    startSession(session, agent.provider);
  } catch (error) {
    return safeError('Starting the session', error, 429);
  }
  return json({ started: true, sessionId: id, mode: agent.provider === 'external' ? 'manual' : 'auto' });
}
