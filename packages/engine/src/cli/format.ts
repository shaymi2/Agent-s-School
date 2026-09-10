/** Terminal formatting helpers shared by the CLI entry points. */

const ESC = String.fromCharCode(27);
const USE_COLOR = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;

function wrap(code: string, text: string): string {
  return USE_COLOR ? `${ESC}[${code}m${text}${ESC}[0m` : text;
}

export const c = {
  bold: (t: string) => wrap('1', t),
  dim: (t: string) => wrap('2', t),
  green: (t: string) => wrap('32', t),
  red: (t: string) => wrap('31', t),
  yellow: (t: string) => wrap('33', t),
  cyan: (t: string) => wrap('36', t),
  magenta: (t: string) => wrap('35', t),
};

export function bar(value: number, width = 20): string {
  const clamped = Math.max(0, Math.min(100, value));
  const filled = Math.round((clamped / 100) * width);
  return `${'#'.repeat(filled)}${'.'.repeat(width - filled)}`;
}

export function rule(title = ''): string {
  if (!title) return c.dim('-'.repeat(66));
  return c.dim(`-- ${title} ${'-'.repeat(Math.max(0, 62 - title.length))}`);
}

export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = 'true';
    }
  }
  return out;
}
