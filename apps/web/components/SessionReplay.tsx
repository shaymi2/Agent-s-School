'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/client';
import { deriveStage, GymFloor } from './GymFloor';
import { Timeline } from './Timeline';
import { Button, Loading, MetricBar, Panel, Pill, ScoreDial, scoreTone } from './ui';
import type { WireExercise, WireSessionDetail } from '@/lib/dto';

/**
 * Replay.
 *
 * The stored event stream is enough to reconstruct the whole session, so this
 * view is the arena driven from the database instead of from a live run.
 */
export function SessionReplay({ sessionId }: { sessionId: string }) {
  const [detail, setDetail] = useState<WireSessionDetail | null>(null);
  const [exercise, setExercise] = useState<WireExercise | null>(null);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.session(sessionId).then((d) => {
      setDetail(d);
      setCursor(d.events.length);
      fetch(`/api/exercises/${d.session.exerciseId}`)
        .then((r) => r.json())
        .then((r: { exercise: WireExercise }) => setExercise(r.exercise));
    });
  }, [sessionId]);

  const total = detail?.events.length ?? 0;

  const step = useCallback(() => {
    setCursor((current) => {
      if (current >= total) {
        setPlaying(false);
        return current;
      }
      return current + 1;
    });
  }, [total]);

  useEffect(() => {
    if (!playing) return;
    timer.current = setTimeout(step, 520 / speed);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [playing, cursor, speed, step]);

  const shown = useMemo(() => detail?.events.slice(0, cursor) ?? [], [detail, cursor]);
  const stage = useMemo(
    () => deriveStage(shown, exercise?.availableTools ?? []),
    [shown, exercise],
  );

  if (!detail) return <Loading label="loading session" />;

  const { session, evaluation, feedback } = detail;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/profile"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint hover:text-ink-dim"
          >
            ← fitness
          </Link>
          <h1 className="mt-1.5 text-2xl font-semibold text-ink">{session.exerciseTitle}</h1>
          <p className="mt-1 font-mono text-[11px] text-ink-faint">
            {session.id} · {session.agentName} · attempt {session.attempt} ·{' '}
            {new Date(session.startedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {evaluation && (
            <Pill tone={evaluation.success ? 'pass' : 'fail'}>
              {evaluation.success ? 'passed' : 'failed'} · {evaluation.score}
            </Pill>
          )}
          {exercise && <Button href={`/gym/${session.skill}/${session.exerciseId}`}>Run it again</Button>}
        </div>
      </header>

      {session.guidanceRules.length > 0 && (
        <Panel title="Coaching this attempt carried in">
          <ul className="space-y-1.5 px-4 py-3">
            {session.guidanceRules.map((rule) => (
              <li key={rule} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-dim">
                <span className="text-coach">›</span>
                {rule}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          {exercise && (
            <GymFloor
              stage={stage}
              agentName={session.agentName}
              task={exercise.task}
              optimalToolCalls={exercise.optimalToolCalls}
              running={playing}
            />
          )}
          <Panel title="Replay controls">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  if (cursor >= total) setCursor(0);
                  setPlaying((p) => !p);
                }}
                className="rounded-md border border-agent/50 bg-agent/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-agent hover:bg-agent/20"
              >
                {playing ? 'pause' : cursor >= total ? 'replay session' : 'play'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPlaying(false);
                  setCursor(0);
                }}
                className="rounded-md border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint hover:text-ink-dim"
              >
                reset
              </button>
              <input
                type="range"
                min={0}
                max={total}
                value={cursor}
                onChange={(event) => {
                  setPlaying(false);
                  setCursor(Number(event.target.value));
                }}
                className="h-1 flex-1 accent-agent"
              />
              <span className="font-mono text-[10px] tabular-nums text-ink-faint">
                {cursor}/{total}
              </span>
              <select
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
                className="rounded-md border border-line bg-panel px-2 py-1 font-mono text-[10px] text-ink-dim"
              >
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
                <option value={4}>4×</option>
              </select>
            </div>
          </Panel>

          {session.finalResponse && (
            <Panel title="Final report from the agent">
              <pre className="whitespace-pre-wrap px-4 py-3 font-mono text-[11.5px] leading-relaxed text-ink-dim">
                {session.finalResponse}
              </pre>
            </Panel>
          )}
        </div>

        <div className="space-y-4">
          <Panel title="Event stream">
            <Timeline events={shown} />
          </Panel>

          {evaluation && exercise && (
            <Panel title="Scorecard">
              <div className="flex flex-col items-center gap-4 px-4 py-4">
                <ScoreDial
                  score={evaluation.score}
                  delta={detail.previousScore === null ? null : evaluation.score - detail.previousScore}
                />
                <div className="w-full">
                  {Object.entries(exercise.evaluation).map(([dimension, weight]) => (
                    <MetricBar
                      key={dimension}
                      dimension={dimension}
                      score={evaluation.metrics[dimension] ?? 0}
                      weight={weight}
                    />
                  ))}
                </div>
              </div>
            </Panel>
          )}

          {feedback && (
            <Panel title="Coach">
              <div className="px-4 py-3.5">
                <p className={`text-[14px] font-medium ${scoreTone(evaluation?.score ?? 0)}`}>
                  {feedback.headline}
                </p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-dim">{feedback.message}</p>
              </div>
            </Panel>
          )}

          {evaluation && (
            <Panel
              title="Checks"
              right={
                <span className="font-mono text-[10px] text-ink-faint">
                  {evaluation.deterministic.passed}/{
                    evaluation.deterministic.passed + evaluation.deterministic.failed
                  }
                </span>
              }
            >
              <ul className="divide-y divide-line">
                {evaluation.deterministic.results.map((check) => (
                  <li key={check.id} className="flex gap-2.5 px-4 py-2">
                    <span className={`font-mono text-[11px] ${check.passed ? 'text-pass' : 'text-fail'}`}>
                      {check.passed ? '✓' : '✕'}
                    </span>
                    <span className="text-[12px] text-ink-dim">{check.description}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
