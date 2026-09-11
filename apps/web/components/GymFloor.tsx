'use client';

import { useEffect, useRef, useState } from 'react';
import { AgentSprite, CoachSprite } from './AgentSprite';
import type { AgentPose, CoachMood } from './AgentSprite';
import type { WireEvent } from '@/lib/dto';

export type ToolState = 'idle' | 'active' | 'ok' | 'error';

export interface StageState {
  agentState: 'waiting' | 'working' | 'reporting' | 'judged';
  activeTool: string | null;
  toolStates: Record<string, ToolState>;
  environmentFlash: { kind: string; tool: string } | null;
  toolCalls: number;
  score: number | null;
  success: boolean | null;
  coachLine: string | null;
  task: string | null;
  /** Sequence number of the most recent tool failure, or -1. Keys the stagger. */
  errorAt: number;
  /** Sequence number of the most recent injected event, or -1. Keys the hit. */
  environmentAt: number;
  /** The machine the agent last used. It waits there rather than walking home. */
  lastTool: string | null;
}

const TOOL_ICONS: Record<string, string> = {
  search_customer: '🔎',
  get_customer: '👤',
  update_customer: '✏️',
};

const TOOL_LABELS: Record<string, string> = {
  search_customer: 'Search',
  get_customer: 'Record',
  update_customer: 'Update',
};

/**
 * Derives the stage from the event stream.
 *
 * Every visual state below is a function of an event that really happened.
 * Nothing on this floor animates on a timer, with one exception: the resting
 * bob, which is what standing still looks like.
 */
export function deriveStage(events: WireEvent[], tools: string[]): StageState {
  const toolStates: Record<string, ToolState> = Object.fromEntries(tools.map((t) => [t, 'idle']));
  let agentState: StageState['agentState'] = 'waiting';
  let activeTool: string | null = null;
  let environmentFlash: StageState['environmentFlash'] = null;
  let toolCalls = 0;
  let score: number | null = null;
  let success: boolean | null = null;
  let coachLine: string | null = null;
  let task: string | null = null;
  let errorAt = -1;
  let environmentAt = -1;
  let lastTool: string | null = null;

  for (const event of events) {
    const p = event.payload as Record<string, unknown>;
    switch (event.type) {
      case 'TASK_RECEIVED':
        task = String(p.task ?? '');
        agentState = 'working';
        break;
      case 'TOOL_CALL_STARTED': {
        const call = p.call as { name: string };
        activeTool = call.name;
        lastTool = call.name;
        toolStates[call.name] = 'active';
        toolCalls += 1;
        agentState = 'working';
        break;
      }
      case 'TOOL_CALL_COMPLETED': {
        const call = p.call as { name: string };
        toolStates[call.name] = 'ok';
        activeTool = null;
        break;
      }
      case 'TOOL_ERROR': {
        const call = p.call as { name: string };
        toolStates[call.name] = 'error';
        activeTool = null;
        errorAt = event.seq;
        break;
      }
      case 'ENVIRONMENT_EVENT':
        environmentFlash = { kind: String(p.kind), tool: String(p.tool) };
        environmentAt = event.seq;
        break;
      case 'AGENT_RESPONSE':
        agentState = 'reporting';
        activeTool = null;
        break;
      case 'EVALUATION_COMPLETED':
        score = Number(p.score);
        success = Boolean(p.success);
        agentState = 'judged';
        break;
      case 'COACH_FEEDBACK':
        coachLine = String(p.message ?? p.headline ?? '');
        break;
      default:
        break;
    }
  }

  return {
    agentState,
    activeTool,
    toolStates,
    environmentFlash,
    toolCalls,
    score,
    success,
    coachLine,
    task,
    errorAt,
    environmentAt,
    lastTool,
  };
}

/** Where each station stands on the floor, as a percentage of the stage. */
function stationLayout(tools: string[]): Array<{ name: string; x: number; y: number }> {
  const spread: Record<number, number[]> = {
    1: [50],
    2: [33, 67],
    3: [18, 50, 82],
    4: [14, 38, 62, 86],
  };
  const xs = spread[tools.length] ?? tools.map((_, i) => (100 / (tools.length + 1)) * (i + 1));
  return tools.map((name, index) => ({
    name,
    x: xs[index],
    // The middle station sits a little further back, which reads as depth.
    y: tools.length === 3 && index === 1 ? 14 : 20,
  }));
}

/**
 * The machines stand in a row along the back of the floor and the agent walks
 * a lane in front of them, so a body never covers the console it is using.
 */
const LANE_Y = 62;
const HOME_X = 50;

/**
 * Tracks where the sprite actually is, and whether it is genuinely in transit.
 *
 * This is the part that keeps the animation honest. The walking pose is set
 * from a transform transition that is really running, not from the fact that
 * we would like the agent to be moving, so the legs cannot cycle on the spot.
 */
function useTravel(targetX: number, targetY: number) {
  const [rendered, setRendered] = useState({ x: targetX, y: targetY });
  const [moving, setMoving] = useState(false);
  const [facing, setFacing] = useState<1 | -1>(1);
  const previous = useRef({ x: targetX, y: targetY });

  // Depends on the coordinates rather than an object, so a re-render with the
  // same destination does not look like a move.
  useEffect(() => {
    const from = previous.current;
    const distance = Math.hypot(targetX - from.x, targetY - from.y);
    if (distance < 0.5) return;

    if (Math.abs(targetX - from.x) > 1) setFacing(targetX > from.x ? 1 : -1);
    previous.current = { x: targetX, y: targetY };
    setMoving(true);
    setRendered({ x: targetX, y: targetY });
  }, [targetX, targetY]);

  return {
    rendered,
    moving,
    facing,
    settle: () => setMoving(false),
  };
}

export function GymFloor({
  stage,
  agentName,
  task,
  optimalToolCalls,
  running,
  toolBudget,
}: {
  stage: StageState;
  agentName: string;
  task: string;
  optimalToolCalls: number;
  running: boolean;
  toolBudget?: number;
}) {
  const stations = stationLayout(Object.keys(stage.toolStates));

  /*
   * A tool failure knocks the agent back.
   *
   * This is adjusted during render rather than in an effect on purpose. The
   * failure and the decision to walk away arrive in the same batch of events,
   * so an effect would set the walk going on one commit and the knock-back on
   * the next, and the agent would stagger while sliding across the floor.
   */
  const [lastError, setLastError] = useState(-1);
  const [staggering, setStaggering] = useState(false);
  if (stage.errorAt !== lastError) {
    setLastError(stage.errorAt);
    setStaggering(stage.errorAt >= 0);
  }
  useEffect(() => {
    if (!staggering) return;
    const timer = setTimeout(() => setStaggering(false), 560);
    return () => clearTimeout(timer);
  }, [staggering]);

  // An athlete moves between machines, and only walks back to the middle of
  // the floor once it has finished. While it is being knocked back it holds
  // its ground, so the recovery is visible before it moves off.
  const finished = stage.agentState === 'reporting' || stage.agentState === 'judged';
  const standingAt = staggering
    ? stage.lastTool
    : (stage.activeTool ?? (finished ? null : stage.lastTool));
  const station = standingAt ? stations.find((s) => s.name === standingAt) : undefined;
  const targetX = station ? station.x : HOME_X;
  const travel = useTravel(targetX, LANE_Y);

  const pose = choosePose(stage, travel.moving, staggering);
  const mood = chooseMood(stage, staggering);
  const budget = toolBudget ?? Math.max(optimalToolCalls * 2, stage.toolCalls);

  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-panel">
      <div className="relative px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex max-w-sm items-start gap-2.5">
            <CoachSprite mood={mood} />
            <div className="min-w-0 pt-1">
              <p className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-coach">Coach</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-ink-dim">
                {stage.coachLine ??
                  (running
                    ? 'Watching. I score the run, not the story you tell about it.'
                    : 'Start the workout when you are ready.')}
              </p>
            </div>
          </div>
          <StatusReadout stage={stage} optimalToolCalls={optimalToolCalls} />
        </div>

        {/* ------------------------------------------------------- the floor */}
        <div className="relative mt-3 h-[330px] w-full">
          <div aria-hidden className="absolute inset-0" style={{ perspective: '620px' }}>
            <div
              className="absolute inset-x-[-25%] bottom-[-34%] top-[16%] opacity-30"
              style={{
                transform: 'rotateX(64deg)',
                backgroundImage:
                  'linear-gradient(var(--color-line-bright) 1px, transparent 1px), linear-gradient(90deg, var(--color-line-bright) 1px, transparent 1px)',
                backgroundSize: '46px 46px',
                maskImage: 'linear-gradient(to top, black 40%, transparent 92%)',
              }}
            />
          </div>

          {stations.map((station) => (
            <ToolStation
              key={station.name}
              name={station.name}
              state={stage.toolStates[station.name]}
              x={station.x}
              y={station.y}
              hit={stage.environmentFlash?.tool === station.name ? stage.environmentAt : -1}
              hitKind={stage.environmentFlash?.kind ?? ''}
              busy={stage.activeTool === station.name && !travel.moving}
            />
          ))}

          {/* the link between a machine and whoever is using it */}
          {station && !travel.moving && (
            <div
              aria-hidden
              className="absolute z-0"
              style={{
                left: `${station.x}%`,
                top: `${station.y + 9}%`,
                height: `${LANE_Y - station.y - 27}%`,
                width: '2px',
                transform: 'translateX(-50%)',
                background:
                  'repeating-linear-gradient(to bottom, var(--color-agent) 0 4px, transparent 4px 9px)',
                opacity: stage.activeTool ? 0.55 : 0.18,
              }}
            />
          )}

          {/* the athlete */}
          <div
            onTransitionEnd={(event) => {
              if (event.propertyName === 'left' || event.propertyName === 'top') travel.settle();
            }}
            className="absolute z-20"
            style={{
              left: `${travel.rendered.x}%`,
              top: `${travel.rendered.y}%`,
              transform: 'translate(-50%, -100%)',
              transition:
                'left 460ms cubic-bezier(0.4, 0, 0.3, 1), top 460ms cubic-bezier(0.4, 0, 0.3, 1)',
            }}
          >
            <AgentSprite pose={pose} facing={travel.facing} />
            <div className="absolute left-1/2 top-full w-36 -translate-x-1/2 pt-1 text-center">
              <p className="font-mono text-[10px] leading-tight text-ink">{agentName}</p>
              <p className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-ink-faint">
                {POSE_CAPTION[pose]}
              </p>
            </div>
          </div>

          {/* the brief, pinned to the floor */}
          <div className="absolute inset-x-0 bottom-0 mx-auto max-w-xl rounded-lg border border-line bg-panel-2/90 px-4 py-2.5 backdrop-blur-sm">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-ink-faint">
              Challenge
            </p>
            <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-ink">
              {stage.task ?? task}
            </p>
          </div>
        </div>

        <StaminaBar used={stage.toolCalls} optimal={optimalToolCalls} budget={budget} />
      </div>
    </div>
  );
}

const POSE_CAPTION: Record<AgentPose, string> = {
  idle: 'standing by',
  walking: 'crossing the floor',
  working: 'on the machine',
  stagger: 'knocked back',
  reporting: 'reporting',
  cheer: 'passed',
  slump: 'failed',
};

function choosePose(stage: StageState, moving: boolean, staggering: boolean): AgentPose {
  // A knock-back holds the agent in place, so it is safe to let it win here:
  // there is no travel to contradict it.
  if (staggering) return 'stagger';
  // Otherwise locomotion wins over status. An agent that is genuinely in
  // transit walks, whatever it is nominally doing, so nothing ever plays a
  // standing clip while sliding across the floor.
  if (moving) return 'walking';
  if (stage.activeTool) return 'working';
  if (stage.agentState === 'judged') return stage.success ? 'cheer' : 'slump';
  if (stage.agentState === 'reporting') return 'reporting';
  return 'idle';
}

function chooseMood(stage: StageState, staggering: boolean): CoachMood {
  if (staggering) return 'wincing';
  if (stage.agentState === 'judged') return stage.success ? 'approving' : 'disappointed';
  return 'watching';
}

function ToolStation({
  name,
  state,
  x,
  y,
  hit,
  hitKind,
  busy,
}: {
  name: string;
  state: ToolState;
  x: number;
  y: number;
  hit: number;
  hitKind: string;
  busy: boolean;
}) {
  const styles: Record<ToolState, string> = {
    idle: 'border-line bg-panel-2 text-ink-faint',
    active: 'border-agent bg-agent/15 text-agent',
    ok: 'border-pass/50 bg-pass/10 text-pass',
    error: 'border-fail/60 bg-fail/10 text-fail',
  };

  return (
    <div
      className="absolute z-10"
      style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
    >
      <div
        key={hit}
        className={`relative flex min-w-[112px] flex-col items-center gap-1 rounded-xl border px-3.5 py-2.5 transition-colors ${styles[state]}`}
        style={hit >= 0 ? { animation: 'station-hit 520ms cubic-bezier(0.36,0.07,0.19,0.97)' } : undefined}
      >
        <span className="text-lg">{TOOL_ICONS[name] ?? '🔧'}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
          {TOOL_LABELS[name] ?? name}
        </span>
        <span className="font-mono text-[8.5px] uppercase tracking-[0.16em] opacity-70">
          {state === 'idle' ? 'ready' : state === 'active' ? 'running' : state === 'ok' ? 'ok' : 'error'}
        </span>

        {/* Sparks only while the agent is actually at the machine. */}
        {busy && (
          <span aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-1 flex justify-center">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="absolute h-1 w-1 rounded-full bg-agent"
                style={{
                  ['--dx' as string]: `${(i - 1) * 12}px`,
                  ['--dy' as string]: '14px',
                  animation: `spark-fly 620ms ease-out ${i * 140}ms infinite`,
                }}
              />
            ))}
          </span>
        )}

        {hit >= 0 && hitKind && (
          <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded border border-env/50 bg-env/15 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.12em] text-env">
            ⚡ {hitKind}
          </span>
        )}
      </div>
    </div>
  );
}

/** Tool calls spent against the budget, which is the gym's real stamina. */
function StaminaBar({ used, optimal, budget }: { used: number; optimal: number; budget: number }) {
  const pct = budget === 0 ? 0 : Math.min(100, (used / budget) * 100);
  const optimalPct = budget === 0 ? 0 : Math.min(100, (optimal / budget) * 100);
  const over = used > optimal;

  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.16em] text-ink-faint">
        <span>Tool budget</span>
        <span className={over ? 'text-env' : ''}>
          {used} used · {optimal} is the target · {budget} allowed
        </span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-line">
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${over ? 'bg-env' : 'bg-agent'}`}
          style={{ width: `${pct}%`, transition: 'width 420ms cubic-bezier(0.2,0.8,0.2,1)' }}
        />
        <div
          aria-hidden
          className="absolute inset-y-0 w-px bg-ink-dim"
          style={{ left: `${optimalPct}%` }}
          title="the optimal path"
        />
      </div>
    </div>
  );
}

function StatusReadout({ stage, optimalToolCalls }: { stage: StageState; optimalToolCalls: number }) {
  return (
    <dl className="grid shrink-0 grid-cols-2 gap-x-5 gap-y-1 text-right font-mono">
      <dt className="text-[9.5px] uppercase tracking-[0.16em] text-ink-faint">Calls</dt>
      <dd className="text-[13px] tabular-nums text-ink">
        {stage.toolCalls}
        <span className="text-ink-faint"> / {optimalToolCalls} target</span>
      </dd>
      <dt className="text-[9.5px] uppercase tracking-[0.16em] text-ink-faint">Score</dt>
      <dd
        className={`text-[13px] tabular-nums ${
          stage.score === null ? 'text-ink-faint' : stage.success ? 'text-pass' : 'text-fail'
        }`}
      >
        {stage.score === null ? '--' : `${stage.score}/100`}
      </dd>
    </dl>
  );
}
