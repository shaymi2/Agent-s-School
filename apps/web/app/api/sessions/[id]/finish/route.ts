import { awaitSession, externalTrainee, gym } from '@/lib/gym';
import { MAX_FINAL_RESPONSE } from '@gym/engine';
import { toWireEvaluation, toWireFeedback, json, fail } from '@/lib/serialize';
import { guardMutation, safeError } from '@/lib/guard';

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
  const guarded = await guardMutation(request);
  if (guarded instanceof Response) return guarded;
  const { body } = guarded;

  const { id } = await params;
  const store = gym().store;
  if (!store.getSession(id)) return fail('No such session', 404);

  const trainee = externalTrainee(id);
  if (!trainee) return fail('This session is not an open external session', 409);

  try {
    trainee.finish(String(body.finalResponse ?? '').slice(0, MAX_FINAL_RESPONSE));
    await awaitSession(id);
  } catch (error) {
    return safeError('Finishing the session', error);
  }

  const evaluation = store.getEvaluation(id);
  const feedback = store.getFeedback(id);
  return json({
    evaluation: evaluation ? toWireEvaluation(evaluation) : null,
    feedback: feedback ? toWireFeedback(feedback) : null,
  });
}
