/**
 * In-process event bus.
 *
 * The UI subscribes to this; it never reaches into a running session. Events
 * are persisted first and published second, so a late subscriber can replay
 * from the store and then join the live stream without a gap.
 */

import type { GymEvent } from '../domain/types.ts';

type Listener = (event: GymEvent) => void;

export class EventBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(sessionId: string, listener: Listener): () => void {
    const set = this.listeners.get(sessionId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(sessionId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(sessionId);
    };
  }

  publish(event: GymEvent): void {
    for (const listener of this.listeners.get(event.sessionId) ?? []) listener(event);
    for (const listener of this.listeners.get('*') ?? []) listener(event);
  }
}

/** Shared bus, so an HTTP route handler and the orchestrator see the same stream. */
export const gymBus = new EventBus();
