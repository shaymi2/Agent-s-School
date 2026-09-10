import { externalTrainee, gym } from '@/lib/gym';
import { json, fail } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sessions/:id/tool-call — bring your own agent.
 *
 * For a session whose agent has provider "external", the caller decides which
 * tool to call and the gym executes it against the same sandbox, with the
 * same injected failures, that a self-driving trainee would meet. Judging is
 * identical; only the decision-making moved outside the process.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const session = gym().store.getSession(id);
  if (!session) return fail(`No session "${id}"`, 404);

  const trainee = externalTrainee(id);
  if (!trainee) {
    return fail(
      `Session "${id}" is not accepting external tool calls. Start it first, and use an agent whose provider is "external".`,
      409,
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name ?? body.tool ?? '');
  if (name.length === 0) return fail('name is required');
  const input = (body.input ?? {}) as Record<string, unknown>;

  try {
    const result = await trainee.submit(name, input);
    return json({
      result,
      stepsUsed: trainee.stepsUsed,
      remainingSteps: trainee.remainingSteps,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 409);
  }
}
