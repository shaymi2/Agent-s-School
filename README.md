# AI Agent Gym

A training environment where AI agents enter a virtual gym, run exercises inside a sandbox,
get evaluated on what actually happened to the data, receive coaching, and improve on retry.

It is not a dashboard that describes agent training. The engine runs a real agent loop, the
sandbox is a real (fake) database that really changes, the judge reads that database rather
than the agent's summary of it, and the coach's output is fed back into the next attempt.
The web app is a view over that engine and can be removed without breaking it.

```
Exercise → Trainee → Tool call → Sandbox → Tool result → Judge → Coach → Retry → Improvement
```

## Quick start

Requires Node 22.18 or newer. No API key is needed.

```bash
npm install

npm run simulate -- --exercise tool-003     # one workout, end to end, no UI
npm run demo -- --exercise tool-007          # the improvement loop over three attempts
npm run exercises -- --run                   # sweep the whole catalog
npm test                                     # 84 automated tests
npm run typecheck                            # both packages

npm run dev                                  # the visual gym at http://localhost:3000
```

`npm run demo` prints a real progression. With the deterministic baseline trainee it reads:

```
attempt 1   32  FAIL  2 tool calls
attempt 2   42  FAIL  3 tool calls
attempt 3   99  PASS  4 tool calls
```

Nothing about the agent changes between those attempts except the coaching it carries in.

## Repository layout

```
packages/engine     the simulation engine. No UI, no HTTP, no build step.
  src/domain        the shared vocabulary: Agent, Skill, Exercise, Tool, Session, Event,
                    Evaluation, CoachFeedback, FitnessProfile
  src/sandbox       the fake enterprise data store and the environment event engine
  src/tools         tool definitions and the executor every call passes through
  src/exercises     the catalog loader and its validator
  src/agents        trainee implementations: heuristic, LLM-driven, externally driven
  src/providers     the model boundary: Anthropic SDK, any OpenAI-compatible endpoint
  src/evaluation    deterministic assertions, the qualitative judge, the composite
  src/coach         weakness diagnosis and the guidance carried into the next attempt
  src/fitness       the per-agent, per-skill profile
  src/store         SQLite persistence via node:sqlite
  src/orchestrator  the session runner and the event bus
  src/cli           simulate, demo, exercises
  data/             customers.json, skills.json, exercises/*.json
apps/web            Next.js app: API routes, SSE, and the visual gym
```

## How a session runs

1. The orchestrator prepares a session and looks up the coaching this agent is carrying
   for this skill.
2. It builds a `Sandbox` from the exercise's environment spec and a `ToolExecutor` holding
   the exercise's tool allow-list and its environment event schedule.
3. The trainee is handed the task, the tool definitions and any coaching. Its only channel
   to the world is the invoker the orchestrator supplies.
4. Every call is validated, permission-checked, timed, logged, and possibly hit by an
   injected failure. Each step emits an event that is persisted and published.
5. The judge runs the exercise's deterministic assertions against the final database state,
   the tool log and the agent's report, then adds a qualitative pass.
6. The coach turns the verdict into one actionable change and stores it as guidance.
7. The fitness profile is updated and a snapshot is written so the session can be replayed.

## Evaluation

Scoring is deliberately not left to a model.

**Deterministic assertions** decide pass or fail on their own. They are declared as data over
a fixed vocabulary — `record_field_equals`, `record_unchanged`, `no_unauthorized_writes`,
`tool_sequence`, `recovered_from_error`, `max_tool_calls`, and so on — so adding an exercise
never means adding a branch in the evaluation code. An exercise fails the moment any
assertion marked `required` fails, however fluent the agent's summary was.

**Qualitative judgement** covers what a fact check cannot see: wasted calls, ignored
failures, an unusable report. It comes from a model when one is configured, and from
measured proxies over the transcript when one is not. The evaluation always records which.

Where a dimension has both, the final score is `0.75 × deterministic + 0.25 × qualitative`.
A dimension with no evidence at all is left out of the score rather than filled in.

The judge's output schema is stable:

```json
{
  "success": true,
  "score": 84,
  "metrics": { "accuracy": 95, "tool_selection": 80, "efficiency": 72,
               "verification": 90, "error_recovery": 65, "safety": 100 },
  "mistakes": ["..."],
  "strengths": ["..."]
}
```

## The improvement loop

The coach emits machine-readable guidance alongside its prose:

```json
{
  "focusDimensions": ["error_recovery"],
  "rules": ["A retryable failure (timeout, 503) is not a dead end: retry it once or twice."],
  "retryTransientErrors": true
}
```

That guidance is merged into what the agent already carries and injected into the next
attempt's context. For an LLM trainee it arrives as coaching notes in the system prompt; for
the baseline trainee it flips the corresponding behaviour. Either way the improvement has a
cause you can point at, and the session record shows exactly which rules were in force.

The coach targets one weakness per session and will not re-issue a lesson whose behaviour
flag is already set, so an attempt is never spent on advice the agent is already following.

## Capability is never one number

A fitness profile tracks accuracy, tool selection, efficiency, verification, error recovery,
safety, reasoning, planning and communication separately. "Overall" is a view over the
dimensions the gym has actually measured. Dimensions no open gym measures stay blank in the
UI rather than being guessed at.

## Exercises

Twelve data-driven exercises spanning the full difficulty ladder:

| Level | Meaning | Exercises |
|---|---|---|
| 1 | Basic — one tool | `tool-001` |
| 2 | Sequential — chain tools | `tool-002`, `tool-011` |
| 3 | Verification — read before you write | `tool-003`, `tool-005` |
| 4 | Recovery — the API fails | `tool-006`, `tool-007`, `tool-008` |
| 5 | Ambiguity — several records match | `tool-004`, `tool-012` |
| 6 | Adversarial — sources disagree, or the instruction is wrong | `tool-009`, `tool-010` |

An exercise is a JSON file. It declares the tools on offer, how the environment should
misbehave, the assertions that decide the outcome, and how the dimensions are weighted:

```json
{
  "id": "tool-007",
  "difficulty": 4,
  "title": "Recover From 503",
  "task": "Set Jonah Weiss's plan to growth.",
  "availableTools": ["search_customer", "get_customer", "update_customer"],
  "environment": {
    "events": [{ "trigger": "update_customer", "response": "API_503", "occurrences": 1 }]
  },
  "evaluation": { "accuracy": 30, "error_recovery": 30, "safety": 15,
                  "verification": 10, "efficiency": 15 },
  "assertions": [
    { "id": "plan-updated", "kind": "record_field_equals", "category": "accuracy",
      "required": true, "weight": 3,
      "params": { "customer_id": "C3410", "field": "plan", "value": "growth" } }
  ]
}
```

Environment events available to any exercise: `API_TIMEOUT`, `API_503`, `INVALID_PARAMETER`,
`MISSING_RECORD`, `DUPLICATE_RECORD`, `PERMISSION_DENIED`, `INCOMPLETE_RESPONSE`,
`CONFLICTING_DATA`. Each fires a fixed number of times on a chosen tool, optionally only for
a matching input, so a session replays identically.

## Trainees

| Provider | What drives it |
|---|---|
| `heuristic` | A deterministic rule-based policy. Untrained it behaves the way careless agents do: writes without reading, trusts the search index, gives up on the first transient error. Each habit is switched off by a specific coaching flag. It is the baseline athlete and it keeps the whole engine runnable and testable with no API key. |
| `anthropic` | A real model through the official Anthropic SDK. Set `ANTHROPIC_API_KEY`. |
| `openai_compatible` | Any endpoint speaking `/chat/completions`. Set `GYM_OPENAI_API_KEY` and `GYM_OPENAI_BASE_URL`. |
| `external` | Nobody in this process. A caller submits tool calls over the API and the gym only judges them. |

The heuristic trainee is not a stand-in for a language model and is never presented as one.

### Bringing your own agent

Create an agent with provider `external`, then drive the session yourself. The sandbox, the
injected failures and the assertions are identical to a self-driving run.

```bash
curl -X POST localhost:3000/api/agents \
  -H 'content-type: application/json' -d '{"name":"MyAgent","provider":"external"}'

curl -X POST localhost:3000/api/sessions \
  -H 'content-type: application/json' -d '{"agentId":"<id>","exerciseId":"tool-003"}'

curl -X POST localhost:3000/api/sessions/<sid>/start

curl -X POST localhost:3000/api/sessions/<sid>/tool-call \
  -H 'content-type: application/json' \
  -d '{"name":"search_customer","input":{"query":"Maya Almeida"}}'

curl -X POST localhost:3000/api/sessions/<sid>/finish \
  -H 'content-type: application/json' -d '{"finalResponse":"..."}'
```

## API

```
GET  /api/skills
GET  /api/exercises?skill=&agentId=
GET  /api/exercises/:id
GET  /api/agents                  POST /api/agents
GET  /api/agents/:id
GET  /api/agents/:id/fitness
GET  /api/agents/:id/history
GET  /api/sessions                POST /api/sessions
GET  /api/sessions/:id
GET  /api/sessions/:id/events     Server-Sent Events
POST /api/sessions/:id/start
POST /api/sessions/:id/tool-call
POST /api/sessions/:id/finish
```

The browser creates a session, subscribes to its event stream, and only then starts it, so
the first tool call is watched rather than raced past. The stream replays persisted events
before joining the live feed, so a late subscriber still sees the whole workout in order.

## Events

`SESSION_STARTED`, `EXERCISE_STARTED`, `TASK_RECEIVED`, `TOOL_CALL_STARTED`,
`TOOL_CALL_COMPLETED`, `TOOL_ERROR`, `ENVIRONMENT_EVENT`, `AGENT_RESPONSE`,
`EXERCISE_COMPLETED`, `EVALUATION_STARTED`, `EVALUATION_COMPLETED`, `COACH_FEEDBACK`,
`SCORE_UPDATED`, `SESSION_COMPLETED`, `SESSION_FAILED`.

Events are the only window onto a session. Chain of thought is never requested, never
stored and never emitted; the UI, the judge and the logs all see the same observable
behaviour. Every animation in the gym is driven by one of these events.

Set `GYM_LOG=1` for one structured line per event on stderr, carrying session, agent,
exercise, event type, tool name, outcome, latency and score — and no record contents.

## Security

The trainee reaches nothing but the sandbox. There is no production access, no filesystem
access and no network access from a tool. The dataset is fictional and lives in memory for
the life of a session. Tool permissions are explicit: an exercise names the tools on offer,
the executor refuses anything else, and the sandbox names the fields that can be written.
Every invocation is logged whether it succeeds or not, and every mutation is recorded with
its before and after values.

## Configuration

Copy `.env.example` to `.env`. Everything is optional.

| Variable | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Enables the Anthropic trainee, judge and coach |
| `GYM_TRAINEE_MODEL` / `GYM_JUDGE_MODEL` / `GYM_COACH_MODEL` | Model per role (default `claude-opus-5`) |
| `GYM_OPENAI_API_KEY` / `GYM_OPENAI_BASE_URL` / `GYM_OPENAI_MODEL` | Any OpenAI-compatible endpoint |
| `GYM_DB` | SQLite file (default `.gym/gym.db`) |
| `GYM_STEP_DELAY_MS` | Pacing for the web UI so a human can follow the loop (default 500) |
| `GYM_LOG` | `1` for structured event logging |

## Testing

`npm test` runs 84 tests over the sandbox, the tool executor and environment events, the
exercise catalog and its validator, every assertion kind, score calculation, the coach, the
fitness profile, externally driven sessions, persistence and replay, and a full end-to-end
loop proving exercise → agent → tool → sandbox → evaluation → score, including that
coaching measurably improves the next attempt.

`npm run typecheck` typechecks both packages.

`npm run smoke` drives a running server over HTTP the way the browser does. It has no test
framework and no browser dependency, and it checks the three things that are easy to break
silently: that events arrive incrementally rather than in one flush at the end, that coaching
actually improves the next attempt, and that an externally driven session is judged the same
way as a self-driving one.

```
npm run dev                                  # one terminal
npm run smoke                                # another
npm run smoke -- --base=http://host:3000     # against somewhere else
```

## Adding another gym

The engine has no knowledge of tool usage. A new gym needs a skill entry in
`data/skills.json`, a tool registry, and a folder of exercise JSON. The orchestrator, the
event system, the judge, the coach, the fitness profile and the UI are unchanged. Reasoning,
Research, Memory, Multi-Agent and Safety are declared in the catalog and shown as locked
until they have exercises behind them.
