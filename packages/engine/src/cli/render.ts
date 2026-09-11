/** Renders a finished session to the terminal, event by event. */

import { bar, c, rule } from './format.ts';
import type { GymEvent, SessionResult } from '../index.ts';

function summarise(event: GymEvent): string | null {
  const p = event.payload as Record<string, unknown>;
  switch (event.type) {
    case 'TASK_RECEIVED':
      return `${c.dim('TASK')}   ${String(p.task)}`;
    case 'TOOL_CALL_STARTED': {
      const call = p.call as { name: string; input: Record<string, unknown> };
      return `${c.cyan('AGENT')}  -> calling ${c.bold(call.name)}(${JSON.stringify(call.input)})`;
    }
    case 'TOOL_CALL_COMPLETED': {
      const call = p.call as { name: string };
      const result = p.result as { output: Record<string, unknown>; latencyMs: number };
      return `${c.green('TOOL')}   ${call.name} ok ${c.dim(`${result.latencyMs}ms`)} ${c.dim(preview(result.output))}`;
    }
    case 'TOOL_ERROR': {
      const call = p.call as { name: string };
      const result = p.result as { error?: { code: string; message: string } };
      return `${c.red('TOOL')}   ${call.name} ${c.red(result.error?.code ?? 'ERROR')}: ${result.error?.message}`;
    }
    case 'ENVIRONMENT_EVENT':
      return `${c.yellow('ENV')}    injected ${c.bold(String(p.kind))} on ${String(p.tool)}`;
    case 'AGENT_RESPONSE':
      return `${c.cyan('AGENT')}  ${indent(String(p.response))}`;
    default:
      return null;
  }
}

function preview(output: Record<string, unknown> | null): string {
  if (!output) return '';
  if (Array.isArray(output.results)) {
    return `${(output.results as unknown[]).length} of ${output.count} result(s)`;
  }
  if (output.customer && typeof output.customer === 'object') {
    const customer = output.customer as { id: string; name: string };
    return `${customer.name} (${customer.id})`;
  }
  if (output.success === true) return 'write applied';
  return JSON.stringify(output).slice(0, 80);
}

function indent(text: string): string {
  return text.split('\n').join('\n       ');
}

export function printSession(result: SessionResult, options: { showTimeline?: boolean } = {}): void {
  const { session, evaluation, feedback, profile, transcript } = result;
  const show = options.showTimeline ?? true;

  console.log(rule(`${transcript.exercise.title}  [level ${transcript.exercise.difficulty}]`));
  console.log(
    `${c.dim('exercise')} ${transcript.exercise.id}   ${c.dim('attempt')} ${session.attempt}   ${c.dim('tools')} ${transcript.exercise.availableTools.join(', ')}`,
  );
  if (session.guidance && session.guidance.rules.length > 0) {
    console.log(c.magenta(`coaching in force: ${session.guidance.rules.length} rule(s)`));
    for (const line of session.guidance.rules) console.log(c.dim(`  - ${line}`));
  }
  console.log('');

  if (show) {
    for (const event of result.events) {
      const line = summarise(event);
      if (line) console.log(line);
    }
    console.log('');
  }

  const verdict = evaluation.success ? c.green('SUCCESS') : c.red('FAILURE');
  console.log(`${c.bold('RESULT')}: ${verdict}    ${c.bold(`Score: ${evaluation.score}/100`)}`);
  console.log('');

  for (const [dimension, value] of Object.entries(evaluation.metrics)) {
    const weighted = transcript.exercise.evaluation[dimension as never] !== undefined;
    const name = dimension.replace(/_/g, ' ').padEnd(15);
    const suffix = weighted ? '' : c.dim(' (not scored in this workout)');
    console.log(`  ${name} ${bar(value as number)} ${String(value).padStart(3)}${suffix}`);
  }
  console.log('');

  console.log(c.bold('Deterministic checks'));
  for (const check of evaluation.deterministic.results) {
    const mark = check.passed ? c.green('PASS') : c.red('FAIL');
    const req = check.required ? c.dim(' [required]') : '';
    console.log(`  ${mark} ${check.description}${req}`);
    if (!check.passed) console.log(c.dim(`       ${check.detail}`));
  }
  console.log('');

  if (evaluation.qualitative.notes.length > 0) {
    console.log(c.bold(`Judge (${evaluation.qualitative.source}${evaluation.qualitative.model ? `: ${evaluation.qualitative.model}` : ''})`));
    for (const note of evaluation.qualitative.notes) console.log(`  - ${note}`);
    console.log('');
  }

  console.log(c.bold(`COACH  ${c.magenta(feedback.headline)}`));
  console.log(`  ${feedback.message}`);
  if (feedback.drills.length > 0) {
    console.log(c.dim('  recommended workouts:'));
    for (const drill of feedback.drills) {
      console.log(c.dim(`   - ${drill.exerciseId} ${drill.title} (level ${drill.difficulty})`));
    }
  }
  console.log('');

  console.log(
    `${c.bold('FITNESS')} overall ${profile.overall}   best ${profile.bestScore}   attempts ${profile.attempts}   success rate ${profile.successRate}%`,
  );
  if (profile.weaknesses.length > 0) {
    console.log(c.dim(`  weakest: ${profile.weaknesses.join(', ')}`));
  }
  console.log('');
}
