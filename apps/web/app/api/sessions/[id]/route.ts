import { gym } from '@/lib/gym';
import {
  toWireEvaluation,
  toWireEvent,
  toWireFeedback,
  toWireSession,
  json,
  fail,
} from '@/lib/serialize';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sessions/:id — everything needed to render, or replay, a session.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const store = gym().store;
  const session = store.getSession(id);
  if (!session) return fail('No such session', 404);

  const agent = store.getAgent(session.agentId);
  const evaluation = store.getEvaluation(id);
  const feedback = store.getFeedback(id);

  // The previous completed attempt at the same workout, for the delta the
  // results screen shows.
  const earlier = store
    .listSessions({ agentId: session.agentId, exerciseId: session.exerciseId })
    .filter((s) => s.status === 'completed' && s.startedAt < session.startedAt)
    .sort((a, b) => b.startedAt - a.startedAt);

  return json({
    session: toWireSession(session, agent?.name ?? 'unknown'),
    evaluation: evaluation ? toWireEvaluation(evaluation) : null,
    feedback: feedback ? toWireFeedback(feedback) : null,
    events: store.listEvents(id).map(toWireEvent),
    previousScore: earlier[0]?.score ?? null,
  });
}
