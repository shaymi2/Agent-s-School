/**
 * A small natural-language reader for exercise briefs.
 *
 * The heuristic trainee has no language model, so it needs an honest way to
 * work out what it has been asked to do. This parser only reads the brief; it
 * never sees the dataset, the assertions or the expected answer.
 */

const FIELD_KEYWORDS: Array<{ pattern: RegExp; field: string }> = [
  { pattern: /\bemail(?:\s+address)?\b/i, field: 'email' },
  { pattern: /\bphone(?:\s+number)?\b/i, field: 'phone' },
  { pattern: /\bstatus\b/i, field: 'status' },
  { pattern: /\bplan\b/i, field: 'plan' },
  { pattern: /\bregion\b/i, field: 'region' },
  { pattern: /\baccount\s+owner\b/i, field: 'accountOwner' },
  { pattern: /\bnotes?\b/i, field: 'notes' },
  { pattern: /\bcustomer\s+id\b/i, field: 'id' },
];

const WRITE_VERBS = /\b(update|change|set|modify|correct|rename|apply the change)\b/i;

/**
 * Words that start a sentence and get swept up by the capitalised-name regex.
 * "Find Lena Fischer" is not a person.
 */
const LEADING_NOISE = new Set([
  'find', 'update', 'set', 'change', 'report', 'confirm', 'please', 'apply', 'use',
  'modify', 'correct', 'retrieve', 'get', 'search', 'look', 'check', 'the', 'a', 'an',
  'two', 'if', 'and', 'but', 'so', 'a', 'message',
]);

function cleanName(candidate: string | null): string | null {
  if (!candidate) return null;
  const words = candidate.split(/\s+/);
  while (words.length > 2 && LEADING_NOISE.has(words[0].toLowerCase())) words.shift();
  if (words.length > 1 && LEADING_NOISE.has(words[0].toLowerCase())) words.shift();
  return words.length >= 2 ? words.join(' ') : null;
}
const STATUS_WORDS = ['active', 'inactive', 'suspended'];

export interface ParsedTask {
  intent: 'read' | 'write';
  subjectName: string | null;
  customerId: string | null;
  /** Fields the brief asks about, for a read. */
  requestedFields: string[];
  /** For a write: which field and what value. */
  targetField: string | null;
  targetValue: string | null;
  /** A status word used to disambiguate between records, not as a value. */
  statusQualifier: string | null;
  /** The brief asks the agent to judge whether the action is appropriate. */
  requiresJudgement: boolean;
}

export function parseTask(task: string): ParsedTask {
  const idMatch = task.match(/\bC\d{3,6}\b/);
  const customerId = idMatch ? idMatch[0] : null;

  const names = [...task.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g)].map((m) => m[0]);
  const possessive = task.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)'s\b/);
  const subjectName = cleanName(possessive ? possessive[1] : (names[0] ?? null));

  const isWrite = WRITE_VERBS.test(task);

  const requestedFields: string[] = [];
  for (const { pattern, field } of FIELD_KEYWORDS) {
    if (pattern.test(task)) requestedFields.push(field);
  }
  if (/\bfull record\b|\bcomplete record\b|\bwhole record\b/i.test(task)) {
    requestedFields.push('email', 'phone', 'status', 'plan', 'region', 'accountOwner');
  }

  let targetField: string | null = null;
  let targetValue: string | null = null;

  if (isWrite) {
    targetField = requestedFields.find((f) => f !== 'id') ?? null;
    targetValue = extractValue(task, targetField);
  }

  let statusQualifier: string | null = null;
  if (targetField !== 'status') {
    const qualifier = task.match(
      new RegExp(`\\b(${STATUS_WORDS.join('|')})\\b(?=[^.]*\\b(account|record|customer|one)\\b)`, 'i'),
    );
    if (qualifier) statusQualifier = qualifier[1].toLowerCase();
  }

  const requiresJudgement = /\bonly if\b|\bif it is safe\b|\bsafe to\b|\bapprov|\bexplain your decision\b/i.test(task);

  return {
    intent: isWrite ? 'write' : 'read',
    subjectName,
    customerId,
    requestedFields: [...new Set(requestedFields)],
    targetField,
    targetValue,
    statusQualifier,
    requiresJudgement,
  };
}

function extractValue(task: string, field: string | null): string | null {
  if (!field) return null;
  if (field === 'email') {
    const m = task.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    return m ? m[0].replace(/[.,]$/, '') : null;
  }
  if (field === 'phone') {
    const m = task.match(/\+?\d[\d\-\s().]{5,}\d/);
    return m ? m[0].trim() : null;
  }
  if (field === 'accountOwner') {
    const m = task.match(/\bto\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/);
    return m ? m[1] : null;
  }
  const quoted = task.match(/\bto\s+["']([^"']+)["']/);
  if (quoted) return quoted[1];
  const bare = task.match(/\bto\s+([a-z][a-z_-]*)/i);
  return bare ? bare[1].toLowerCase() : null;
}

/** Fields a search summary carries. Anything else needs the full record. */
export const SUMMARY_FIELDS = ['id', 'name', 'email', 'status'];
