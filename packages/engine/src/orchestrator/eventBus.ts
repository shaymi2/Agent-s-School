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

/**
 * Shared bus, so an HTTP route handler and the orchestrator see the same
 * stream.
 *
 * It hangs off globalThis under a registered symbol rather than being a plain
 * module singleton: a bundler that gives two routes their own copy of this
 * module would otherwise hand them two different buses, and the publisher
 * would be shouting into one while the subscriber listened to the other.
 */
const BUS_KEY = Symbol.for('ai-agent-gym.event-bus');
type BusHolder = { [BUS_KEY]?: EventBus };
const holder = globalThis as unknown as BusHolder;

export const gymBus: EventBus = (holder[BUS_KEY] ??= new EventBus());
