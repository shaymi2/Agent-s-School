import { gym } from '@/lib/gym';
import { getExercise } from '@gym/engine';
import { toWireSession, json, fail } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sessions — prepare a workout.
 *
 * The session exists but has not run: the client subscribes to its event
 * stream first, then calls /start. That ordering is what guarantees the UI
 * sees the first tool call.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const agentId = String(body.agentId ?? '');
  const exerciseId = String(body.exerciseId ?? '');

  const store = gym().store;
  const agent = store.getAgent(agentId);
  if (!agent) return fail(`No agent "${agentId}"`, 404);
  if (!getExercise(exerciseId)) return fail(`No exercise "${exerciseId}"`, 404);

  try {
    const session = gym().orchestrator.prepareSession({
      agentId: agent.id,
      exerciseId,
      // `fresh` re-measures a baseline by dropping accumulated coaching.
      ...(body.fresh === true ? { guidance: null } : {}),
    });
    return json({ session: toWireSession(session, agent.name) }, 201);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 400);
  }
}

/** GET /api/sessions?agentId=&exerciseId=&limit= */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  const store = gym().store;
  const sessions = store
    .listSessions({
      agentId: url.searchParams.get('agentId') ?? undefined,
      exerciseId: url.searchParams.get('exerciseId') ?? undefined,
      limit: Number(url.searchParams.get('limit') ?? 25),
    })
    .map((session) => toWireSession(session, store.getAgent(session.agentId)?.name ?? 'unknown'));
  return json({ sessions });
}
