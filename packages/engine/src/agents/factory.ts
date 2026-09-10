import { HeuristicTraineeAgent } from './heuristicTrainee.ts';
import { LlmTraineeAgent } from './llmTrainee.ts';
import { createProvider } from '../providers/factory.ts';
import type { AgentConfig, TraineeAgent } from '../domain/types.ts';

/** Build the trainee an agent config asks for. */
export function createTrainee(config: AgentConfig): TraineeAgent {
  if (config.provider === 'heuristic') return new HeuristicTraineeAgent(config.model);
  return new LlmTraineeAgent(createProvider(config.provider, config.model), config.provider);
}
