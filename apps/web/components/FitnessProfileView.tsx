'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { useAgent } from './AgentContext';
import { Button, Loading, MetricBar, Panel, Pill, ScoreDial, Sparkline, UnmeasuredRow, scoreTone } from './ui';
import { DIMENSION_LABELS } from '@/lib/dto';
import type { WireFitness, WireSession, WireSkill } from '@/lib/dto';

const ALL_DIMENSIONS = [
  'accuracy',
  'tool_selection',
  'efficiency',
  'verification',
  'error_recovery',
  'safety',
  'reasoning',
  'planning',
  'communication',
];

export function FitnessProfileView() {
  const { agent } = useAgent();
  const [fitness, setFitness] = useState<WireFitness | null>(null);
  const [history, setHistory] = useState<WireSession[]>([]);
  const [skills, setSkills] = useState<WireSkill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.skills().then((r) => setSkills(r.skills));
  }, []);

  useEffect(() => {
    if (!agent) return;
    setLoading(true);
    Promise.all([api.fitness(agent.id), api.history(agent.id)])
      .then(([f, h]) => {
        setFitness(f.fitness);
        setHistory(h.sessions.filter((s) => s.status === 'completed'));
      })
      .finally(() => setLoading(false));
  }, [agent]);

  if (!agent) return <Loading label="no athlete selected" />;
  if (loading || !fitness) return <Loading label="reading fitness profile" />;

  const toolUsage = fitness.skills.find((s) => s.skill === 'tool_usage');
  const chronological = [...history].reverse();

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="grid h-12 w-12 place-items-center rounded-xl border border-agent/40 bg-agent/10 text-2xl">
            🤖
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-ink">{agent.name}</h1>
            <p className="font-mono text-[11px] text-ink-faint">
              {agent.provider} · {agent.model} · budget {agent.maxSteps} tool calls
            </p>
          </div>
        </div>
        <Button href="/gym/tool_usage">Train</Button>
      </header>

      {toolUsage === undefined ? (
        <Panel title="Agent fitness">
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-ink-dim">
              This athlete has never trained. Run a workout to establish a baseline.
            </p>
            <div className="mt-4">
              <Button href="/gym/tool_usage">Enter the tool gym</Button>
            </div>
          </div>
        </Panel>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
            <Panel title="Overall">
              <div className="flex flex-col items-center gap-3 px-5 py-5">
                <ScoreDial score={toolUsage.overall} label="tool usage" />
                <dl className="grid w-full grid-cols-3 gap-2 border-t border-line pt-3 text-center font-mono">
                  <Stat label="workouts" value={String(toolUsage.attempts)} />
                  <Stat label="pass rate" value={`${toolUsage.successRate}%`} />
                  <Stat label="best" value={String(toolUsage.bestScore)} />
                </dl>
              </div>
            </Panel>

            <Panel title="Capability dimensions" right={<Pill>never one number</Pill>}>
              <div className="px-4 py-3.5">
                {ALL_DIMENSIONS.map((dimension) => {
                  const stat = toolUsage.dimensions[dimension];
                  return stat ? (
                    <MetricBar
                      key={dimension}
                      dimension={dimension}
                      score={stat.current}
                      trend={stat.trend}
                    />
                  ) : (
                    <UnmeasuredRow key={dimension} dimension={dimension} />
                  );
                })}
                <p className="mt-3 border-t border-line pt-2.5 font-mono text-[10px] leading-relaxed text-ink-faint">
                  A dashed row is a dimension the Tool Usage gym does not measure. It stays empty rather than
                  being guessed at; the gym that measures it is not open yet.
                </p>
              </div>
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Workout history">
              <div className="px-4 py-4">
                {chronological.length > 0 && (
                  <div className="mb-3 flex items-end gap-4">
                    <Sparkline values={chronological.map((s) => s.score ?? 0)} width={220} height={44} />
                    <span className="font-mono text-[11px] text-ink-faint">
                      {chronological.map((s) => s.score).join(' → ')}
                    </span>
                  </div>
                )}
                <ul className="divide-y divide-line">
                  {history.slice(0, 10).map((session) => (
                    <li key={session.id}>
                      <Link
                        href={`/sessions/${session.id}`}
                        className="flex items-center justify-between gap-3 py-2 transition-colors hover:text-ink"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[12.5px] text-ink">
                            {session.exerciseTitle}
                          </span>
                          <span className="font-mono text-[10px] text-ink-faint">
                            {session.exerciseId} · attempt {session.attempt}
                            {session.guidanceRules.length > 0
                              ? ` · ${session.guidanceRules.length} coaching rule${session.guidanceRules.length === 1 ? '' : 's'}`
                              : ' · uncoached'}
                          </span>
                        </span>
                        <span className={`font-mono text-[13px] tabular-nums ${scoreTone(session.score ?? 0)}`}>
                          {session.score}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>

            <div className="space-y-4">
              <Panel title="Current weaknesses">
                <div className="px-4 py-4">
                  {toolUsage.weaknesses.length === 0 ? (
                    <p className="text-[12.5px] text-ink-dim">
                      Nothing below the weakness threshold. Move up a difficulty level.
                    </p>
                  ) : (
                    <ol className="space-y-2">
                      {toolUsage.weaknesses.map((dimension, index) => (
                        <li key={dimension} className="flex items-center gap-3">
                          <span className="font-mono text-[11px] text-ink-faint">{index + 1}</span>
                          <span className="flex-1 text-[13px] text-ink">
                            {DIMENSION_LABELS[dimension] ?? dimension}
                          </span>
                          <span className="font-mono text-[12px] tabular-nums text-fail">
                            {toolUsage.dimensions[dimension]?.current}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </Panel>

              <Panel title="Recommended by the coach">
                <div className="px-4 py-4">
                  {toolUsage.recommended.length === 0 ? (
                    <p className="text-[12.5px] text-ink-dim">No open recommendations.</p>
                  ) : (
                    <ul className="space-y-2">
                      {toolUsage.recommended.map((drill) => (
                        <li key={drill.exerciseId}>
                          <Link
                            href={`/gym/tool_usage/${drill.exerciseId}`}
                            className="block rounded-lg border border-line bg-panel-2 px-3 py-2 transition-colors hover:border-coach/50"
                          >
                            <span className="font-mono text-[10px] text-ink-faint">
                              {drill.exerciseId} · level {drill.difficulty}
                            </span>
                            <span className="block text-[13px] text-ink">{drill.title}</span>
                            <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-dim">
                              {drill.reason}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Panel>
            </div>
          </div>
        </>
      )}

      <Panel title="Other capabilities">
        <div className="grid gap-2 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
          {skills
            .filter((s) => s.status !== 'active')
            .map((skill) => (
              <div
                key={skill.id}
                className="flex items-center justify-between rounded-lg border border-line bg-panel-2/60 px-3 py-2.5"
              >
                <span className="flex items-center gap-2 text-[13px] text-ink-faint">
                  <span className="opacity-40 grayscale">{skill.icon}</span>
                  {skill.name}
                </span>
                <span className="font-mono text-[11px] text-ink-faint">--</span>
              </div>
            ))}
        </div>
      </Panel>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[9px] uppercase tracking-[0.14em] text-ink-faint">{label}</dt>
      <dd className="mt-0.5 text-[15px] tabular-nums text-ink">{value}</dd>
    </div>
  );
}
