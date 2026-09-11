'use client';

import { useEffect, useRef } from 'react';
import type { WireEvent } from '@/lib/dto';

interface Line {
  id: string;
  glyph: string;
  tone: string;
  text: string;
  detail?: string;
  mono?: boolean;
}

/**
 * The observable record of the session.
 *
 * Only what the event stream carried. There is no chain of thought here
 * because the engine never emits one.
 */
export function Timeline({ events, dense = false }: { events: WireEvent[]; dense?: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [events.length]);

  const lines = events.flatMap(toLine);

  return (
    <div className={`overflow-y-auto px-4 ${dense ? 'max-h-[280px] py-2' : 'max-h-[420px] py-3'}`}>
      {lines.length === 0 && (
        <p className="py-6 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
          waiting for the agent
        </p>
      )}
      <ul className="space-y-1.5">
        {lines.map((line) => (
          <li key={line.id} className="flex animate-slide-in gap-2.5 text-[12px] leading-relaxed">
            <span className={`mt-[1px] w-4 shrink-0 text-center font-mono text-[11px] ${line.tone}`}>
              {line.glyph}
            </span>
            <span className="min-w-0 flex-1">
              <span className={line.mono ? 'font-mono text-[11px] text-ink' : 'text-ink'}>{line.text}</span>
              {line.detail && (
                <span className="ml-1.5 font-mono text-[10.5px] text-ink-faint">{line.detail}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <div ref={endRef} />
    </div>
  );
}

function toLine(event: WireEvent): Line[] {
  const p = event.payload as Record<string, unknown>;
  const base = { id: event.id };

  switch (event.type) {
    case 'SESSION_STARTED': {
      const agent = p.agent as { name: string } | undefined;
      return [
        {
          ...base,
          glyph: '▸',
          tone: 'text-ink-faint',
          text: `${agent?.name ?? 'Agent'} entered the gym`,
          detail: `attempt ${String(p.attempt ?? 1)}`,
        },
      ];
    }
    case 'TASK_RECEIVED':
      return [{ ...base, glyph: '✓', tone: 'text-ink-faint', text: 'Task received' }];
    case 'TOOL_CALL_STARTED': {
      const call = p.call as { name: string; input: Record<string, unknown> };
      return [
        {
          ...base,
          glyph: '→',
          tone: 'text-agent',
          text: `Calling ${call.name}`,
          detail: compactInput(call.input),
          mono: true,
        },
      ];
    }
    case 'TOOL_CALL_COMPLETED': {
      const call = p.call as { name: string };
      const result = p.result as { output: Record<string, unknown> | null; latencyMs: number };
      return [
        {
          ...base,
          glyph: '✓',
          tone: 'text-pass',
          text: describeOutput(call.name, result.output),
          detail: `${result.latencyMs}ms`,
        },
      ];
    }
    case 'TOOL_ERROR': {
      const call = p.call as { name: string };
      const result = p.result as { error?: { code: string; message: string } };
      return [
        {
          ...base,
          glyph: '✕',
          tone: 'text-fail',
          text: `${call.name} failed: ${result.error?.code ?? 'ERROR'}`,
          detail: result.error?.message,
        },
      ];
    }
    case 'ENVIRONMENT_EVENT':
      return [
        {
          ...base,
          glyph: '⚡',
          tone: 'text-env',
          text: `Environment injected ${String(p.kind)}`,
          detail: `on ${String(p.tool)}`,
        },
      ];
    case 'AGENT_RESPONSE':
      return [
        {
          ...base,
          glyph: '▪',
          tone: 'text-agent',
          text: 'Agent reported back',
          detail: firstLine(String(p.response ?? '')),
        },
      ];
    case 'EVALUATION_STARTED':
      return [
        {
          ...base,
          glyph: '⚖',
          tone: 'text-ink-dim',
          text: 'Judge is checking the database',
          detail: `${String(p.assertions ?? 0)} assertions`,
        },
      ];
    case 'EVALUATION_COMPLETED':
      return [
        {
          ...base,
          glyph: p.success ? '✓' : '✕',
          tone: p.success ? 'text-pass' : 'text-fail',
          text: `${p.success ? 'PASS' : 'FAIL'} · ${String(p.score)}/100`,
          detail: `judged by ${String(p.source)}`,
        },
      ];
    case 'COACH_FEEDBACK':
      return [{ ...base, glyph: '◈', tone: 'text-coach', text: String(p.headline ?? 'Coach feedback') }];
    case 'SCORE_UPDATED':
      return [
        {
          ...base,
          glyph: '↑',
          tone: 'text-ink-dim',
          text: `Fitness updated · overall ${String(p.overall)}`,
        },
      ];
    default:
      return [];
  }
}

function compactInput(input: Record<string, unknown>): string {
  const entries = Object.entries(input).map(([key, value]) => `${key}=${String(value)}`);
  const joined = entries.join(' ');
  return joined.length > 72 ? `${joined.slice(0, 72)}…` : joined;
}

function describeOutput(tool: string, output: Record<string, unknown> | null): string {
  if (!output) return `${tool} returned`;
  if (Array.isArray(output.results)) {
    const count = output.count ?? (output.results as unknown[]).length;
    const partial = output.truncated ? ' (partial payload)' : '';
    const stale = output.source === 'search-index' ? ' from the search index' : '';
    return `${count} result${count === 1 ? '' : 's'}${stale}${partial}`;
  }
  if (output.customer && typeof output.customer === 'object') {
    const customer = output.customer as { id: string; name: string };
    return `Retrieved ${customer.name} (${customer.id})`;
  }
  if (output.success === true) {
    const customer = output.customer as { id: string } | undefined;
    return `Write applied to ${customer?.id ?? 'the record'}`;
  }
  return `${tool} returned`;
}

function firstLine(text: string): string {
  const line = text.split('\n')[0];
  return line.length > 90 ? `${line.slice(0, 90)}…` : line;
}
