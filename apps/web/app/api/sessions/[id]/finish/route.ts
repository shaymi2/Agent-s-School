import { awaitSession, externalTrainee, gym } from '@/lib/gym';
import { toWireEvaluation, toWireFeedback, json, fail } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sessions/:id/finish — hand in the final report.
 *
 * Ends an externally driven session and returns the verdict once the judge
 * and the coach have run.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const store = gym().store;
  if (!store.getSession(id)) return fail(`No session "${id}"`, 404);

  const trainee = externalTrainee(id);
  if (!trainee) return fail(`Session "${id}" is not an open external session`, 409);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  trainee.finish(String(body.finalResponse ?? ''));
  await awaitSession(id);

  const evaluation = store.getEvaluation(id);
  const feedback = store.getFeedback(id);
  return json({
    evaluation: evaluation ? toWireEvaluation(evaluation) : null,
    feedback: feedback ? toWireFeedback(feedback) : null,
  });
}
