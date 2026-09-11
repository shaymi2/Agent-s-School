import { toWireSkills, json } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

/** GET /api/skills — the gym floor: which capabilities exist and which are open. */
export function GET(): Response {
  return json({ skills: toWireSkills() });
}
