import { externalTrainee, gym } from '@/lib/gym';
import { json, fail } from '@/lib/serialize';
import { guardMutation } from '@/lib/guard';

export const dynamic = 'force-dynamic';

/** Tool inputs are bounded: they are stored, replayed and read by the judge. */
const MAX_INPUT_KEYS = 12;
const MAX_INPUT_VALUE = 2000;

/**
 * POST /api/sessions/:id/tool-call — bring your own agent.
 *
 * For a session whose agent has provider "external", the caller decides which
 * tool to call and the gym executes it against the same sandbox, with the
 * same injected failures, that a self-driving trainee would meet. Judging is
 * identical; only the decision-making moved outside the process.
 *
 * The call still goes through the executor, so the exercise's tool allow-list,
 * the sandbox's writable-field list and the session's tool budget all apply.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guarded = await guardMutation(request);
  if (guarded instanceof Response) return guarded;
  const { body } = guarded;

  const { id } = await params;
  if (!gym().store.getSession(id)) return fail('No such session', 404);

  const trainee = externalTrainee(id);
  if (!trainee) {
    return fail(
      'This session is not accepting external tool calls. Start it first, and use an agent whose provider is "external".',
      409,
    );
  }

  const name = String(body.name ?? body.tool ?? '').slice(0, 64);
  if (name.length === 0) return fail('name is required');

  const rawInput = body.input;
  if (rawInput !== undefined && (typeof rawInput !== 'object' || rawInput === null || Array.isArray(rawInput))) {
    return fail('input must be a JSON object');
  }
  const entries = Object.entries((rawInput ?? {}) as Record<string, unknown>);
  if (entries.length > MAX_INPUT_KEYS) return fail(`input may carry at most ${MAX_INPUT_KEYS} fields`);
  const input: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    // Own enumerable keys only, and no prototype-shaped names reaching the
    // executor or the sandbox.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    input[key.slice(0, 64)] =
      typeof value === 'string'
        ? value.slice(0, MAX_INPUT_VALUE)
        : typeof value === 'number' || typeof value === 'boolean'
          ? value
          : String(value ?? '').slice(0, MAX_INPUT_VALUE);
  }

  try {
    const result = await trainee.submit(name, input);
    return json({
      result,
      stepsUsed: trainee.stepsUsed,
      remainingSteps: trainee.remainingSteps,
    });
  } catch (error) {
    // These are the trainee's own guard rails (budget spent, session closed),
    // so the message is safe and useful to return.
    return fail(error instanceof Error ? error.message : 'The tool call was refused', 409);
  }
}
