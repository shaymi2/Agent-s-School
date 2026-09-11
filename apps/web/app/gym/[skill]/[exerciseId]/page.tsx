import { notFound } from 'next/navigation';
import { getExercise } from '@gym/engine';
import { Shell } from '@/components/Shell';
import { Arena } from '@/components/Arena';
import { toWireExercise } from '@/lib/serialize';

export default async function ArenaPage({
  params,
}: {
  params: Promise<{ skill: string; exerciseId: string }>;
}) {
  const { skill, exerciseId } = await params;
  const exercise = getExercise(exerciseId);
  if (!exercise || exercise.skill !== skill) notFound();

  return (
    <Shell>
      <Arena exercise={toWireExercise(exercise)} />
    </Shell>
  );
}
