'use client';

import Link from 'next/link';
import { DIMENSION_LABELS, DIFFICULTY_LABELS } from '@/lib/dto';

export function Panel({
  children,
  className = '',
  title,
  right,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  right?: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-xl border border-line bg-panel/80 backdrop-blur-sm shadow-[0_0_0_1px_rgba(0,0,0,0.4)] ${className}`}
    >
      {title !== undefined && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-dim">{title}</h2>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'agent' | 'coach' | 'env' | 'pass' | 'fail';
}) {
  const tones: Record<string, string> = {
    neutral: 'border-line text-ink-dim',
    agent: 'border-agent/40 text-agent bg-agent/5',
    coach: 'border-coach/40 text-coach bg-coach/5',
    env: 'border-env/40 text-env bg-env/5',
    pass: 'border-pass/40 text-pass bg-pass/5',
    fail: 'border-fail/40 text-fail bg-fail/5',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** Difficulty as pips, so the ladder reads at a glance. */
export function Difficulty({ level }: { level: number }) {
  return (
    <span className="inline-flex items-center gap-2" title={DIFFICULTY_LABELS[level] ?? `Level ${level}`}>
      <span className="flex gap-[3px]">
        {[1, 2, 3, 4, 5, 6].map((pip) => (
          <span
            key={pip}
            className={`h-3 w-[3px] rounded-full ${
              pip <= level
                ? level >= 5
                  ? 'bg-fail'
                  : level >= 4
                    ? 'bg-env'
                    : 'bg-agent'
                : 'bg-line-bright'
            }`}
          />
        ))}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
        {DIFFICULTY_LABELS[level] ?? `L${level}`}
      </span>
    </span>
  );
}

export function scoreTone(score: number): string {
  if (score >= 85) return 'text-pass';
  if (score >= 60) return 'text-agent';
  if (score >= 40) return 'text-env';
  return 'text-fail';
}

function scoreStroke(score: number): string {
  if (score >= 85) return 'var(--color-pass)';
  if (score >= 60) return 'var(--color-agent)';
  if (score >= 40) return 'var(--color-env)';
  return 'var(--color-fail)';
}

/** The headline number. The ring length is the score, nothing decorative. */
export function ScoreDial({
  score,
  size = 132,
  label,
  delta,
}: {
  score: number;
  size?: number;
  label?: string;
  delta?: number | null;
}) {
  const radius = size / 2 - 10;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * circumference;

  return (
    <div className="relative inline-flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth="6"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={scoreStroke(score)}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          style={{ transition: 'stroke-dasharray 700ms cubic-bezier(0.2,0.8,0.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-mono text-3xl font-semibold tabular-nums ${scoreTone(score)}`}>{score}</span>
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-ink-faint">
          {label ?? 'of 100'}
        </span>
        {delta !== undefined && delta !== null && (
          <span
            className={`mt-0.5 font-mono text-[10px] tabular-nums ${delta >= 0 ? 'text-pass' : 'text-fail'}`}
          >
            {delta >= 0 ? '+' : ''}
            {delta}
          </span>
        )}
      </div>
    </div>
  );
}

export function MetricBar({
  dimension,
  score,
  weight,
  trend,
}: {
  dimension: string;
  score: number;
  weight?: number;
  trend?: number;
}) {
  return (
    <div className="flex items-center gap-3 py-[5px]">
      <span className="w-32 shrink-0 truncate font-mono text-[11px] text-ink-dim">
        {DIMENSION_LABELS[dimension] ?? dimension}
      </span>
      <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-line">
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${Math.max(0, Math.min(100, score))}%`,
            background: scoreStroke(score),
            transition: 'width 600ms cubic-bezier(0.2,0.8,0.2,1)',
          }}
        />
      </span>
      <span className={`w-8 text-right font-mono text-[11px] tabular-nums ${scoreTone(score)}`}>{score}</span>
      {weight !== undefined ? (
        <span className="w-10 text-right font-mono text-[10px] text-ink-faint" title="weight in this workout">
          ×{weight}
        </span>
      ) : trend !== undefined ? (
        <span
          className={`w-10 text-right font-mono text-[10px] tabular-nums ${
            trend > 0 ? 'text-pass' : trend < 0 ? 'text-fail' : 'text-ink-faint'
          }`}
        >
          {trend > 0 ? '+' : ''}
          {trend || '—'}
        </span>
      ) : (
        <span className="w-10" />
      )}
    </div>
  );
}

/** A dimension the gym has never measured shows as a gap, never as a zero. */
export function UnmeasuredRow({ dimension }: { dimension: string }) {
  return (
    <div className="flex items-center gap-3 py-[5px] opacity-45">
      <span className="w-32 shrink-0 truncate font-mono text-[11px] text-ink-dim">
        {DIMENSION_LABELS[dimension] ?? dimension}
      </span>
      <span className="h-1.5 flex-1 rounded-full border border-dashed border-line-bright" />
      <span className="w-8 text-right font-mono text-[11px] text-ink-faint">--</span>
      <span className="w-10" />
    </div>
  );
}

export function Sparkline({ values, width = 132, height = 30 }: { values: number[]; width?: number; height?: number }) {
  if (values.length === 0) {
    return <span className="font-mono text-[11px] text-ink-faint">no sessions yet</span>;
  }
  if (values.length === 1) {
    return <span className={`font-mono text-sm tabular-nums ${scoreTone(values[0])}`}>{values[0]}</span>;
  }
  const step = width / (values.length - 1);
  const points = values.map((value, index) => `${index * step},${height - (value / 100) * height}`);
  const last = values.at(-1)!;

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={scoreStroke(last)}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {values.map((value, index) => (
        <circle
          key={index}
          cx={index * step}
          cy={height - (value / 100) * height}
          r={index === values.length - 1 ? 3 : 1.8}
          fill={scoreStroke(value)}
        />
      ))}
    </svg>
  );
}

export function Button({
  children,
  onClick,
  href,
  tone = 'primary',
  disabled,
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  tone?: 'primary' | 'ghost' | 'coach';
  disabled?: boolean;
  className?: string;
}) {
  const tones: Record<string, string> = {
    primary:
      'border-agent/50 bg-agent/10 text-agent hover:bg-agent/20 hover:border-agent disabled:opacity-40',
    coach: 'border-coach/50 bg-coach/10 text-coach hover:bg-coach/20 hover:border-coach',
    ghost: 'border-line bg-transparent text-ink-dim hover:text-ink hover:border-line-bright',
  };
  const classes = `inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors ${tones[tone]} ${className}`;

  if (href && !disabled) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${classes} disabled:cursor-not-allowed`}>
      {children}
    </button>
  );
}

export function Loading({ label = 'loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-6 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
      <span className="h-1.5 w-1.5 animate-ping rounded-full bg-agent" />
      {label}
    </div>
  );
}
