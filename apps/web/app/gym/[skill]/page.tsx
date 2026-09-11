import { notFound } from 'next/navigation';
import { getSkill } from '@gym/engine';
import { Shell } from '@/components/Shell';
import { ExerciseRack } from '@/components/ExerciseRack';

export default async function SkillPage({ params }: { params: Promise<{ skill: string }> }) {
  const { skill: skillId } = await params;
  const skill = getSkill(skillId);
  if (!skill || skill.status !== 'active') notFound();

  return (
    <Shell>
      <ExerciseRack skill={{ id: skill.id, name: skill.name, icon: skill.icon, blurb: skill.blurb }} />
    </Shell>
  );
}
