/**
 * The exercise catalog.
 *
 * Exercises are data. The engine implements a fixed vocabulary of assertion
 * kinds and environment events; an exercise composes them. There is no
 * per-exercise branching anywhere in the engine, which is what lets a new gym
 * ship as a folder of JSON.
 */

import skillsData from '../../data/skills.json' with { type: 'json' };
import tool001 from '../../data/exercises/tool-001.json' with { type: 'json' };
import tool002 from '../../data/exercises/tool-002.json' with { type: 'json' };
import tool003 from '../../data/exercises/tool-003.json' with { type: 'json' };
import tool004 from '../../data/exercises/tool-004.json' with { type: 'json' };
import tool005 from '../../data/exercises/tool-005.json' with { type: 'json' };
import tool006 from '../../data/exercises/tool-006.json' with { type: 'json' };
import tool007 from '../../data/exercises/tool-007.json' with { type: 'json' };
import tool008 from '../../data/exercises/tool-008.json' with { type: 'json' };
import tool009 from '../../data/exercises/tool-009.json' with { type: 'json' };
import tool010 from '../../data/exercises/tool-010.json' with { type: 'json' };
import tool011 from '../../data/exercises/tool-011.json' with { type: 'json' };
import tool012 from '../../data/exercises/tool-012.json' with { type: 'json' };

import { TOOL_REGISTRY } from '../tools/registry.ts';
import { ALL_DIMENSIONS } from '../domain/types.ts';
import type { ExerciseDefinition, Skill } from '../domain/types.ts';

const RAW_EXERCISES: unknown[] = [
  tool001,
  tool002,
  tool003,
  tool004,
  tool005,
  tool006,
  tool007,
  tool008,
  tool009,
  tool010,
  tool011,
  tool012,
];

const VALID_ASSERTION_KINDS = new Set([
  'tool_called',
  'tool_not_called',
  'tool_call_count',
  'tool_sequence',
  'record_field_equals',
  'record_unchanged',
  'no_unauthorized_writes',
  'write_count',
  'final_response_contains',
  'final_response_mentions_all',
  'recovered_from_error',
  'max_tool_calls',
  'no_tool_errors_unhandled',
]);

/**
 * Validate at load time. A malformed exercise should fail the process, not
 * quietly produce a meaningless score six steps later.
 */
export function validateExercise(raw: unknown): ExerciseDefinition {
  const ex = raw as ExerciseDefinition;
  const where = `exercise ${ex?.id ?? '<unknown>'}`;
  if (!ex.id || !ex.skill || !ex.title || !ex.task) {
    throw new Error(`${where}: id, skill, title and task are required`);
  }
  if (!Number.isInteger(ex.difficulty) || ex.difficulty < 1 || ex.difficulty > 6) {
    throw new Error(`${where}: difficulty must be an integer 1-6`);
  }
  if (!Array.isArray(ex.availableTools) || ex.availableTools.length === 0) {
    throw new Error(`${where}: availableTools must be a non-empty array`);
  }
  for (const tool of ex.availableTools) {
    if (!TOOL_REGISTRY[tool]) throw new Error(`${where}: unknown tool "${tool}"`);
  }
  const weightTotal = Object.values(ex.evaluation).reduce((sum, n) => sum + (n ?? 0), 0);
  if (weightTotal !== 100) {
    throw new Error(`${where}: evaluation weights must sum to 100, got ${weightTotal}`);
  }
  for (const dim of Object.keys(ex.evaluation)) {
    if (!ALL_DIMENSIONS.includes(dim as never)) throw new Error(`${where}: unknown dimension "${dim}"`);
  }
  if (!Array.isArray(ex.assertions) || ex.assertions.length === 0) {
    throw new Error(`${where}: at least one assertion is required`);
  }
  const seen = new Set<string>();
  for (const assertion of ex.assertions) {
    if (seen.has(assertion.id)) throw new Error(`${where}: duplicate assertion id "${assertion.id}"`);
    seen.add(assertion.id);
    if (!VALID_ASSERTION_KINDS.has(assertion.kind)) {
      throw new Error(`${where}: unknown assertion kind "${assertion.kind}"`);
    }
    if (!ALL_DIMENSIONS.includes(assertion.category)) {
      throw new Error(`${where}: assertion "${assertion.id}" has unknown category "${assertion.category}"`);
    }
    if (ex.evaluation[assertion.category] === undefined) {
      throw new Error(
        `${where}: assertion "${assertion.id}" scores dimension "${assertion.category}", which carries no weight`,
      );
    }
  }
  if (!Number.isFinite(ex.optimalToolCalls) || ex.optimalToolCalls < 0) {
    throw new Error(`${where}: optimalToolCalls must be a non-negative number`);
  }
  return ex;
}

const EXERCISES: ExerciseDefinition[] = RAW_EXERCISES.map(validateExercise).sort((a, b) =>
  a.id.localeCompare(b.id),
);

const SKILLS: Skill[] = (skillsData.skills as Skill[]).map((s) => ({ ...s }));

export function listSkills(): Skill[] {
  return SKILLS.map((s) => ({ ...s }));
}

export function getSkill(id: string): Skill | undefined {
  const skill = SKILLS.find((s) => s.id === id);
  return skill ? { ...skill } : undefined;
}

export function listExercises(skill?: string): ExerciseDefinition[] {
  const all = skill ? EXERCISES.filter((e) => e.skill === skill) : EXERCISES;
  return all.map((e) => structuredClone(e));
}

export function getExercise(id: string): ExerciseDefinition | undefined {
  const found = EXERCISES.find((e) => e.id === id);
  return found ? structuredClone(found) : undefined;
}

export function requireExercise(id: string): ExerciseDefinition {
  const found = getExercise(id);
  if (!found) throw new Error(`Unknown exercise "${id}". Known: ${EXERCISES.map((e) => e.id).join(', ')}`);
  return found;
}
