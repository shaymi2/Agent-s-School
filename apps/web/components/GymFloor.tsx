'use client';

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
 * Nothing on this floor animates on a timer.
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
        break;
      }
      case 'ENVIRONMENT_EVENT':
        environmentFlash = { kind: String(p.kind), tool: String(p.tool) };
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
  };
}

export function GymFloor({
  stage,
  agentName,
  task,
  optimalToolCalls,
  running,
}: {
  stage: StageState;
  agentName: string;
  task: string;
  optimalToolCalls: number;
  running: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-panel">
      {/* Floor: an isometric grid the stations stand on. */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ perspective: '800px' }}>
        <div
          className="absolute inset-x-[-20%] bottom-[-30%] top-[35%] opacity-25"
          style={{
            transform: 'rotateX(66deg)',
            backgroundImage:
              'linear-gradient(var(--color-line-bright) 1px, transparent 1px), linear-gradient(90deg, var(--color-line-bright) 1px, transparent 1px)',
            backgroundSize: '52px 52px',
            maskImage: 'linear-gradient(to top, black, transparent 85%)',
          }}
        />
      </div>

      <div className="relative px-5 pb-5 pt-6">
        <div className="flex items-start justify-between gap-4">
          <Coach line={stage.coachLine} running={running} />
          <StatusReadout stage={stage} optimalToolCalls={optimalToolCalls} />
        </div>

        <div className="mt-6 flex flex-col items-center">
          <AgentAvatar name={agentName} state={stage.agentState} running={running} />

          <div className="mt-5 w-full max-w-xl rounded-lg border border-line bg-panel-2/80 px-4 py-3">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-ink-faint">Challenge</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink">{stage.task ?? task}</p>
          </div>

          {stage.environmentFlash && (
            <div className="mt-3 flex animate-slide-in items-center gap-2 rounded-md border border-env/40 bg-env/10 px-3 py-1.5">
              <span className="text-env">⚡</span>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-env">
                environment · {stage.environmentFlash.kind} on {stage.environmentFlash.tool}
              </span>
            </div>
          )}

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {Object.keys(stage.toolStates).map((tool) => (
              <ToolStation key={tool} name={tool} state={stage.toolStates[tool]} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentAvatar({
  name,
  state,
  running,
}: {
  name: string;
  state: StageState['agentState'];
  running: boolean;
}) {
  const busy = running && (state === 'working' || state === 'reporting');
  const captions: Record<StageState['agentState'], string> = {
    waiting: 'standing by',
    working: 'working',
    reporting: 'reporting',
    judged: 'done',
  };

  return (
    <div className="flex flex-col items-center">
      <div
        className={`grid h-16 w-16 place-items-center rounded-2xl border text-2xl transition-colors ${
          busy ? 'animate-pulse-ring border-agent bg-agent/10' : 'border-line-bright bg-panel-2'
        }`}
      >
        🤖
      </div>
      <p className="mt-2 font-mono text-[11px] text-ink">{name}</p>
      <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-ink-faint">
        {captions[state]}
      </p>
    </div>
  );
}

function ToolStation({ name, state }: { name: string; state: ToolState }) {
  const styles: Record<ToolState, string> = {
    idle: 'border-line bg-panel-2 text-ink-faint',
    active: 'border-agent bg-agent/15 text-agent animate-pulse-ring',
    ok: 'border-pass/50 bg-pass/10 text-pass',
    error: 'border-fail/60 bg-fail/10 text-fail',
  };
  return (
    <div
      className={`flex min-w-[124px] flex-col items-center gap-1.5 rounded-xl border px-4 py-3 transition-all ${styles[state]}`}
    >
      <span className="text-xl">{TOOL_ICONS[name] ?? '🔧'}</span>
      <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
        {TOOL_LABELS[name] ?? name}
      </span>
      <span className="font-mono text-[9px] uppercase tracking-[0.16em] opacity-70">
        {state === 'idle' ? 'ready' : state === 'active' ? 'running' : state === 'ok' ? 'ok' : 'error'}
      </span>
    </div>
  );
}

function Coach({ line, running }: { line: string | null; running: boolean }) {
  return (
    <div className="flex max-w-sm items-start gap-2.5">
      <div
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border text-base ${
          line ? 'border-coach/50 bg-coach/10' : 'border-line bg-panel-2'
        }`}
      >
        🧑‍🏫
      </div>
      <div className="min-w-0">
        <p className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-coach">Coach</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink-dim">
          {line ??
            (running
              ? 'Watching. I score the run, not the story you tell about it.'
              : 'Start the workout when you are ready.')}
        </p>
      </div>
    </div>
  );
}

function StatusReadout({
  stage,
  optimalToolCalls,
}: {
  stage: StageState;
  optimalToolCalls: number;
}) {
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
