'use client';

/**
 * The athletes on the floor.
 *
 * Every pose here corresponds to something the engine actually reported. The
 * sprite has no idle timeline of its own: it bobs when nothing is happening,
 * and everything else is a reaction to an event that really arrived.
 *
 * One rule is borrowed from Bot Crossing, which does this in 3D: locomotion
 * beats status, and the walk is chosen from the distance the body actually
 * covered rather than the velocity it meant to have. An agent driven off
 * intent alone walks on the spot against a wall. Here the stage reports when
 * a transform transition is genuinely in flight, and that is what selects the
 * walking pose, so the legs only ever cycle while the sprite is really moving.
 */

export type AgentPose =
  | 'idle'
  | 'walking'
  | 'working'
  | 'stagger'
  | 'reporting'
  | 'cheer'
  | 'slump';

export type CoachMood = 'watching' | 'wincing' | 'approving' | 'disappointed';

const POSE_TINT: Record<AgentPose, string> = {
  idle: 'var(--color-line-bright)',
  walking: 'var(--color-agent)',
  working: 'var(--color-agent)',
  stagger: 'var(--color-fail)',
  reporting: 'var(--color-agent)',
  cheer: 'var(--color-pass)',
  slump: 'var(--color-fail)',
};

export function AgentSprite({
  pose,
  facing,
  size = 74,
}: {
  pose: AgentPose;
  facing: 1 | -1;
  size?: number;
}) {
  const tint = POSE_TINT[pose];
  return (
    <div
      className="agent-sprite"
      data-pose={pose}
      style={{ width: size, height: size, ['--tint' as string]: tint }}
    >
      <div className="agent-sprite__flip" style={{ transform: `scaleX(${facing})` }}>
        <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden>
          {/* contact shadow, so the body reads as standing on the floor */}
          <ellipse className="sp-shadow" cx="24" cy="45" rx="11" ry="2.6" />

          <g className="sp-body">
            {/* antenna */}
            <line className="sp-antenna" x1="24" y1="11" x2="24" y2="5" />
            <circle className="sp-lamp" cx="24" cy="4" r="2.2" />

            {/* legs: the only parts that cycle, and only while really moving */}
            <g className="sp-leg sp-leg--back">
              <rect x="19.5" y="32" width="4" height="11" rx="2" />
            </g>
            <g className="sp-leg sp-leg--front">
              <rect x="24.5" y="32" width="4" height="11" rx="2" />
            </g>

            {/* torso */}
            <rect className="sp-torso" x="15" y="19" width="18" height="15" rx="5" />
            <rect className="sp-chest" x="20" y="23" width="8" height="5" rx="1.5" />

            {/* arms */}
            <g className="sp-arm sp-arm--back">
              <rect x="12" y="20" width="3.6" height="11" rx="1.8" />
            </g>
            <g className="sp-arm sp-arm--front">
              <rect x="32.4" y="20" width="3.6" height="11" rx="1.8" />
            </g>

            {/* head and visor */}
            <g className="sp-head">
              <rect x="14" y="9" width="20" height="12" rx="5" />
              <rect className="sp-visor" x="17" y="12" width="14" height="6" rx="3" />
              <circle className="sp-eye sp-eye--l" cx="21" cy="15" r="1.5" />
              <circle className="sp-eye sp-eye--r" cx="27" cy="15" r="1.5" />
            </g>
          </g>
        </svg>
      </div>
    </div>
  );
}

/**
 * The coach.
 *
 * Reacts only to the judge and to tool failures, which is the whole of what a
 * coach in this product actually sees.
 */
export function CoachSprite({ mood, size = 54 }: { mood: CoachMood; size?: number }) {
  return (
    <div className="coach-sprite" data-mood={mood} style={{ width: size, height: size }}>
      <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden>
        <ellipse className="sp-shadow" cx="24" cy="45" rx="10" ry="2.4" />
        <g className="co-body">
          {/* whistle on a cord */}
          <path className="co-cord" d="M19 22 Q24 30 29 24" />
          <circle className="co-whistle" cx="29" cy="25" r="2.4" />

          <g className="co-arm">
            <rect x="32" y="19" width="3.4" height="10" rx="1.7" />
          </g>

          <rect className="co-torso" x="15" y="18" width="18" height="16" rx="4" />
          <rect className="co-legs" x="18" y="33" width="12" height="10" rx="2" />

          <g className="co-head">
            <circle cx="24" cy="12" r="7" />
            {/* cap */}
            <path className="co-cap" d="M16.5 10 A7.5 7.5 0 0 1 31.5 10 Z" />
            <rect className="co-peak" x="29" y="9" width="7" height="2.2" rx="1.1" />
            <circle className="co-eye co-eye--l" cx="21.5" cy="12.5" r="1.2" />
            <circle className="co-eye co-eye--r" cx="26.5" cy="12.5" r="1.2" />
          </g>
        </g>
      </svg>
    </div>
  );
}
