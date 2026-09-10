/**
 * The improvement loop, demonstrated.
 *
 *   npm run demo -- --exercise tool-007 --attempts 3
 *
 * Runs the same workout several times with a fresh athlete. Nothing about the
 * trainee changes between attempts except the coaching it carries in, so the
 * score movement is caused by the coaching and by nothing else.
 */

import { parseArgs, c, bar, rule } from './format.ts';
import { printSession } from './render.ts';
import { GymOrchestrator } from '../orchestrator/orchestrator.ts';
import { GymStore } from '../store/repositories.ts';
import { createEvaluatorProvider, providerAvailable } from '../providers/factory.ts';
import { requireExercise } from '../exercises/catalog.ts';
import type { ProviderKind } from '../domain/types.ts';
import type { SessionResult } from '../orchestrator/orchestrator.ts';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const exercise = requireExercise(args.exercise ?? 'tool-007');
  const attempts = Number(args.attempts ?? 3);
  const provider = (args.provider ?? 'heuristic') as ProviderKind;

  if (!providerAvailable(provider)) {
    console.error(c.red(`Provider "${provider}" has no credentials configured.`));
    process.exitCode = 1;
    return;
  }

  // A throwaway database: the demo is about one athlete's first few sessions.
  const store = new GymStore(args.db ?? ':memory:');
  const agent = store.createAgent({
    name: args.agent ?? 'DataBot',
    provider,
    model: args.model ?? (provider === 'heuristic' ? 'reflex-v1' : 'claude-opus-5'),
    maxSteps: 12,
  });
  const orchestrator = new GymOrchestrator({
    store,
    judgeProvider: createEvaluatorProvider('judge'),
    coachProvider: createEvaluatorProvider('coach'),
  });

  console.log('');
  console.log(`${c.bold('AI AGENT GYM')}  ${c.dim('improvement loop')}`);
  console.log(`${c.dim('athlete')} ${agent.name} (${agent.provider}:${agent.model})`);
  console.log(`${c.dim('workout')} ${exercise.id} ${exercise.title} (level ${exercise.difficulty})`);
  console.log('');

  const results: SessionResult[] = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    console.log(rule(`ATTEMPT ${attempt}`));
    const result = await orchestrator.run({ agentId: agent.id, exerciseId: exercise.id });
    printSession(result, { showTimeline: true });
    results.push(result);
  }

  console.log(rule('PROGRESSION'));
  for (const result of results) {
    const verdict = result.evaluation.success ? c.green('PASS') : c.red('FAIL');
    console.log(
      `  attempt ${result.session.attempt}  ${bar(result.evaluation.score, 30)} ${String(result.evaluation.score).padStart(3)}  ${verdict}  ${c.dim(`${result.transcript.calls.length} tool calls`)}`,
    );
  }
  const first = results[0]?.evaluation.score ?? 0;
  const last = results.at(-1)?.evaluation.score ?? 0;
  console.log('');
  console.log(
    `  ${c.bold(`${first} -> ${last}`)}  ${last >= first ? c.green(`+${last - first}`) : c.red(String(last - first))} across ${attempts} attempts`,
  );
  console.log('');
  console.log(c.dim('  coaching applied between attempts:'));
  for (const result of results.slice(0, -1)) {
    console.log(c.dim(`   after attempt ${result.session.attempt}: ${result.feedback.headline}`));
    for (const rule_ of result.feedback.guidance.rules) console.log(c.dim(`     - ${rule_}`));
  }
  console.log('');

  store.close();
}

main().catch((error) => {
  console.error(c.red(error instanceof Error ? error.stack ?? error.message : String(error)));
  process.exitCode = 1;
});
