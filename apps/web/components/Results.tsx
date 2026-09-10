'use client';

import Link from 'next/link';
import { Button, MetricBar, Panel, Pill, ScoreDial } from './ui';
import type { WireCoachFeedback, WireEvaluation, WireExercise } from '@/lib/dto';

export function Results({
  evaluation,
  feedback,
  exercise,
  previousScore,
  sessionId,
  attempt,
  onRetry,
  nextExerciseId,
}: {
  evaluation: WireEvaluation;
  feedback: WireCoachFeedback | null;
  exercise: WireExercise;
  previousScore: number | null;
  sessionId: string;
  attempt: number;
  onRetry: () => void;
  nextExerciseId: string | null;
}) {
  const delta = previousScore === null ? null : evaluation.score - previousScore;
  const weighted = Object.entries(exercise.evaluation);
  const extra = Object.entries(evaluation.metrics).filter(([d]) => exercise.evaluation[d] === undefined);

  return (
    <div className="space-y-4">
      <Panel
        title="Workout complete"
        right={
          <Pill tone={evaluation.success ? 'pass' : 'fail'}>{evaluation.success ? 'passed' : 'failed'}</Pill>
        }
      >
        <div className="flex flex-col gap-6 px-5 py-5 md:flex-row md:items-center">
          <div className="flex flex-col items-center gap-1">
            <ScoreDial score={evaluation.score} delta={delta} />
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
              attempt {attempt}
              {delta !== null && (
                <span className={delta >= 0 ? 'text-pass' : 'text-fail'}>
                  {' '}
                  · {delta >= 0 ? '+' : ''}
                  {delta} vs last
                </span>
              )}
            </p>
          </div>

          <div className="min-w-0 flex-1">
            {weighted.map(([dimension, weight]) => (
              <MetricBar
                key={dimension}
                dimension={dimension}
                score={evaluation.metrics[dimension] ?? 0}
                weight={weight}
              />
            ))}
            {extra.length > 0 && (
              <div className="mt-3 border-t border-line pt-2">
                <p className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink-faint">
                  measured, not scored in this workout
                </p>
                {extra.map(([dimension, score]) => (
                  <MetricBar key={dimension} dimension={dimension} score={score} />
                ))}
              </div>
            )}
          </div>
        </div>
      </Panel>

      {feedback && (
        <Panel
          title="Coach"
          right={<Pill tone="coach">{feedback.source === 'llm' ? 'model' : 'rule-based'}</Pill>}
        >
          <div className="px-5 py-4">
            <p className="text-[15px] font-medium text-coach">{feedback.headline}</p>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">{feedback.message}</p>

            {feedback.guidance.rules.length > 0 && (
              <div className="mt-4 rounded-lg border border-coach/25 bg-coach/5 px-3.5 py-3">
                <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-coach">
                  carried into your next attempt
                </p>
                <ul className="mt-2 space-y-1.5">
                  {feedback.guidance.rules.map((rule) => (
                    <li key={rule} className="flex gap-2 text-[12px] leading-relaxed text-ink-dim">
                      <span className="text-coach">›</span>
                      {rule}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {feedback.drills.length > 0 && (
              <div className="mt-4">
                <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-ink-faint">
                  recommended workouts
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {feedback.drills.map((drill) => (
                    <Link
                      key={drill.exerciseId}
                      href={`/gym/tool_usage/${drill.exerciseId}`}
                      className="rounded-lg border border-line bg-panel-2 px-3 py-2 transition-colors hover:border-coach/50"
                    >
                      <span className="font-mono text-[10px] text-ink-faint">
                        {drill.exerciseId} · L{drill.difficulty}
                      </span>
                      <span className="block text-[12px] text-ink">{drill.title}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Deterministic checks"
          right={
            <span className="font-mono text-[10px] text-ink-faint">
              {evaluation.deterministic.passed} passed · {evaluation.deterministic.failed} failed
            </span>
          }
        >
          <ul className="divide-y divide-line">
            {evaluation.deterministic.results.map((check) => (
              <li key={check.id} className="flex gap-3 px-4 py-2.5">
                <span className={`mt-0.5 font-mono text-[11px] ${check.passed ? 'text-pass' : 'text-fail'}`}>
                  {check.passed ? '✓' : '✕'}
                </span>
                <span className="min-w-0">
                  <span className="text-[12.5px] text-ink">{check.description}</span>
                  {check.required && (
                    <span className="ml-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">
                      required
                    </span>
                  )}
                  <span className="mt-0.5 block font-mono text-[10.5px] leading-relaxed text-ink-faint">
                    {check.detail}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          title="Judge notes"
          right={
            <span className="font-mono text-[10px] text-ink-faint">
              {evaluation.qualitative.source === 'llm'
                ? (evaluation.qualitative.model ?? 'model')
                : 'measured proxies'}
            </span>
          }
        >
          <div className="space-y-3 px-4 py-3.5">
            {evaluation.strengths.length > 0 && (
              <div>
                <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-pass">strengths</p>
                <ul className="mt-1 space-y-1">
                  {evaluation.strengths.map((item) => (
                    <li key={item} className="text-[12px] leading-relaxed text-ink-dim">
                      · {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {evaluation.mistakes.length > 0 && (
              <div>
                <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-fail">mistakes</p>
                <ul className="mt-1 space-y-1">
                  {evaluation.mistakes.map((item) => (
                    <li key={item} className="text-[12px] leading-relaxed text-ink-dim">
                      · {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {evaluation.strengths.length === 0 && evaluation.mistakes.length === 0 && (
              <p className="text-[12px] text-ink-faint">Nothing flagged.</p>
            )}
          </div>
        </Panel>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onRetry}>Retry with coaching</Button>
        {nextExerciseId && (
          <Button href={`/gym/tool_usage/${nextExerciseId}`} tone="ghost">
            Next workout
          </Button>
        )}
        <Button href={`/sessions/${sessionId}`} tone="ghost">
          View session
        </Button>
        <Button href="/profile" tone="ghost">
          Fitness profile
        </Button>
        <Button href="/gym/tool_usage" tone="ghost">
          Back to gym
        </Button>
      </div>
    </div>
  );
}
