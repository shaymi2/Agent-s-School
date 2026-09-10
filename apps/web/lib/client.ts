'use client';

/**
 * Browser-side gym client.
 *
 * The UI never touches the engine. It calls the API and consumes the event
 * stream, which is what keeps the visual layer replaceable.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  WireAgent,
  WireEvent,
  WireExercise,
  WireFitness,
  WireSession,
  WireSessionDetail,
  WireSkill,
} from './dto';

const AGENT_KEY = 'agent-gym.selected-agent';

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path} -> ${response.status}`);
  return (await response.json()) as T;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((payload as { error?: string }).error ?? `${path} -> ${response.status}`);
  return payload as T;
}

export const api = {
  skills: () => get<{ skills: WireSkill[] }>('/api/skills'),
  exercises: (skill: string, agentId?: string) =>
    get<{ exercises: WireExercise[] }>(
      `/api/exercises?skill=${encodeURIComponent(skill)}${agentId ? `&agentId=${agentId}` : ''}`,
    ),
  agents: () => get<{ agents: WireAgent[] }>('/api/agents'),
  createAgent: (body: Record<string, unknown>) => post<{ agent: WireAgent }>('/api/agents', body),
  fitness: (agentId: string) => get<{ fitness: WireFitness }>(`/api/agents/${agentId}/fitness`),
  history: (agentId: string) => get<{ sessions: WireSession[] }>(`/api/agents/${agentId}/history`),
  session: (id: string) => get<WireSessionDetail>(`/api/sessions/${id}`),
  createSession: (agentId: string, exerciseId: string, fresh = false) =>
    post<{ session: WireSession }>('/api/sessions', { agentId, exerciseId, fresh }),
  startSession: (id: string) => post<{ started: boolean }>(`/api/sessions/${id}/start`),
};

/** The athlete currently on the floor, remembered between visits. */
export function useSelectedAgent(): {
  agents: WireAgent[];
  agent: WireAgent | null;
  select: (id: string) => void;
  refresh: () => void;
  loading: boolean;
} {
  const [agents, setAgents] = useState<WireAgent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api
      .agents()
      .then(({ agents: list }) => {
        setAgents(list);
        setSelectedId((current) => {
          const stored = current ?? window.localStorage.getItem(AGENT_KEY);
          const valid = list.find((a) => a.id === stored);
          return valid?.id ?? list[0]?.id ?? null;
        });
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    window.localStorage.setItem(AGENT_KEY, id);
  }, []);

  return {
    agents,
    agent: agents.find((a) => a.id === selectedId) ?? null,
    select,
    refresh: load,
    loading,
  };
}

export type RunPhase = 'idle' | 'starting' | 'running' | 'evaluating' | 'complete' | 'error';

export interface RunState {
  phase: RunPhase;
  sessionId: string | null;
  events: WireEvent[];
  detail: WireSessionDetail | null;
  error: string | null;
}

const INITIAL: RunState = {
  phase: 'idle',
  sessionId: null,
  events: [],
  detail: null,
  error: null,
};

/**
 * Drives one workout: create the session, subscribe to its stream, then start
 * it. Subscribing before starting is what guarantees the first tool call is
 * visible rather than raced past.
 */
export function useWorkout(): RunState & {
  run: (agentId: string, exerciseId: string, fresh?: boolean) => Promise<void>;
  reset: () => void;
  load: (sessionId: string) => Promise<void>;
} {
  const [state, setState] = useState<RunState>(INITIAL);
  const sourceRef = useRef<EventSource | null>(null);

  const closeStream = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  useEffect(() => closeStream, [closeStream]);

  const reset = useCallback(() => {
    closeStream();
    setState(INITIAL);
  }, [closeStream]);

  const load = useCallback(async (sessionId: string) => {
    const detail = await api.session(sessionId);
    setState({
      phase: 'complete',
      sessionId,
      events: detail.events,
      detail,
      error: null,
    });
  }, []);

  const run = useCallback(
    async (agentId: string, exerciseId: string, fresh = false) => {
      closeStream();
      setState({ ...INITIAL, phase: 'starting' });

      try {
        const { session } = await api.createSession(agentId, exerciseId, fresh);
        setState((s) => ({ ...s, sessionId: session.id }));

        await new Promise<void>((resolve, reject) => {
          const source = new EventSource(`/api/sessions/${session.id}/events`);
          sourceRef.current = source;
          let started = false;

          /**
           * Start the workout only once the stream is genuinely live, so the
           * first tool call is watched rather than raced past. The server's
           * STREAM_READY frame is the reliable signal; `onopen` is a fallback
           * for browsers that fire it first.
           */
          const beginWhenLive = () => {
            if (started) return;
            started = true;
            api.startSession(session.id).catch((error: Error) => {
              setState((s) => ({ ...s, phase: 'error', error: error.message }));
              reject(error);
            });
          };

          source.addEventListener('STREAM_READY', beginWhenLive);
          source.onopen = beginWhenLive;

          const onEvent = (raw: MessageEvent) => {
            const event = JSON.parse(raw.data) as WireEvent;
            setState((s) => {
              if (s.events.some((e) => e.id === event.id)) return s;
              const phase: RunPhase =
                event.type === 'EVALUATION_STARTED'
                  ? 'evaluating'
                  : event.type === 'SESSION_COMPLETED'
                    ? 'complete'
                    : s.phase === 'evaluating'
                      ? 'evaluating'
                      : 'running';
              return { ...s, phase, events: [...s.events, event] };
            });

            if (event.type === 'SESSION_COMPLETED' || event.type === 'SESSION_FAILED') {
              source.close();
              sourceRef.current = null;
              api
                .session(session.id)
                .then((detail) => {
                  setState((s) => ({
                    ...s,
                    phase: event.type === 'SESSION_FAILED' ? 'error' : 'complete',
                    detail,
                  }));
                  resolve();
                })
                .catch(reject);
            }
          };

          for (const type of [
            'SESSION_STARTED',
            'EXERCISE_STARTED',
            'TASK_RECEIVED',
            'TOOL_CALL_STARTED',
            'TOOL_CALL_COMPLETED',
            'TOOL_ERROR',
            'ENVIRONMENT_EVENT',
            'AGENT_RESPONSE',
            'EXERCISE_COMPLETED',
            'EVALUATION_STARTED',
            'EVALUATION_COMPLETED',
            'COACH_FEEDBACK',
            'SCORE_UPDATED',
            'SESSION_COMPLETED',
            'SESSION_FAILED',
          ]) {
            source.addEventListener(type, onEvent as EventListener);
          }

          source.onerror = () => {
            // EventSource retries on its own; only a closed stream is fatal.
            if (source.readyState === EventSource.CLOSED) {
              setState((s) =>
                s.phase === 'complete' ? s : { ...s, phase: 'error', error: 'Lost the event stream.' },
              );
              reject(new Error('event stream closed'));
            }
          };
        });
      } catch (error) {
        setState((s) => ({
          ...s,
          phase: 'error',
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [closeStream],
  );

  return { ...state, run, reset, load };
}
