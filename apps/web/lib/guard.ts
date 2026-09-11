/**
 * Request guards for the gym API.
 *
 * Trust model: the gym has no accounts and no authentication. It is a local
 * tool, and every caller that can reach the port is treated as the operator.
 * That is a deliberate choice for a single-user MVP, and it is why the server
 * should be bound to localhost rather than exposed.
 *
 * Two things still have to hold under that model:
 *
 *   1. A web page the operator happens to visit must not be able to drive
 *      their gym. Without authentication there is no session cookie to steal,
 *      but a cross-site POST can still start sessions and spend whatever model
 *      credits the server is configured with. Mutating routes therefore
 *      require a same-origin request.
 *   2. Errors must not carry configuration or upstream detail back to the
 *      caller. Detail goes to the server log; the client gets a stable message.
 */

/** Upper bound on a request body, in bytes. */
export const MAX_BODY_BYTES = 64 * 1024;

function requestOrigin(request: Request): string | null {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = forwardedHost ?? request.headers.get('host');
  if (!host) return null;
  const proto = request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '');
  return `${proto}://${host}`;
}

/**
 * Reject a cross-site mutation.
 *
 * A browser always sends at least one of Origin or Sec-Fetch-Site on a
 * cross-site request, so checking both blocks the browser-driven case without
 * breaking curl, the smoke test, or any other non-browser client — none of
 * which an attacker can aim at someone else's machine.
 */
export function crossSiteRejection(request: Request): Response | null {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    return forbidden('This endpoint only accepts same-origin requests.');
  }

  const origin = request.headers.get('origin');
  if (origin && origin !== 'null') {
    const expected = requestOrigin(request);
    if (expected === null || origin !== expected) {
      return forbidden('This endpoint only accepts same-origin requests.');
    }
  }
  return null;
}

/**
 * Read a JSON body with a size cap and a content-type check.
 *
 * Requiring a JSON content type is not cosmetic: without it a cross-site form
 * or a text/plain fetch is a "simple request" that never triggers a CORS
 * preflight, which is exactly the shape a CSRF attempt takes.
 */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | Response> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) {
    return tooLarge();
  }

  const raw = await request.text().catch(() => '');
  if (raw.length === 0) return {};

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return new Response(
      JSON.stringify({ error: 'Request body must be sent as application/json.' }),
      { status: 415, headers: { 'content-type': 'application/json' } },
    );
  }
  if (raw.length > MAX_BODY_BYTES) return tooLarge();

  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return new Response(JSON.stringify({ error: 'Request body is not valid JSON.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
}

/** One call that applies both guards to a mutating route. */
export async function guardMutation(
  request: Request,
): Promise<{ body: Record<string, unknown> } | Response> {
  const rejected = crossSiteRejection(request);
  if (rejected) return rejected;
  const body = await readJsonBody(request);
  return body instanceof Response ? body : { body };
}

/**
 * Log the real error, return a safe one.
 *
 * Engine and provider errors can name the configured endpoint or quote an
 * upstream response, and this API is unauthenticated, so the detail stays on
 * the server.
 */
export function safeError(context: string, error: unknown, status = 500): Response {
  console.error(`[gym] ${context}:`, error);
  return new Response(
    JSON.stringify({ error: `${context} failed. See the server log for details.` }),
    { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  );
}

/** Strip anything credential-shaped from text that is about to be served. */
export function redact(text: string | undefined): string | undefined {
  if (!text) return text;
  return text
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|xoxb-[A-Za-z0-9-]+|ghp_[A-Za-z0-9]+)\b/g, '[redacted]')
    .replace(/\/\/[^/\s:@]+:[^/\s@]+@/g, '//[redacted]@')
    .slice(0, 500);
}

/** Bound a caller-supplied page size so it is always a sane integer. */
export function boundedLimit(raw: string | null, fallback: number, max: number): number {
  const parsed = Math.floor(Number(raw));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function forbidden(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  });
}

function tooLarge(): Response {
  return new Response(
    JSON.stringify({ error: `Request body must be ${MAX_BODY_BYTES} bytes or smaller.` }),
    { status: 413, headers: { 'content-type': 'application/json' } },
  );
}
