/**
 * Wire types.
 *
 * The browser talks to the gym over HTTP and never imports the engine, so the
 * shapes it depends on live here. Keeping them separate is what stops a UI
 * component from accidentally pulling SQLite into a client bundle.
 */

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

export interface WireEvent {
  id: string;
  sessionId: string;
  agentId: string;
  exerciseId: string;
  seq: number;
  type: GymEventType;
  at: number;
  label: string;
  payload: Record<string, unknown>;
}

export interface WireSkill {
  id: string;
  name: string;
  icon: string;
  blurb: string;
  status: 'active' | 'locked';
  dimensions: string[];
  exerciseCount: number;
}

export interface WireExercise {
  id: string;
  skill: string;
  difficulty: number;
  title: string;
  task: string;
  intent: string;
  availableTools: string[];
  optimalToolCalls: number;
  tags: string[];
  evaluation: Record<string, number>;
  /** Set when the caller asked for one agent's record on this exercise. */
  attempts?: number;
  bestScore?: number;
  lastScore?: number;
}

export interface WireAgent {
  id: string;
  name: string;
  provider: string;
  model: string;
  maxSteps: number;
  available: boolean;
}

export interface WireMetricRow {
  dimension: string;
  score: number;
  weight?: number;
}

export interface WireAssertionResult {
  id: string;
  category: string;
  description: string;
  required: boolean;
  passed: boolean;
  detail: string;
}

export interface WireEvaluation {
  success: boolean;
  score: number;
  metrics: Record<string, number>;
  mistakes: string[];
  strengths: string[];
  deterministic: { passed: number; failed: number; results: WireAssertionResult[] };
  qualitative: { source: string; model?: string; notes: string[] };
}

export interface WireCoachFeedback {
  headline: string;
  message: string;
  strengths: string[];
  weaknesses: Array<{ dimension: string; score: number; note: string }>;
  drills: Array<{ exerciseId: string; title: string; difficulty: number; reason: string }>;
  guidance: { focusDimensions: string[]; rules: string[]; maxToolCalls?: number };
  source: string;
}

export interface WireSession {
  id: string;
  agentId: string;
  agentName: string;
  exerciseId: string;
  exerciseTitle: string;
  skill: string;
  attempt: number;
  status: string;
  startedAt: number;
  finishedAt?: number;
  score?: number;
  success?: boolean;
  finalResponse?: string;
  guidanceRules: string[];
  error?: string;
}

export interface WireSessionDetail {
  session: WireSession;
  evaluation: WireEvaluation | null;
  feedback: WireCoachFeedback | null;
  events: WireEvent[];
  previousScore: number | null;
}

export interface WireFitness {
  agentId: string;
  agentName: string;
  overall: number;
  skills: Array<{
    skill: string;
    overall: number;
    attempts: number;
    successes: number;
    successRate: number;
    bestScore: number;
    dimensions: Record<string, { current: number; best: number; samples: number; trend: number }>;
    weaknesses: string[];
    recommended: Array<{ exerciseId: string; title: string; difficulty: number; reason: string }>;
    history: Array<{ sessionId: string; exerciseId: string; score: number; success: boolean; at: number }>;
  }>;
  /** Skills the gym knows about but this agent has never trained. */
  untrained: string[];
}

export const DIMENSION_LABELS: Record<string, string> = {
  accuracy: 'Accuracy',
  tool_selection: 'Tool Selection',
  efficiency: 'Efficiency',
  verification: 'Verification',
  error_recovery: 'Error Recovery',
  safety: 'Safety',
  reasoning: 'Reasoning',
  planning: 'Planning',
  communication: 'Communication',
};

export const DIFFICULTY_LABELS: Record<number, string> = {
  1: 'Basic',
  2: 'Sequential',
  3: 'Verification',
  4: 'Recovery',
  5: 'Ambiguity',
  6: 'Adversarial',
};
