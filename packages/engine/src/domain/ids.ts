/**
 * Identifier helpers. Deterministic ids are important: the engine must be able
 * to replay a session byte-for-byte, so nothing in the domain may reach for
 * Math.random() directly.
 */

export type AgentId = string;
export type SessionId = string;
export type ExerciseId = string;
export type SkillId = string;
export type EventId = string;

let counter = 0;

/** Monotonic, process-unique id. Prefixed so ids are readable in logs. */
export function newId(prefix: string): string {
  counter += 1;
  const stamp = Date.now().toString(36);
  const seq = counter.toString(36).padStart(4, '0');
  return `${prefix}_${stamp}${seq}`;
}

/**
 * Small, seedable PRNG (mulberry32). Every source of randomness inside the
 * sandbox flows through this so an exercise with a fixed seed always produces
 * the same world.
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return function rng() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash, used to derive a seed from a string. */
export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
