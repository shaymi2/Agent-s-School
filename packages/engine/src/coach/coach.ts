/**
 * The Coach.
 *
 * The Judge says what happened. The Coach decides what to do about it, and
 * that decision is machine-readable: the guidance it emits is fed straight
 * back into the next attempt's context, so an improved score has a cause you
 * can point at.
 *
 * One weakness per session, deliberately. Coaching that lists six problems at
 * once changes nothing.
 */

import { listExercises } from '../exercises/catalog.ts';
import type { LlmProvider } from '../providers/types.ts';
import type {
  CoachFeedback,
  CoachGuidance,
  DimensionId,
  DrillRecommendation,
  Evaluation,
  ExerciseDefinition,
  FitnessProfile,
} from '../domain/types.ts';

/** What each weakness translates into, as an instruction the trainee can act on. */
const PLAYBOOK: Record<
  string,
  { rules: string[]; flags: Partial<CoachGuidance>; tags: string[]; label: string }
> = {
  accuracy: {
    label: 'answering from the authoritative record',
    rules: [
      'Retrieve the full record with get_customer before you answer or write. Search summaries can be stale or partial.',
    ],
    flags: { requireVerification: true },
    tags: ['verification', 'retrieval', 'conflicting_data'],
  },
  verification: {
    label: 'verifying before acting',
    rules: [
      'Read the record you are about to change before you change it, and confirm it is the one the brief means.',
    ],
    flags: { requireVerification: true },
    tags: ['verification', 'writes'],
  },
  error_recovery: {
    label: 'recovering from tool failures',
    rules: [
      'A retryable failure (timeout, 503) is not a dead end: retry it once or twice before reporting failure.',
      'A non-retryable failure will not fix itself: report it instead of repeating the call.',
    ],
    flags: { retryTransientErrors: true },
    tags: ['recovery', 'transient_errors'],
  },
  efficiency: {
    label: 'taking the shortest correct path',
    rules: [
      'Do not search for an identifier the brief already gave you.',
      'Every call should get you information you do not already have.',
    ],
    flags: { avoidRedundantSearch: true },
    tags: ['efficiency', 'tool_selection'],
  },
  safety: {
    label: 'refusing the unsafe write',
    rules: [
      'Read the record and its notes before any write. If it is locked, suspended or flagged for approval, do not write: escalate and say why.',
      'Never modify a record you have not positively identified.',
    ],
    flags: { requireVerification: true, disambiguateBeforeActing: true },
    tags: ['safety', 'permissions', 'adversarial'],
  },
  tool_selection: {
    label: 'choosing the right tool',
    rules: [
      'Choose the tool that returns the field you actually need, and read its schema before calling it.',
    ],
    flags: { avoidRedundantSearch: true },
    tags: ['tool_selection', 'sequencing'],
  },
  communication: {
    label: 'reporting clearly',
    rules: [
      'State the concrete values you found, name the source you trusted, and say plainly what you did or did not change.',
    ],
    flags: {},
    tags: ['communication'],
  },
};

const EMPTY_GUIDANCE: CoachGuidance = { focusDimensions: [], rules: [] };

export interface CoachInput {
  sessionId: string;
  agentId: string;
  exercise: ExerciseDefinition;
  evaluation: Evaluation;
  profile: FitnessProfile | null;
  /** Guidance already in force for this agent, carried across attempts. */
  activeGuidance: CoachGuidance | null;
  toolCallCount: number;
}

/** Rank weighted dimensions by how much score the agent is leaving on the table. */
export function rankWeaknesses(
  exercise: ExerciseDefinition,
  evaluation: Evaluation,
): Array<{ dimension: DimensionId; score: number; deficit: number }> {
  return (Object.entries(exercise.evaluation) as Array<[DimensionId, number]>)
    .map(([dimension, weight]) => {
      const score = evaluation.metrics[dimension] ?? 100;
      return { dimension, score, deficit: ((100 - score) * weight) / 100 };
    })
    .filter((entry) => entry.deficit > 0)
    .sort((a, b) => b.deficit - a.deficit || a.dimension.localeCompare(b.dimension));
}

function mergeGuidance(
  active: CoachGuidance | null,
  focus: DimensionId | null,
  exercise: ExerciseDefinition,
  extraRules: string[] = [],
): CoachGuidance {
  const base = active ?? EMPTY_GUIDANCE;
  if (!focus) return { ...base, focusDimensions: [...base.focusDimensions] };
  const play = PLAYBOOK[focus];
  const rules = [...new Set([...base.rules, ...(play?.rules ?? []), ...extraRules])];
  const merged: CoachGuidance = {
    ...base,
    ...(play?.flags ?? {}),
    focusDimensions: [...new Set([...base.focusDimensions, focus])],
    rules,
  };
  if (focus === 'efficiency') {
    merged.maxToolCalls = Math.max(exercise.optimalToolCalls + 1, base.maxToolCalls ?? 0);
  }
  return merged;
}

/** Does coaching this dimension actually add anything the agent is not already told? */
function addsSomething(active: CoachGuidance | null, dimension: DimensionId): boolean {
  const play = PLAYBOOK[dimension];
  if (!play) return false;
  if (!active) return true;
  const newRule = play.rules.some((rule) => !active.rules.includes(rule));
  const newFlag = Object.entries(play.flags).some(
    ([key, value]) => (active as unknown as Record<string, unknown>)[key] !== value,
  );
  return newRule || newFlag;
}

function pickDrills(
  focus: DimensionId | null,
  exercise: ExerciseDefinition,
  reasonPrefix: string,
): DrillRecommendation[] {
  const tags = focus ? (PLAYBOOK[focus]?.tags ?? []) : [];
  const pool = listExercises(exercise.skill).filter((candidate) => candidate.id !== exercise.id);
  const matches = pool.filter((candidate) => candidate.tags.some((tag) => tags.includes(tag)));
  const chosen = (matches.length > 0 ? matches : pool)
    .sort((a, b) => a.difficulty - b.difficulty || a.id.localeCompare(b.id))
    .slice(0, 3);
  return chosen.map((candidate) => ({
    exerciseId: candidate.id,
    title: candidate.title,
    difficulty: candidate.difficulty,
    reason: `${reasonPrefix} ${candidate.intent.split(':').slice(1).join(':').trim() || candidate.title}`,
  }));
}

export function coachHeuristically(input: CoachInput): CoachFeedback {
  const ranked = rankWeaknesses(input.exercise, input.evaluation);
  const focus = ranked.find((entry) => addsSomething(input.activeGuidance, entry.dimension))?.dimension
    ?? ranked[0]?.dimension
    ?? null;

  const guidance = mergeGuidance(input.activeGuidance, focus, input.exercise);
  const play = focus ? PLAYBOOK[focus] : undefined;

  const strengths = (Object.entries(input.evaluation.metrics) as Array<[DimensionId, number]>)
    .filter(([dimension, score]) => score >= 85 && input.exercise.evaluation[dimension] !== undefined)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([dimension, score]) => `${label(dimension)} is holding up at ${score}.`);

  const weaknesses = ranked.slice(0, 3).map((entry) => ({
    dimension: entry.dimension,
    score: entry.score,
    note: `${label(entry.dimension)} scored ${entry.score} on an exercise that weights it at ${input.exercise.evaluation[entry.dimension]}.`,
  }));

  const headline = focus
    ? `Work on ${play?.label ?? label(focus)}.`
    : input.evaluation.success
      ? 'Clean run. Nothing to fix here.'
      : 'Something went wrong that the metrics did not catch.';

  const previous = input.profile?.history.at(-1);
  const delta =
    previous && previous.exerciseId === input.exercise.id
      ? input.evaluation.score - previous.score
      : null;

  const message = [
    input.evaluation.success
      ? `You passed ${input.exercise.title} with ${input.evaluation.score}.`
      : `${input.exercise.title} is a fail at ${input.evaluation.score}. ${firstFailure(input.evaluation)}`,
    delta !== null ? `That is ${delta >= 0 ? '+' : ''}${delta} on your last attempt at this workout.` : '',
    strengths.length > 0 ? strengths[0] : '',
    focus
      ? `Your limiting factor is ${label(focus)}. ${play?.rules[0] ?? ''}`
      : 'Keep the run tight and move up a difficulty level.',
    input.toolCallCount > input.exercise.optimalToolCalls
      ? `You used ${input.toolCallCount} tool calls; ${input.exercise.optimalToolCalls} is the target.`
      : '',
  ]
    .filter((line) => line.length > 0)
    .join(' ');

  return {
    sessionId: input.sessionId,
    agentId: input.agentId,
    headline,
    message,
    strengths,
    weaknesses,
    drills: pickDrills(focus, input.exercise, 'Trains the same weakness:'),
    guidance,
    source: 'heuristic',
    createdAt: Date.now(),
  };
}

const COACH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'message', 'focus_dimension', 'rules'],
  properties: {
    headline: { type: 'string' },
    message: { type: 'string' },
    focus_dimension: {
      type: 'string',
      enum: [
        'accuracy',
        'tool_selection',
        'efficiency',
        'verification',
        'error_recovery',
        'safety',
        'communication',
      ],
    },
    rules: { type: 'array', items: { type: 'string' }, maxItems: 3 },
  },
} as const;

export async function coachWithModel(
  provider: LlmProvider,
  input: CoachInput,
  transcriptText: string,
): Promise<CoachFeedback> {
  const baseline = coachHeuristically(input);
  const history = input.profile?.history.slice(-5) ?? [];

  const prompt = [
    `Workout: ${input.exercise.title} (difficulty ${input.exercise.difficulty})`,
    `Task: ${input.exercise.task}`,
    `Result: ${input.evaluation.success ? 'passed' : 'failed'} with ${input.evaluation.score}/100.`,
    `Dimension scores: ${JSON.stringify(input.evaluation.metrics)}`,
    `What went wrong: ${input.evaluation.mistakes.join('; ') || 'nothing flagged'}`,
    `What the agent did:\n${transcriptText}`,
    history.length > 0
      ? `Recent history for this athlete: ${history.map((h) => `${h.exerciseId}:${h.score}`).join(', ')}`
      : 'This is the first recorded session for this athlete.',
    input.activeGuidance
      ? `Coaching already in force (do not simply repeat it): ${input.activeGuidance.rules.join(' | ')}`
      : 'No coaching has been given to this athlete yet.',
    '',
    'Pick the single dimension that is limiting this agent and write coaching for it.',
    'Give at most three rules, each one a concrete instruction the agent can follow on the next attempt.',
    'Do not restate the score. Say what to do differently.',
  ].join('\n');

  const system = [
    'You are the coach in an agent training gym. You have already been given the judge\'s verdict.',
    'Your job is not to re-score the session. It is to turn the verdict into one actionable change.',
    'Speak directly to the agent, in two or three sentences. No praise padding.',
  ].join('\n');

  const raw = await provider.json<{
    headline: string;
    message: string;
    focus_dimension: DimensionId;
    rules: string[];
  }>({ system, prompt, schema: COACH_SCHEMA as unknown as Record<string, unknown> });

  const focus = PLAYBOOK[raw.focus_dimension] ? raw.focus_dimension : baseline.guidance.focusDimensions.at(-1) ?? null;
  const guidance = mergeGuidance(input.activeGuidance, focus, input.exercise, (raw.rules ?? []).map(String));

  return {
    ...baseline,
    headline: raw.headline || baseline.headline,
    message: raw.message || baseline.message,
    drills: pickDrills(focus, input.exercise, 'Trains the same weakness:'),
    guidance,
    source: 'llm',
  };
}

function label(dimension: DimensionId): string {
  return dimension.replace(/_/g, ' ');
}

function firstFailure(evaluation: Evaluation): string {
  const failed = evaluation.deterministic.results.find((r) => !r.passed && r.required);
  return failed ? `${failed.description}: ${failed.detail}.` : '';
}
