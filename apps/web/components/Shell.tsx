'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { api, useSelectedAgent } from '@/lib/client';
import { AgentProvider } from './AgentContext';
import { Pill } from './ui';
import type { WireAgent } from '@/lib/dto';

export function Shell({
  children,
  agentSlot = true,
}: {
  children: React.ReactNode;
  agentSlot?: boolean;
}) {
  const state = useSelectedAgent();
  const { agents, agent, select, refresh, loading } = state;
  const pathname = usePathname();

  return (
    <AgentProvider value={state}>
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-void/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
          <Link href="/" className="group flex items-center gap-2.5">
            <span className="relative grid h-7 w-7 place-items-center rounded-md border border-agent/40 bg-agent/10">
              <span className="h-2 w-2 rounded-[2px] bg-agent" />
            </span>
            <span className="font-mono text-[13px] font-semibold uppercase tracking-[0.22em] text-ink">
              Agent Gym
            </span>
          </Link>

          <nav className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.16em]">
            <NavLink href="/" active={pathname === '/'}>
              Lobby
            </NavLink>
            <NavLink href="/gym/tool_usage" active={pathname.startsWith('/gym')}>
              Tool Gym
            </NavLink>
            <NavLink href="/profile" active={pathname.startsWith('/profile')}>
              Fitness
            </NavLink>
          </nav>

          {agentSlot && (
            <div className="ml-auto">
              <AgentSelector agents={agents} agent={agent} select={select} refresh={refresh} loading={loading} />
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-5 py-7">{children}</main>
    </div>
    </AgentProvider>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-md px-2.5 py-1.5 transition-colors ${
        active ? 'bg-line text-ink' : 'text-ink-faint hover:text-ink-dim'
      }`}
    >
      {children}
    </Link>
  );
}

function AgentSelector({
  agents,
  agent,
  select,
  refresh,
  loading,
}: {
  agents: WireAgent[];
  agent: WireAgent | null;
  select: (id: string) => void;
  refresh: () => void;
  loading: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (name.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const { agent: created } = await api.createAgent({ name: name.trim(), provider: 'heuristic' });
      setName('');
      setCreating(false);
      refresh();
      select(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <span className="font-mono text-[11px] text-ink-faint">loading athletes…</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">Athlete</span>
      <select
        value={agent?.id ?? ''}
        onChange={(event) => select(event.target.value)}
        className="rounded-md border border-line bg-panel px-2.5 py-1.5 font-mono text-[11px] text-ink outline-none focus:border-agent/60"
      >
        {agents.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name} · {option.provider}
          </option>
        ))}
      </select>
      {agent && (
        <Pill tone={agent.provider === 'heuristic' ? 'neutral' : 'agent'}>{agent.model}</Pill>
      )}
      {creating ? (
        <span className="flex items-center gap-1.5">
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && create()}
            placeholder="new athlete"
            className="w-32 rounded-md border border-line bg-panel px-2 py-1.5 font-mono text-[11px] text-ink outline-none focus:border-agent/60"
          />
          <button
            type="button"
            onClick={create}
            disabled={busy}
            className="rounded-md border border-agent/50 px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-agent hover:bg-agent/10"
          >
            add
          </button>
          <button
            type="button"
            onClick={() => setCreating(false)}
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint hover:text-ink-dim"
          >
            esc
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          title="Register another trainee"
          className="rounded-md border border-line px-2 py-1.5 font-mono text-[11px] text-ink-faint hover:border-line-bright hover:text-ink-dim"
        >
          +
        </button>
      )}
      {error && <span className="font-mono text-[10px] text-fail">{error}</span>}
    </div>
  );
}
