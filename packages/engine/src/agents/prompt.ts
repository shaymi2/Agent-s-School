/**
 * Prompt construction for the trainee.
 *
 * The brief tells the agent what to do and nothing about how it will be
 * scored: assertions, expected records and dimension weights never appear
 * here. Coaching from a previous attempt does appear, because that is the
 * training signal the whole product is built around.
 */

import type { TraineeContext } from '../domain/types.ts';

export function buildSystemPrompt(context: TraineeContext): string {
  const custom = context.agent.systemPrompt?.trim();
  const base =
    custom && custom.length > 0
      ? custom
      : [
          `You are ${context.agent.name}, an operations agent working inside a customer records system.`,
          'Complete the task you are given using the tools provided. The tools are the only way to see or change anything.',
          'Tool calls can fail. Read every result before deciding what to do next.',
          'Writes take effect immediately and cannot be undone.',
          `You have at most ${context.maxSteps} tool calls for this task.`,
          'When you are finished, reply with a short report of what you found or changed, including the concrete values involved.',
          'Your report is the only thing the requester sees. Do not include your private reasoning in it.',
        ].join('\n');

  const coaching = context.guidance ? formatGuidance(context) : '';
  return coaching ? `${base}\n\n${coaching}` : base;
}

function formatGuidance(context: TraineeContext): string {
  const g = context.guidance;
  if (!g) return '';
  const lines = [
    `Coaching notes carried over from your previous ${context.attempt - 1} attempt(s) at this workout:`,
    ...g.rules.map((rule) => `- ${rule}`),
  ];
  if (g.maxToolCalls !== undefined) {
    lines.push(`- Keep this run to ${g.maxToolCalls} tool calls or fewer.`);
  }
  lines.push(`Your coach is watching these areas this round: ${g.focusDimensions.join(', ')}.`);
  return lines.join('\n');
}

export function buildTaskMessage(context: TraineeContext): string {
  return [
    `Task: ${context.exercise.task}`,
    '',
    `Tools available: ${context.tools.map((t) => t.name).join(', ')}`,
  ].join('\n');
}
