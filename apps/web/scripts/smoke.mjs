/**
 * HTTP smoke test for a running gym server.
 *
 *   npm run dev            # in one terminal
 *   npm run smoke          # in another
 *
 * Drives the public API the way the browser does — create a session, subscribe
 * to its stream, start it — and checks the three things that are easy to break
 * without noticing: that events arrive incrementally rather than all at the
 * end, that coaching actually improves the next attempt, and that an outside
 * caller can drive a session and be judged the same way.
 *
 * No test framework and no browser: it is plain fetch against a live server.
 */

const base = (process.argv.find((a) => a.startsWith('--base='))?.split('=')[1] ?? 'http://localhost:3000').replace(
  /\/+$/,
  '',
);

let failures = 0;

function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
}

async function get(path) {
  const response = await fetch(`${base}${path}`);
  if (!response.ok) throw new Error(`GET ${path} -> ${response.status}`);
  return response.json();
}

async function post(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`POST ${path} -> ${response.status}: ${payload.error ?? ''}`);
  return payload;
}

/**
 * Subscribe, start, and record when each event arrived. The arrival spread is
 * the thing worth asserting: a buffered stream delivers everything at once and
 * the gym stops being watchable.
 */
async function runWatchedSession(agentId, exerciseId) {
  const { session } = await post('/api/sessions', { agentId, exerciseId });
  const response = await fetch(`${base}/api/sessions/${session.id}/events`, {
    headers: { accept: 'text/event-stream' },
  });
  if (!response.ok || !response.body) throw new Error(`event stream -> ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const arrivals = [];
  let buffer = '';
  let started = false;
  const t0 = Date.now();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const type = frame.match(/^event: (.+)$/m)?.[1];
      if (!type) continue;
      if (type === 'STREAM_READY') {
        if (!started) {
          started = true;
          await post(`/api/sessions/${session.id}/start`);
        }
        continue;
      }
      arrivals.push({ type, at: Date.now() - t0 });
      if (type === 'SESSION_COMPLETED' || type === 'SESSION_FAILED') {
        await reader.cancel().catch(() => {});
        const detail = await get(`/api/sessions/${session.id}`);
        return { session, arrivals, detail };
      }
    }
  }
  throw new Error('stream ended without completing the session');
}

async function main() {
  console.log(`smoke testing ${base}\n`);

  const { skills } = await get('/api/skills');
  check('six gyms are published, one of them open', skills.length === 6 && skills.filter((s) => s.status === 'active').length === 1);

  const { exercises } = await get('/api/exercises?skill=tool_usage');
  check('at least ten tool usage exercises', exercises.length >= 10, `got ${exercises.length}`);

  const { agents } = await get('/api/agents');
  const trainee = agents.find((a) => a.provider === 'heuristic');
  check('a trainee is available', Boolean(trainee));
  if (!trainee) return;

  // A fresh athlete, so the run is a real baseline rather than someone else's.
  const { agent } = await post('/api/agents', {
    name: `smoke-${Date.now().toString(36)}`,
    provider: 'heuristic',
  });

  const scores = [];
  let firstRun = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const run = await runWatchedSession(agent.id, 'tool-007');
    if (attempt === 1) firstRun = run;
    scores.push(run.detail.evaluation.score);
    console.log(
      `      attempt ${attempt}: ${run.detail.evaluation.score}/100 ` +
        `${run.detail.evaluation.success ? 'PASS' : 'FAIL'}, ` +
        `${run.detail.session.guidanceRules.length} coaching rule(s) carried in`,
    );
  }

  const types = firstRun.arrivals.map((a) => a.type);
  check('the session emits the full event sequence', ['SESSION_STARTED', 'TASK_RECEIVED', 'TOOL_CALL_STARTED', 'EVALUATION_COMPLETED', 'COACH_FEEDBACK', 'SESSION_COMPLETED'].every((t) => types.includes(t)));
  check('the environment injected a failure', types.includes('ENVIRONMENT_EVENT'));

  const spread = firstRun.arrivals.at(-1).at - firstRun.arrivals[0].at;
  check('events arrive incrementally rather than in one buffered flush', spread > 50, `spread ${spread}ms`);

  check('the coach produced actionable guidance', firstRun.detail.feedback.guidance.rules.length > 0);
  check('the judge checked the database, not the agent report', firstRun.detail.evaluation.deterministic.results.length > 0);
  check(`coaching improved the score (${scores.join(' -> ')})`, scores.at(-1) > scores[0]);

  const fitness = (await get(`/api/agents/${agent.id}/fitness`)).fitness;
  check('the fitness profile recorded every attempt', fitness.skills[0]?.attempts === 3);
  check('capability stays multi-dimensional', Object.keys(fitness.skills[0]?.dimensions ?? {}).length >= 5);
  check('untrained capabilities are reported as untrained', fitness.untrained.length === 5);

  // Bring your own agent.
  const external = (await post('/api/agents', { name: `smoke-ext-${Date.now().toString(36)}`, provider: 'external' })).agent;
  const extSession = (await post('/api/sessions', { agentId: external.id, exerciseId: 'tool-003' })).session;
  await post(`/api/sessions/${extSession.id}/start`);
  await post(`/api/sessions/${extSession.id}/tool-call`, { name: 'search_customer', input: { query: 'Maya Almeida' } });
  await post(`/api/sessions/${extSession.id}/tool-call`, { name: 'get_customer', input: { customer_id: 'C2051' } });
  await post(`/api/sessions/${extSession.id}/tool-call`, {
    name: 'update_customer',
    input: { customer_id: 'C2051', field: 'phone', value: '+49-555-0999' },
  });
  const verdict = await post(`/api/sessions/${extSession.id}/finish`, {
    finalResponse: 'Verified C2051 first, then set the phone to +49-555-0999.',
  });
  check('an externally driven session is judged identically', verdict.evaluation.success === true, `score ${verdict.evaluation.score}`);

  await securityChecks();

  console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

/**
 * The API is unauthenticated by design, so the controls that remain have to
 * actually hold: a page on another origin must not be able to drive the gym,
 * bodies must be bounded, and configuration must not leak back to a caller.
 */
async function securityChecks() {
  const crossSite = await fetch(`${base}/api/agents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    body: JSON.stringify({ name: 'csrf', provider: 'heuristic' }),
  });
  check('a cross-origin mutation is refused', crossSite.status === 403, `got ${crossSite.status}`);

  const secFetch = await fetch(`${base}/api/agents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
    body: JSON.stringify({ name: 'csrf2', provider: 'heuristic' }),
  });
  check('a cross-site fetch is refused', secFetch.status === 403, `got ${secFetch.status}`);

  const plainText = await fetch(`${base}/api/agents`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ name: 'simple-request', provider: 'heuristic' }),
  });
  check(
    'a non-JSON body is refused, so a simple cross-site request cannot slip through',
    plainText.status === 415,
    `got ${plainText.status}`,
  );

  const huge = await fetch(`${base}/api/agents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'big', systemPrompt: 'x'.repeat(200000) }),
  });
  check('an oversized body is refused', huge.status === 413, `got ${huge.status}`);

  const clamped = await post('/api/agents', {
    name: `smoke-clamp-${Date.now().toString(36)}`,
    provider: 'heuristic',
    maxSteps: 1e9,
    model: 'm'.repeat(400),
  });
  check('an absurd tool budget is clamped', clamped.agent.maxSteps <= 50, `got ${clamped.agent.maxSteps}`);
  check('an absurd model string is clamped', clamped.agent.model.length <= 120);

  const page = await fetch(`${base}/`);
  const csp = page.headers.get('content-security-policy') ?? '';
  check('security headers are set on page responses', csp.includes("frame-ancestors 'none'") && page.headers.get('x-content-type-options') === 'nosniff');
}

main().catch((error) => {
  console.error(`\nsmoke test could not run: ${error.message}`);
  console.error(`Is the server up at ${base}?`);
  process.exitCode = 1;
});
