'use client';

import { createContext, useContext } from 'react';
import type { WireAgent } from '@/lib/dto';

export interface AgentContextValue {
  agents: WireAgent[];
  agent: WireAgent | null;
  select: (id: string) => void;
  refresh: () => void;
  loading: boolean;
}

const AgentContext = createContext<AgentContextValue>({
  agents: [],
  agent: null,
  select: () => {},
  refresh: () => {},
  loading: true,
});

export const AgentProvider = AgentContext.Provider;

/** The athlete currently on the floor, shared by every view. */
export function useAgent(): AgentContextValue {
  return useContext(AgentContext);
}
