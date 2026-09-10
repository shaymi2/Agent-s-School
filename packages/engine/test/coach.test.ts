import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { coachHeuristically, rankWeaknesses } from '../src/coach/coach.ts';
import { requireExercise } from '../src/exercises/catalog.ts';
import { applySession, emptyProfile, progressionFor } from '../src/fitness/profile.ts';
import type { CoachInput } from '../src/coach/coach.ts';
import type { Evaluation, Session } from '../src/domain/types.ts';

function evaluation(overrides: Partial<Evaluation> = {}): Evaluation {
  return {
    sessionId: 'sess_1',
    success: false,
    score: 40,
    metrics: { accuracy: 100, error_recovery: 0, verification: 0, safety: 100, efficiency: 100 },
    mistakes: ['Retried update_customer after the 503 and succeeded (never retried)'],
    strengths: [],
    deterministic: {
      passed: 2,
      failed: 1,
      results: [
        {
          id: 'recovered',
          kind: 'recovered_from_error',
          category: 'error_recovery',
          description: 'Retried update_customer after the 503 and succeeded',
          required: true,
          weight: 3,
          passed: false,
          detail: 'update_customer failed and was never retried successfully',
        },
      ],
    },
    qualitative: { source: 'heuristic', metrics: {}, notes: [] },
    createdAt: Date.now(),
    ...overrides,
  };
}

function input(overrides: Partial<CoachInput> = {}): CoachInput {
  return {
    sessionId: 'sess_1',
    agentId: 'agent_1',
    exercise: requireExercise('tool-007'),
    evaluation: evaluation(),
    profile: null,
    activeGuidance: null,
    toolCallCount: 3,
    ...overrides,
  };
}

describe('coach', () => {
  test('ranks weaknesses by how much score they actually cost', () => {
    const ranked = rankWeaknesses(requireExercise('tool-007'), evaluation());
    assert.equal(ranked[0].dimension, 'error_recovery', 'a 30-weight zero outranks a 10-weight zero');
    assert.equal(ranked.at(-1)?.dimension, 'verification');
    assert.ok(ranked.every((entry) => entry.deficit > 0), 'perfect dimensions are not weaknesses');
  });

  test('turns the top weakness into machine-readable guidance', () => {
    const feedback = coachHeuristically(input());
    assert.equal(feedback.guidance.retryTransientErrors, true);
    assert.ok(feedback.guidance.focusDimensions.includes('error_recovery'));
    assert.ok(feedback.guidance.rules.length > 0);
  });

  test('guidance accumulates across attempts instead of being replaced', () => {
    const first = coachHeuristically(input());
    const second = coachHeuristically(
      input({
        activeGuidance: first.guidance,
        evaluation: evaluation({ metrics: { accuracy: 100, error_recovery: 100, verification: 0, safety: 100, efficiency: 100 } }),
      }),
    );
    assert.equal(second.guidance.retryTransientErrors, true, 'the earlier lesson is kept');
    assert.equal(second.guidance.requireVerification, true, 'the new lesson is added');
    assert.ok(second.guidance.rules.length > first.guidance.rules.length);
  });

  test('does not re-issue coaching the agent is already following', () => {
    const first = coachHeuristically(input());
    const second = coachHeuristically(input({ activeGuidance: first.guidance }));
    assert.notEqual(
      second.guidance.focusDimensions.at(-1),
      'error_recovery',
      'the coach must move on rather than repeat itself',
    );
  });

  test('says something different from the judge', () => {
    const feedback = coachHeuristically(input());
    assert.ok(feedback.message.length > 40);
    assert.ok(feedback.drills.length > 0, 'coaching without a next workout is not coaching');
    for (const drill of feedback.drills) {
      assert.notEqual(drill.exerciseId, 'tool-007', 'a drill is a different workout');
      assert.ok(drill.reason.length > 0);
    }
  });

  test('recommends drills that train the diagnosed weakness', () => {
    const feedback = coachHeuristically(input());
    const recovery = requireExercise(feedback.drills[0].exerciseId);
    assert.ok(
      recovery.tags.some((tag) => ['recovery', 'transient_errors'].includes(tag)),
      `${recovery.id} does not train error recovery`,
    );
  });

  test('a clean run gets no busywork', () => {
    const feedback = coachHeuristically(
      input({
        evaluation: evaluation({
          success: true,
          score: 100,
          metrics: { accuracy: 100, error_recovery: 100, verification: 100, safety: 100, efficiency: 100 },
        }),
      }),
    );
    assert.match(feedback.headline, /Clean run/);
  });
});

describe('fitness profile', () => {
  const session: Session = {
    id: 'sess_1',
    agentId: 'agent_1',
    exerciseId: 'tool-007',
    skill: 'tool_usage',
    attempt: 1,
    status: 'completed',
    startedAt: 1,
    finishedAt: 2,
    guidance: null,
  };

  test('the first session seeds the dimensions directly', () => {
    const profile = applySession(null, session, evaluation(), null);
    assert.equal(profile.dimensions.accuracy?.current, 100);
    assert.equal(profile.dimensions.error_recovery?.current, 0);
    assert.equal(profile.attempts, 1);
    assert.equal(profile.successRate, 0);
  });

  test('later sessions move a dimension without erasing its history', () => {
    const first = applySession(null, session, evaluation(), null);
    const second = applySession(
      first,
      { ...session, id: 'sess_2', attempt: 2 },
      evaluation({ success: true, score: 90, metrics: { ...evaluation().metrics, error_recovery: 100 } }),
      null,
    );
    assert.ok(second.dimensions.error_recovery!.current > 0);
    assert.ok(second.dimensions.error_recovery!.current < 100, 'one good rep is not mastery');
    assert.equal(second.dimensions.error_recovery?.best, 100);
    assert.equal(second.dimensions.error_recovery?.samples, 2);
    assert.equal(second.attempts, 2);
    assert.equal(second.successes, 1);
    assert.equal(second.successRate, 50);
    assert.equal(second.bestScore, 90);
  });

  test('dimensions stay separate and overall is only a view over them', () => {
    const profile = applySession(null, session, evaluation(), null);
    const measured = Object.values(profile.dimensions).map((d) => d.current);
    const mean = Math.round(measured.reduce((a, b) => a + b, 0) / measured.length);
    assert.equal(profile.overall, mean);
    assert.ok(Object.keys(profile.dimensions).length >= 5, 'the breakdown survives the summary');
  });

  test('only genuinely weak dimensions are flagged', () => {
    const strong = applySession(
      null,
      session,
      evaluation({ metrics: { accuracy: 95, error_recovery: 90, safety: 100 } }),
      null,
    );
    assert.deepEqual(strong.weaknesses, []);
    const weak = applySession(null, session, evaluation(), null);
    assert.ok(weak.weaknesses.includes('error_recovery'));
  });

  test('progression tracks one exercise over time', () => {
    let profile = emptyProfile('agent_1', 'tool_usage');
    for (const [index, score] of [32, 42, 98].entries()) {
      profile = applySession(
        profile,
        { ...session, id: `sess_${index}`, attempt: index + 1 },
        evaluation({ score, success: score > 50 }),
        null,
      );
    }
    assert.deepEqual(progressionFor(profile, 'tool-007'), [32, 42, 98]);
    assert.deepEqual(progressionFor(profile, 'tool-001'), []);
  });
});
