import { getExercise } from '@gym/engine';
import { toWireExercise, json, fail } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

/** GET /api/exercises/:id */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const exercise = getExercise(id);
  if (!exercise) return fail(`No exercise "${id}"`, 404);
  return json({ exercise: toWireExercise(exercise), assertions: exercise.assertions.length });
}
