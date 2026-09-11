import { gym } from '@/lib/gym';
import { listExercises } from '@gym/engine';
import { toWireExercise, json } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

/** GET /api/exercises?skill=tool_usage&agentId=... */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  const skill = url.searchParams.get('skill')?.slice(0, 64) || undefined;
  const agentId = url.searchParams.get('agentId')?.slice(0, 100) || null;

  const exercises = listExercises(skill).map(toWireExercise);

  if (agentId) {
    const store = gym().store;
    for (const exercise of exercises) {
      const sessions = store
        .listSessions({ agentId, exerciseId: exercise.id })
        .filter((s) => s.status === 'completed');
      exercise.attempts = sessions.length;
      exercise.bestScore = sessions.reduce((best, s) => Math.max(best, s.score ?? 0), 0);
      exercise.lastScore = sessions[0]?.score;
    }
  }

  return json({ exercises });
}
