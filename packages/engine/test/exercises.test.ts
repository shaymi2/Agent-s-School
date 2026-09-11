import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { getExercise, listExercises, listSkills, validateExercise } from '../src/exercises/catalog.ts';
import { TOOL_REGISTRY } from '../src/tools/registry.ts';

describe('exercise catalog', () => {
  test('ships at least ten tool-usage exercises', () => {
    const exercises = listExercises('tool_usage');
    assert.ok(exercises.length >= 10, `expected 10 or more, got ${exercises.length}`);
  });

  test('covers the full difficulty ladder', () => {
    const levels = new Set(listExercises('tool_usage').map((e) => e.difficulty));
    for (const level of [1, 2, 3, 4, 5, 6]) {
      assert.ok(levels.has(level), `no exercise at difficulty ${level}`);
    }
  });

  test('every exercise exposes only tools the registry implements', () => {
    for (const exercise of listExercises()) {
      for (const tool of exercise.availableTools) {
        assert.ok(TOOL_REGISTRY[tool], `${exercise.id} lists unknown tool ${tool}`);
      }
    }
  });

  test('every exercise weights its dimensions to exactly 100', () => {
    for (const exercise of listExercises()) {
      const total = Object.values(exercise.evaluation).reduce((sum, n) => sum + (n ?? 0), 0);
      assert.equal(total, 100, `${exercise.id} weights sum to ${total}`);
    }
  });

  test('every exercise has at least one required assertion', () => {
    for (const exercise of listExercises()) {
      assert.ok(
        exercise.assertions.some((a) => a.required),
        `${exercise.id} can never be failed`,
      );
    }
  });

  test('environment events reference tools the exercise actually offers', () => {
    for (const exercise of listExercises()) {
      for (const rule of exercise.environment.events ?? []) {
        assert.ok(
          exercise.availableTools.includes(rule.trigger),
          `${exercise.id} injects ${rule.response} on ${rule.trigger}, which it does not expose`,
        );
        assert.ok(rule.occurrences >= 1, `${exercise.id} has an event that can never fire`);
      }
    }
  });

  test('the catalog covers every environment event kind the engine implements', () => {
    const used = new Set(
      listExercises().flatMap((e) => (e.environment.events ?? []).map((r) => r.response)),
    );
    for (const kind of ['API_TIMEOUT', 'API_503', 'INCOMPLETE_RESPONSE', 'CONFLICTING_DATA']) {
      assert.ok(used.has(kind as never), `no exercise exercises ${kind}`);
    }
  });

  test('the six gyms are declared and only tool usage is active', () => {
    const skills = listSkills();
    assert.equal(skills.length, 6);
    assert.deepEqual(
      skills.filter((s) => s.status === 'active').map((s) => s.id),
      ['tool_usage'],
    );
  });

  test('a malformed exercise is rejected at load time, not at scoring time', () => {
    const base = getExercise('tool-001')!;
    assert.throws(
      () => validateExercise({ ...base, evaluation: { accuracy: 50 } }),
      /weights must sum to 100/,
    );
    assert.throws(
      () => validateExercise({ ...base, availableTools: ['teleport_customer'] }),
      /unknown tool/,
    );
    assert.throws(
      () =>
        validateExercise({
          ...base,
          assertions: [{ ...base.assertions[0], kind: 'vibes_check' as never }],
        }),
      /unknown assertion kind/,
    );
  });

  test('an assertion may only score a dimension the exercise weights', () => {
    const base = getExercise('tool-001')!;
    assert.throws(
      () =>
        validateExercise({
          ...base,
          assertions: [{ ...base.assertions[0], category: 'reasoning' as never }],
        }),
      /carries no weight/,
    );
  });

  test('reading the catalog cannot mutate it', () => {
    const first = listExercises('tool_usage')[0];
    first.task = 'tampered';
    assert.notEqual(listExercises('tool_usage')[0].task, 'tampered');
  });
});
