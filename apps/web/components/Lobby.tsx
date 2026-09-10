'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { useAgent } from './AgentContext';
import { Panel, Pill, Sparkline, Loading, scoreTone } from './ui';
import type { WireFitness, WireSkill } from '@/lib/dto';

export function Lobby() {
  const { agent } = useAgent();
  const [skills, setSkills] = useState<WireSkill[] | null>(null);
  const [fitness, setFitness] = useState<WireFitness | null>(null);

  useEffect(() => {
    api.skills().then((r) => setSkills(r.skills));
  }, []);

  useEffect(() => {
    if (!agent) return;
    setFitness(null);
    api.fitness(agent.id).then((r) => setFitness(r.fitness));
  }, [agent]);

  const toolUsage = fitness?.skills.find((s) => s.skill === 'tool_usage');

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-xl border border-line bg-panel/70 px-6 py-7">
        <div className="pointer-events-none absolute inset-0 opacity-40">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-agent/50 to-transparent" />
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-agent">Training floor</p>
        <h1 className="mt-2 max-w-2xl text-2xl font-semibold leading-snug text-ink">
          Agents come in, run exercises against a live sandbox, and get scored on what actually happened
          to the data.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-dim">
          Every workout is a real agent loop: the trainee picks tools, the environment pushes back with
          timeouts and stale indexes, a judge checks the database rather than the agent&apos;s summary, and a
          coach turns the verdict into one instruction for the next attempt.
        </p>
        <LoopDiagram />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-dim">Gyms</h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
              1 open · 5 in development
            </span>
          </div>
          {skills === null ? (
            <Loading label="mapping the floor" />
          ) : (
            <div className="relative">
              {/* The floor plane: a tilted grid the stations sit on. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-8 bottom-0 opacity-[0.35]"
                style={{
                  perspective: '900px',
                }}
              >
                <div
                  className="h-full w-full"
                  style={{
                    transform: 'rotateX(62deg)',
                    transformOrigin: 'center 20%',
                    backgroundImage:
                      'linear-gradient(var(--color-line-bright) 1px, transparent 1px), linear-gradient(90deg, var(--color-line-bright) 1px, transparent 1px)',
                    backgroundSize: '60px 60px',
                    maskImage: 'linear-gradient(to bottom, black, transparent 78%)',
                  }}
                />
              </div>
              <div className="relative grid gap-3 sm:grid-cols-2">
                {skills.map((skill) => (
                  <SkillStation key={skill.id} skill={skill} />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Panel title="Current athlete">
            {agent === null ? (
              <Loading label="no athlete selected" />
            ) : (
              <div className="px-4 py-4">
                <div className="flex items-center gap-3">
                  <div className="grid h-11 w-11 place-items-center rounded-lg border border-agent/40 bg-agent/10 text-lg">
                    🤖
                  </div>
                  <div>
                    <p className="text-sm font-medium text-ink">{agent.name}</p>
                    <p className="font-mono text-[10px] text-ink-faint">
                      {agent.provider} · {agent.model}
                    </p>
                  </div>
                </div>
                {fitness === null ? (
                  <Loading label="reading fitness" />
                ) : toolUsage ? (
                  <div className="mt-4 space-y-3">
                    <div className="flex items-end justify-between">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                          Tool usage
                        </p>
                        <p className={`font-mono text-2xl tabular-nums ${scoreTone(toolUsage.overall)}`}>
                          {toolUsage.overall}
                        </p>
                      </div>
                      <Sparkline values={toolUsage.history.map((h) => h.score)} width={110} height={28} />
                    </div>
                    <dl className="grid grid-cols-3 gap-2 border-t border-line pt-3 font-mono text-[10px]">
                      <Stat label="workouts" value={String(toolUsage.attempts)} />
                      <Stat label="pass rate" value={`${toolUsage.successRate}%`} />
                      <Stat label="best" value={String(toolUsage.bestScore)} />
                    </dl>
                    {toolUsage.weaknesses.length > 0 && (
                      <p className="text-[11px] text-ink-dim">
                        Weakest right now:{' '}
                        <span className="text-fail">{toolUsage.weaknesses.join(', ').replace(/_/g, ' ')}</span>
                      </p>
                    )}
                    <Link
                      href="/profile"
                      className="inline-block font-mono text-[10px] uppercase tracking-[0.16em] text-agent hover:underline"
                    >
                      full fitness profile →
                    </Link>
                  </div>
                ) : (
                  <p className="mt-4 text-[12px] leading-relaxed text-ink-dim">
                    No sessions on record. Enter the Tool Usage gym and run a workout to establish a
                    baseline.
                  </p>
                )}
              </div>
            )}
          </Panel>

          <Panel title="How scoring works">
            <div className="space-y-2.5 px-4 py-4 text-[12px] leading-relaxed text-ink-dim">
              <p>
                <span className="text-ink">Deterministic checks</span> read the sandbox database, the tool
                log and the agent&apos;s report. They decide pass or fail on their own.
              </p>
              <p>
                <span className="text-ink">Qualitative judgement</span> covers what a fact check cannot see:
                wasted calls, ignored failures, an unusable report.
              </p>
              <p className="font-mono text-[11px] text-ink-faint">
                dimension score = 75% facts + 25% judgement
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="uppercase tracking-[0.14em] text-ink-faint">{label}</dt>
      <dd className="mt-0.5 text-sm tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function SkillStation({ skill }: { skill: WireSkill }) {
  const open = skill.status === 'active';

  const body = (
    <div
      className={`group relative h-full overflow-hidden rounded-xl border p-4 transition-all ${
        open
          ? 'border-agent/40 bg-panel hover:border-agent hover:shadow-[0_0_28px_-8px_var(--color-agent)]'
          : 'border-line bg-panel/40'
      }`}
    >
      {open && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-16 animate-scan bg-gradient-to-b from-agent/10 to-transparent"
        />
      )}
      <div className="flex items-start justify-between gap-3">
        <span className={`text-2xl ${open ? '' : 'opacity-35 grayscale'}`}>{skill.icon}</span>
        {open ? <Pill tone="agent">open</Pill> : <Pill>locked</Pill>}
      </div>
      <h3 className={`mt-3 text-base font-medium ${open ? 'text-ink' : 'text-ink-faint'}`}>{skill.name}</h3>
      <p className={`mt-1 text-[12px] leading-relaxed ${open ? 'text-ink-dim' : 'text-ink-faint/70'}`}>
        {skill.blurb}
      </p>
      <div className="mt-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em]">
        <span className="text-ink-faint">
          {open ? `${skill.exerciseCount} workouts` : 'in development'}
        </span>
        {open && <span className="text-agent group-hover:underline">enter →</span>}
      </div>
    </div>
  );

  if (!open) {
    return (
      <div aria-disabled className="cursor-not-allowed">
        {body}
      </div>
    );
  }
  return <Link href={`/gym/${skill.id}`}>{body}</Link>;
}

function LoopDiagram() {
  const steps = [
    'Exercise',
    'Trainee',
    'Tool call',
    'Sandbox',
    'Result',
    'Judge',
    'Coach',
    'Retry',
  ];
  return (
    <ol className="mt-5 flex flex-wrap items-center gap-y-2 font-mono text-[10px] uppercase tracking-[0.16em]">
      {steps.map((step, index) => (
        <li key={step} className="flex items-center">
          <span
            className={`rounded border px-2 py-1 ${
              index === steps.length - 1
                ? 'border-coach/40 bg-coach/5 text-coach'
                : 'border-line bg-panel-2 text-ink-dim'
            }`}
          >
            {step}
          </span>
          {index < steps.length - 1 && <span className="px-1.5 text-ink-faint">›</span>}
        </li>
      ))}
    </ol>
  );
}
