'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, useWorkout } from '@/lib/client';
import { useAgent } from './AgentContext';
import { deriveStage, GymFloor } from './GymFloor';
import { Timeline } from './Timeline';
import { Results } from './Results';
import { Button, Difficulty, Panel, Pill, Sparkline, scoreTone } from './ui';
import type { WireExercise, WireSession } from '@/lib/dto';

export function Arena({ exercise }: { exercise: WireExercise }) {
  const { agent } = useAgent();
  const workout = useWorkout();
  const [history, setHistory] = useState<WireSession[]>([]);
  const [neighbours, setNeighbours] = useState<WireExercise[]>([]);
  const [fresh, setFresh] = useState(false);

  const loadHistory = useCallback(() => {
    if (!agent) return;
    api.history(agent.id).then(({ sessions }) => {
      setHistory(sessions.filter((s) => s.exerciseId === exercise.id && s.status === 'completed'));
    });
  }, [agent, exercise.id]);

  useEffect(loadHistory, [loadHistory]);

  useEffect(() => {
    api.exercises(exercise.skill).then((r) => setNeighbours(r.exercises));
  }, [exercise.skill]);

  useEffect(() => {
    if (workout.phase === 'complete') loadHistory();
  }, [workout.phase, loadHistory]);

  const stage = useMemo(
    () => deriveStage(workout.events, exercise.availableTools),
    [workout.events, exercise.availableTools],
  );

  const running = workout.phase === 'starting' || workout.phase === 'running' || workout.phase === 'evaluating';
  const attemptNumber = history.length + (workout.phase === 'complete' ? 0 : 1);

  const nextExerciseId = useMemo(() => {
    const ordered = [...neighbours].sort(
      (a, b) => a.difficulty - b.difficulty || a.id.localeCompare(b.id),
    );
    const index = ordered.findIndex((e) => e.id === exercise.id);
    return index >= 0 && index < ordered.length - 1 ? ordered[index + 1].id : null;
  }, [neighbours, exercise.id]);

  const start = useCallback(() => {
    if (!agent) return;
    workout.run(agent.id, exercise.id, fresh);
  }, [agent, exercise.id, fresh, workout]);

  const previousScores = history.map((s) => s.score ?? 0).reverse();

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href={`/gym/${exercise.skill}`}
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint hover:text-ink-dim"
          >
            ← tool gym
          </Link>
          <h1 className="mt-1.5 text-2xl font-semibold text-ink">{exercise.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Difficulty level={exercise.difficulty} />
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
              {exercise.id}
            </span>
            {exercise.tags.map((tag) => (
              <Pill key={tag}>{tag.replace(/_/g, ' ')}</Pill>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {previousScores.length > 0 && (
            <div className="text-right">
              <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink-faint">
                your attempts
              </p>
              <Sparkline values={previousScores} width={110} height={26} />
            </div>
          )}
          <label className="flex cursor-pointer items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
            <input
              type="checkbox"
              checked={fresh}
              onChange={(event) => setFresh(event.target.checked)}
              className="accent-agent"
            />
            ignore coaching
          </label>
          <Button onClick={start} disabled={!agent || running}>
            {running ? 'running…' : previousScores.length > 0 ? 'run again' : 'start workout'}
          </Button>
        </div>
      </header>

      {workout.error && (
        <div className="rounded-lg border border-fail/40 bg-fail/10 px-4 py-3 font-mono text-[12px] text-fail">
          {workout.error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <GymFloor
          stage={stage}
          agentName={agent?.name ?? 'No athlete'}
          task={exercise.task}
          optimalToolCalls={exercise.optimalToolCalls}
          running={running}
          toolBudget={agent?.maxSteps}
        />

        <div className="space-y-4">
          <Panel
            title="Live activity"
            right={
              <span
                className={`font-mono text-[10px] uppercase tracking-[0.14em] ${
                  running ? 'text-agent' : 'text-ink-faint'
                }`}
              >
                {running ? '● streaming' : workout.phase === 'complete' ? 'complete' : 'idle'}
              </span>
            }
          >
            <Timeline events={workout.events} />
          </Panel>

          <Panel title="This workout">
            <dl className="space-y-2 px-4 py-3.5 text-[12px]">
              <Row label="Attempt">{attemptNumber}</Row>
              <Row label="Tools">{exercise.availableTools.join(', ')}</Row>
              <Row label="Target calls">{exercise.optimalToolCalls}</Row>
              <Row label="Scored on">
                {Object.entries(exercise.evaluation)
                  .map(([d, w]) => `${d.replace(/_/g, ' ')} ${w}`)
                  .join(' · ')}
              </Row>
              <Row label="Tests">{exercise.intent}</Row>
            </dl>
          </Panel>

          {history.length > 0 && (
            <Panel title="Previous attempts">
              <ul className="divide-y divide-line">
                {history.slice(0, 6).map((session) => (
                  <li key={session.id}>
                    <Link
                      href={`/sessions/${session.id}`}
                      className="flex items-center justify-between px-4 py-2 transition-colors hover:bg-panel-2"
                    >
                      <span className="font-mono text-[11px] text-ink-faint">
                        attempt {session.attempt}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className={`font-mono text-[12px] tabular-nums ${scoreTone(session.score ?? 0)}`}>
                          {session.score}
                        </span>
                        <Pill tone={session.success ? 'pass' : 'fail'}>
                          {session.success ? 'pass' : 'fail'}
                        </Pill>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      {workout.phase === 'complete' && workout.detail?.evaluation && (
        <Results
          evaluation={workout.detail.evaluation}
          feedback={workout.detail.feedback}
          exercise={exercise}
          previousScore={workout.detail.previousScore}
          sessionId={workout.detail.session.id}
          attempt={workout.detail.session.attempt}
          onRetry={start}
          nextExerciseId={nextExerciseId}
        />
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink-faint">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-ink-dim">{children}</dd>
    </div>
  );
}
