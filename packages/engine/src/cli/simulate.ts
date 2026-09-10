/**
 * Run one workout end to end, with no frontend involved.
 *
 *   npm run simulate -- --exercise tool-007 --agent DataBot
 *   npm run simulate -- --exercise tool-004 --provider anthropic --model claude-opus-5
 *
 * This is the vertical slice the whole product rests on: exercise -> trainee
 * -> tool call -> sandbox -> tool result -> evaluation -> score -> coach.
 */

import { parseArgs, c } from './format.ts';
import { printSession } from './render.ts';
import { GymOrchestrator } from '../orchestrator/orchestrator.ts';
import { GymStore } from '../store/repositories.ts';
import { createEvaluatorProvider, providerAvailable } from '../providers/factory.ts';
import { listExercises, requireExercise } from '../exercises/catalog.ts';
import type { ProviderKind } from '../domain/types.ts';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help === 'true') {
    console.log(
      [
        'Usage: npm run simulate -- [options]',
        '',
        '  --exercise <id>    exercise to run (default tool-001)',
        '  --agent <name>     trainee name (default DataBot)',
        '  --provider <kind>  heuristic | anthropic | openai_compatible (default heuristic)',
        '  --model <id>       model or policy id',
        '  --db <path>        sqlite file, or :memory: (default .gym/gym.db)',
        '  --fresh            start this agent with no coaching history',
        '  --list             list the available exercises and exit',
      ].join('\n'),
    );
    return;
  }

  if (args.list === 'true') {
    for (const exercise of listExercises()) {
      console.log(
        `${exercise.id}  L${exercise.difficulty}  ${exercise.title.padEnd(22)} ${c.dim(exercise.intent)}`,
      );
    }
    return;
  }

  const exerciseId = args.exercise ?? 'tool-001';
  const exercise = requireExercise(exerciseId);
  const provider = (args.provider ?? 'heuristic') as ProviderKind;

  if (!providerAvailable(provider)) {
    console.error(
      c.red(
        `Provider "${provider}" has no credentials configured. Set ANTHROPIC_API_KEY (or GYM_OPENAI_API_KEY and GYM_OPENAI_BASE_URL), or use --provider heuristic.`,
      ),
    );
    process.exitCode = 1;
    return;
  }

  const store = new GymStore(args.db ?? undefined);
  const agentName = args.agent ?? 'DataBot';
  const existing = store.listAgents().find((a) => a.name === agentName && a.provider === provider);
  const agent =
    existing ??
    store.createAgent({
      name: agentName,
      provider,
      model: args.model ?? (provider === 'heuristic' ? 'reflex-v1' : 'claude-opus-5'),
      maxSteps: Number(args.maxSteps ?? 12),
    });

  const orchestrator = new GymOrchestrator({
    store,
    judgeProvider: createEvaluatorProvider('judge'),
    coachProvider: createEvaluatorProvider('coach'),
  });

  console.log('');
  console.log(`${c.bold('AI AGENT GYM')}  ${c.dim('tool usage')}`);
  console.log(`${c.dim('agent')} ${agent.name} (${agent.provider}:${agent.model})`);
  console.log('');

  const result = await orchestrator.run({
    agentId: agent.id,
    exerciseId: exercise.id,
    ...(args.fresh === 'true' ? { guidance: null } : {}),
  });

  printSession(result);
  store.close();
}

main().catch((error) => {
  console.error(c.red(error instanceof Error ? error.stack ?? error.message : String(error)));
  process.exitCode = 1;
});
