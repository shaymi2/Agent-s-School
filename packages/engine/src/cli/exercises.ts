/**
 * Exercise catalog inspector, and a baseline sweep.
 *
 *   npm run exercises              list the catalog
 *   npm run exercises -- --run     run every exercise once and print a table
 *
 * The sweep is how you check that a change to the engine did not quietly
 * change what an exercise measures.
 */

import { parseArgs, c, rule } from './format.ts';
import { listExercises } from '../exercises/catalog.ts';
import { GymOrchestrator } from '../orchestrator/orchestrator.ts';
import { GymStore } from '../store/repositories.ts';
import type { ProviderKind } from '../domain/types.ts';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const exercises = listExercises(args.skill ?? 'tool_usage');

  if (args.run !== 'true') {
    console.log(rule('TOOL USAGE GYM'));
    for (const exercise of exercises) {
      console.log(`${c.bold(exercise.id)}  ${c.dim(`L${exercise.difficulty}`)}  ${exercise.title}`);
      console.log(`   ${c.dim(exercise.intent)}`);
      console.log(
        `   ${c.dim('tools')} ${exercise.availableTools.join(', ')}  ${c.dim('optimal')} ${exercise.optimalToolCalls} calls  ${c.dim('tags')} ${exercise.tags.join(', ')}`,
      );
    }
    return;
  }

  const provider = (args.provider ?? 'heuristic') as ProviderKind;
  const store = new GymStore(':memory:');
  const orchestrator = new GymOrchestrator({ store });

  const coached = args.coached === 'true';
  console.log(rule(coached ? 'BASELINE SWEEP (coached)' : 'BASELINE SWEEP (untrained)'));
  console.log(c.dim('exercise   lvl  score  result   calls  failed checks'));

  for (const exercise of exercises) {
    // A fresh athlete per exercise unless --coached, so each row is a baseline.
    const agent = store.createAgent({
      name: `sweep-${exercise.id}`,
      provider,
      model: provider === 'heuristic' ? 'reflex-v1' : 'claude-opus-5',
      maxSteps: 12,
    });
    let result = await orchestrator.run({ agentId: agent.id, exerciseId: exercise.id });
    if (coached) {
      result = await orchestrator.run({ agentId: agent.id, exerciseId: exercise.id });
    }
    const failed = result.evaluation.deterministic.results.filter((r) => !r.passed);
    console.log(
      `${exercise.id}  ${String(exercise.difficulty).padStart(3)}  ${String(result.evaluation.score).padStart(5)}  ${(result.evaluation.success ? c.green('PASS') : c.red('FAIL')).padEnd(6)}  ${String(result.transcript.calls.length).padStart(5)}  ${failed.map((f) => f.id).join(', ') || c.dim('none')}`,
    );
  }
  store.close();
}

main().catch((error) => {
  console.error(c.red(error instanceof Error ? error.stack ?? error.message : String(error)));
  process.exitCode = 1;
});
