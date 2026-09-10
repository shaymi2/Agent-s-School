/**
 * The Gym domain model.
 *
 * These types are the contract between the six replaceable components:
 *   Orchestrator | Trainee | Environment (sandbox + tools) | Judge | Coach | UI
 *
 * Nothing here knows about Tool Usage specifically. A new gym (Reasoning,
 * Research, Memory, Safety, Multi-Agent) plugs in by supplying a Skill, a set
 * of Tools, an Environment factory and Exercise data. The engine is unchanged.
 */

import type { AgentId, ExerciseId, SessionId, SkillId } from './ids.ts';

/* ------------------------------------------------------------------ Skills */

/** A capability an agent can train. Only `tool_usage` is implemented in the MVP. */
export interface Skill {
  id: SkillId;
  name: string;
  icon: string;
  blurb: string;
  status: 'active' | 'locked';
  /** The scoring dimensions this skill actually measures. */
  dimensions: DimensionId[];
}

/**
 * Agent capability is deliberately NOT one number. Every dimension stays
 * visible; "overall fitness" is only ever a weighted view over these.
 */
export type DimensionId =
  | 'accuracy'
  | 'tool_selection'
  | 'efficiency'
  | 'verification'
  | 'error_recovery'
  | 'safety'
  | 'reasoning'
  | 'planning'
  | 'communication';

export const ALL_DIMENSIONS: DimensionId[] = [
  'accuracy',
  'tool_selection',
  'efficiency',
  'verification',
  'error_recovery',
  'safety',
  'reasoning',
  'planning',
  'communication',
];

export type DimensionScores = Partial<Record<DimensionId, number>>;

/* ------------------------------------------------------------------ Agents */

/**
 * Who is driving the trainee. `external` means nobody in this process is: a
 * caller submits the tool calls over the API and the gym only judges them.
 */
export type ProviderKind = 'heuristic' | 'anthropic' | 'openai_compatible' | 'external';

/**
 * A trainee agent's configuration. `provider` decides which brain drives it;
 * the rest of the engine never learns which one it got.
 */
export interface AgentConfig {
  id: AgentId;
  name: string;
  provider: ProviderKind;
  /** Model id for LLM providers, or a policy name for the heuristic provider. */
  model: string;
  systemPrompt?: string;
  temperature?: number;
  /** Hard cap on agent turns, enforced by the orchestrator, not the agent. */
  maxSteps: number;
  createdAt: string;
}

/* ------------------------------------------------------------------- Tools */

export interface JsonSchema {
  type: 'object';
  properties: Record<string, { type: string; description: string; enum?: string[] }>;
  required: string[];
}

/** A tool as advertised to the trainee. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** Marks writes so the sandbox can enforce permissions and audit them. */
  mutates: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  toolName: string;
  ok: boolean;
  output: Record<string, unknown> | null;
  error?: { code: string; message: string; retryable: boolean };
  latencyMs: number;
  /** Set when an exercise-configured environment event shaped this result. */
  environmentEvent?: EnvironmentEventKind;
}

/* ------------------------------------------------------- Environment model */

export type EnvironmentEventKind =
  | 'API_TIMEOUT'
  | 'API_503'
  | 'INVALID_PARAMETER'
  | 'MISSING_RECORD'
  | 'DUPLICATE_RECORD'
  | 'PERMISSION_DENIED'
  | 'INCOMPLETE_RESPONSE'
  | 'CONFLICTING_DATA';

/**
 * A rule that injects a controlled failure. Deterministic by construction:
 * the Nth matching call to `trigger` gets the event, `occurrences` times.
 */
export interface EnvironmentEventRule {
  trigger: string;
  response: EnvironmentEventKind;
  occurrences: number;
  /** Only fire when the call input matches these key/value pairs. */
  when?: Record<string, string>;
  /** Skip this many matching calls before firing. */
  skipFirst?: number;
  message?: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: 'active' | 'inactive' | 'suspended';
  plan: string;
  region: string;
  accountOwner: string;
  createdAt: string;
  notes: string;
}

/** A mutation the sandbox actually applied. The audit trail the judge reads. */
export interface WriteRecord {
  customerId: string;
  field: string;
  before: string;
  after: string;
  callId: string;
  at: number;
}

/** Everything an exercise can say about the world it wants. */
export interface EnvironmentSpec {
  seed?: number;
  /** Customers added on top of the base dataset (duplicates, edge cases). */
  addCustomers?: Customer[];
  /** Customer ids removed from the base dataset (missing-record exercises). */
  removeCustomers?: string[];
  /** Field overrides applied to base customers. */
  patchCustomers?: Array<{ id: string; patch: Partial<Customer> }>;
  /**
   * A second, disagreeing source of truth reachable through search results.
   * Used by the conflicting-data exercises.
   */
  conflictingIndex?: Array<{ id: string; field: keyof Customer; value: string }>;
  /** Explicit write permissions. Anything not listed is denied when set. */
  permissions?: {
    writableFields?: string[];
    denyUpdatesTo?: string[];
  };
  events?: EnvironmentEventRule[];
}

/* --------------------------------------------------------------- Exercises */

export type AssertionCategory = DimensionId;

/**
 * Deterministic checks, declared as data. The engine implements a fixed
 * vocabulary of assertion kinds; exercises compose them. No exercise-specific
 * branching ever enters the evaluation code.
 */
export type AssertionKind =
  | 'tool_called'
  | 'tool_not_called'
  | 'tool_call_count'
  | 'tool_sequence'
  | 'record_field_equals'
  | 'record_unchanged'
  | 'no_unauthorized_writes'
  | 'write_count'
  | 'final_response_contains'
  | 'final_response_mentions_all'
  | 'recovered_from_error'
  | 'max_tool_calls'
  | 'no_tool_errors_unhandled';

export interface Assertion {
  id: string;
  kind: AssertionKind;
  category: AssertionCategory;
  description: string;
  /** Failing a required assertion fails the exercise outright. */
  required: boolean;
  weight: number;
  params: Record<string, unknown>;
}

export interface ExerciseDefinition {
  id: ExerciseId;
  skill: SkillId;
  /** 1 basic, 2 sequential, 3 verification, 4 recovery, 5 ambiguity, 6 adversarial. */
  difficulty: number;
  title: string;
  /** The instruction handed to the trainee. */
  task: string;
  /** Author-facing note about what the exercise is really testing. */
  intent: string;
  availableTools: string[];
  environment: EnvironmentSpec;
  /** Per-dimension weights, summing to 100, used to compute the final score. */
  evaluation: Partial<Record<DimensionId, number>>;
  assertions: Assertion[];
  /** Tool calls a competent agent needs. Drives the efficiency metric. */
  optimalToolCalls: number;
  /** Tags used by the coach to recommend follow-up workouts. */
  tags: string[];
}

/* ------------------------------------------------------------------ Events */

export type GymEventType =
  | 'SESSION_STARTED'
  | 'EXERCISE_STARTED'
  | 'TASK_RECEIVED'
  | 'TOOL_CALL_STARTED'
  | 'TOOL_CALL_COMPLETED'
  | 'TOOL_ERROR'
  | 'ENVIRONMENT_EVENT'
  | 'AGENT_RESPONSE'
  | 'EXERCISE_COMPLETED'
  | 'EVALUATION_STARTED'
  | 'EVALUATION_COMPLETED'
  | 'COACH_FEEDBACK'
  | 'SCORE_UPDATED'
  | 'SESSION_COMPLETED'
  | 'SESSION_FAILED';

/**
 * The only window onto a running session. Chain-of-thought is never an event:
 * the UI, the judge and the logs all see the same observable behaviour.
 */
export interface GymEvent {
  id: string;
  sessionId: SessionId;
  agentId: AgentId;
  exerciseId: ExerciseId;
  seq: number;
  type: GymEventType;
  at: number;
  /** Short human-readable line for timelines and logs. */
  label: string;
  payload: Record<string, unknown>;
}

/* ---------------------------------------------------------------- Sessions */

export type SessionStatus = 'pending' | 'running' | 'evaluating' | 'completed' | 'failed';

export interface Session {
  id: SessionId;
  agentId: AgentId;
  exerciseId: ExerciseId;
  skill: SkillId;
  attempt: number;
  status: SessionStatus;
  startedAt: number;
  finishedAt?: number;
  /** Coach guidance carried into this attempt from the previous one. */
  guidance: CoachGuidance | null;
  finalResponse?: string;
  score?: number;
  success?: boolean;
  error?: string;
}

/* -------------------------------------------------------------- Evaluation */

export interface AssertionResult {
  id: string;
  kind: AssertionKind;
  category: AssertionCategory;
  description: string;
  required: boolean;
  weight: number;
  passed: boolean;
  detail: string;
}

/** The stable judge contract. Do not reshape without versioning it. */
export interface Evaluation {
  sessionId: SessionId;
  success: boolean;
  score: number;
  metrics: DimensionScores;
  mistakes: string[];
  strengths: string[];
  /** Provenance so a low score can always be traced back. */
  deterministic: {
    passed: number;
    failed: number;
    results: AssertionResult[];
  };
  qualitative: {
    source: 'llm' | 'heuristic';
    model?: string;
    metrics: DimensionScores;
    notes: string[];
  };
  createdAt: number;
}

/* ------------------------------------------------------------------- Coach */

/**
 * Machine-readable coaching. This is what actually changes the next attempt:
 * the orchestrator feeds it back into the trainee's context on retry, so an
 * improved score is caused by the coaching, not by chance.
 */
export interface CoachGuidance {
  focusDimensions: DimensionId[];
  rules: string[];
  maxToolCalls?: number;
  requireVerification?: boolean;
  retryTransientErrors?: boolean;
  disambiguateBeforeActing?: boolean;
  avoidRedundantSearch?: boolean;
}

export interface DrillRecommendation {
  exerciseId: ExerciseId;
  title: string;
  difficulty: number;
  reason: string;
}

export interface CoachFeedback {
  sessionId: SessionId;
  agentId: AgentId;
  headline: string;
  /** Prose the Coach character speaks in the gym. */
  message: string;
  strengths: string[];
  weaknesses: Array<{ dimension: DimensionId; score: number; note: string }>;
  drills: DrillRecommendation[];
  guidance: CoachGuidance;
  source: 'llm' | 'heuristic';
  createdAt: number;
}

/* --------------------------------------------------------- Fitness profile */

export interface DimensionStat {
  current: number;
  best: number;
  samples: number;
  trend: number;
}

export interface FitnessProfile {
  agentId: AgentId;
  skill: SkillId;
  overall: number;
  dimensions: Partial<Record<DimensionId, DimensionStat>>;
  attempts: number;
  successes: number;
  successRate: number;
  bestScore: number;
  /** Score of every completed session, oldest first. */
  history: Array<{ sessionId: SessionId; exerciseId: ExerciseId; score: number; success: boolean; at: number }>;
  weaknesses: DimensionId[];
  recommended: DrillRecommendation[];
  updatedAt: number;
}

/* ----------------------------------------------------------- Trainee shape */

/** What the trainee is told before it acts. Nothing else. */
export interface TraineeContext {
  sessionId: SessionId;
  agent: AgentConfig;
  exercise: ExerciseDefinition;
  tools: ToolDefinition[];
  guidance: CoachGuidance | null;
  attempt: number;
  maxSteps: number;
}

export interface TraineeOutcome {
  finalResponse: string;
  stepsUsed: number;
  stopReason: 'finished' | 'max_steps' | 'error';
  providerError?: string;
}

/** The trainee's only channel to the world. */
export type ToolInvoker = (call: ToolCall) => Promise<ToolResult>;

export interface TraineeAgent {
  readonly kind: ProviderKind;
  readonly model: string;
  run(context: TraineeContext, invoke: ToolInvoker): Promise<TraineeOutcome>;
}
