'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/client';
import { useAgent } from './AgentContext';
import { Difficulty, Loading, Panel, Pill, scoreTone } from './ui';
import { DIFFICULTY_LABELS } from '@/lib/dto';
import type { WireExercise } from '@/lib/dto';

export function ExerciseRack({
  skill,
}: {
  skill: { id: string; name: string; icon: string; blurb: string };
}) {
  const { agent } = useAgent();
  const [exercises, setExercises] = useState<WireExercise[] | null>(null);
  const [level, setLevel] = useState<number | null>(null);

  useEffect(() => {
    setExercises(null);
    api.exercises(skill.id, agent?.id).then((r) => setExercises(r.exercises));
  }, [skill.id, agent?.id]);

  const shown = useMemo(
    () => (exercises ?? []).filter((e) => level === null || e.difficulty === level),
    [exercises, level],
  );

  const levels = useMemo(
    () => [...new Set((exercises ?? []).map((e) => e.difficulty))].sort((a, b) => a - b),
    [exercises],
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint hover:text-ink-dim"
          >
            ← lobby
          </Link>
          <h1 className="mt-1.5 flex items-center gap-3 text-2xl font-semibold text-ink">
            <span>{skill.icon}</span> {skill.name} Gym
          </h1>
          <p className="mt-1 max-w-xl text-sm text-ink-dim">{skill.blurb}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip active={level === null} onClick={() => setLevel(null)}>
            all levels
          </FilterChip>
          {levels.map((value) => (
            <FilterChip key={value} active={level === value} onClick={() => setLevel(value)}>
              {value} · {DIFFICULTY_LABELS[value]}
            </FilterChip>
          ))}
        </div>
      </header>

      {exercises === null ? (
        <Loading label="racking the workouts" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {shown.map((exercise) => (
            <ExerciseCard key={exercise.id} exercise={exercise} skillId={skill.id} />
          ))}
        </div>
      )}

      <Panel title="What the levels mean">
        <div className="grid gap-x-6 gap-y-2 px-4 py-4 text-[12px] text-ink-dim sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['1 Basic', 'One tool, one answer.'],
            ['2 Sequential', 'Chain tools; a summary is not the record.'],
            ['3 Verification', 'Read before you write.'],
            ['4 Recovery', 'The API fails. Keep going anyway.'],
            ['5 Ambiguity', 'More than one record matches.'],
            ['6 Adversarial', 'Sources disagree, or the instruction is wrong.'],
          ].map(([label, note]) => (
            <p key={label}>
              <span className="font-mono text-[11px] text-ink">{label}</span>
              <span className="ml-2">{note}</span>
            </p>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function FilterChip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors ${
        active
          ? 'border-agent/50 bg-agent/10 text-agent'
          : 'border-line text-ink-faint hover:border-line-bright hover:text-ink-dim'
      }`}
    >
      {children}
    </button>
  );
}

function ExerciseCard({ exercise, skillId }: { exercise: WireExercise; skillId: string }) {
  const attempted = (exercise.attempts ?? 0) > 0;

  return (
    <Link
      href={`/gym/${skillId}/${exercise.id}`}
      className="group flex h-full flex-col rounded-xl border border-line bg-panel p-4 transition-all hover:border-agent/50 hover:shadow-[0_0_24px_-10px_var(--color-agent)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">{exercise.id}</p>
          <h3 className="mt-0.5 text-[15px] font-medium text-ink">{exercise.title}</h3>
        </div>
        {attempted ? (
          <div className="text-right">
            <p className={`font-mono text-lg tabular-nums ${scoreTone(exercise.bestScore ?? 0)}`}>
              {exercise.bestScore}
            </p>
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">
              best · {exercise.attempts} run{exercise.attempts === 1 ? '' : 's'}
            </p>
          </div>
        ) : (
          <Pill>new</Pill>
        )}
      </div>

      <p className="mt-2.5 line-clamp-2 text-[12px] leading-relaxed text-ink-dim">{exercise.task}</p>

      <div className="mt-auto flex items-center justify-between gap-3 pt-3.5">
        <Difficulty level={exercise.difficulty} />
        <span className="flex gap-1 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-faint">
          {exercise.availableTools.map((tool) => (
            <span key={tool} className="rounded border border-line px-1.5 py-0.5">
              {tool.replace('_customer', '')}
            </span>
          ))}
        </span>
      </div>
    </Link>
  );
}
