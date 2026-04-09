import { cn } from '@/lib/utils';

export type MascotAccessory =
  | 'none'
  | 'hat'
  | 'briefcase'
  | 'phone'
  | 'heart'
  | 'sparkles';

/**
 * The MastraClaw mascot — a small amber robot/claw character used in
 * both wizards (Admin Setup and Personal Onboarding). Pure SVG, no
 * external assets, ~4kb. All animation is SMIL so it works inside a
 * Server Component without any Tailwind keyframe config.
 *
 * Variants:
 *   - 'idle'      gentle floating + blinking + antenna wiggle
 *   - 'thinking'  same motion + a brighter amber halo (used during async)
 *
 * Accessories: optional playful prop the mascot holds/wears, e.g. a
 * tiny hat for the greeting step or a briefcase / phone for the
 * "how should I write?" step.
 */
export function Mascot({
  variant = 'idle',
  className,
  label,
  accessory = 'none',
}: {
  variant?: 'idle' | 'thinking';
  className?: string;
  label?: string | null;
  accessory?: MascotAccessory;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      {label ? (
        <div className="text-2xl font-medium tracking-tight text-foreground">
          {label}
        </div>
      ) : null}
      <div
        className="relative size-36"
        style={{
          filter:
            variant === 'thinking'
              ? 'drop-shadow(0 0 24px rgba(251, 191, 36, 0.6)) drop-shadow(0 0 10px rgba(245, 158, 11, 0.35))'
              : 'drop-shadow(0 0 28px rgba(245, 158, 11, 0.45)) drop-shadow(0 0 12px rgba(180, 83, 9, 0.25))',
        }}
      >
        <svg viewBox="0 0 200 200" overflow="visible" className="size-full">
          {/* CSS @keyframes for the accessory fade-in. We use CSS rather
              than SMIL because SMIL <animate> is unreliable when React
              mounts an element dynamically (it often fires once on
              initial document load and never again). CSS animations
              restart on every fresh DOM node — combined with the
              key={accessory} prop on <Accessory/>, that gives us a
              clean fade-in on every selection change. */}
          <style
            dangerouslySetInnerHTML={{
              __html: `
                @keyframes mc-acc-fade {
                  from { opacity: 0; }
                  to   { opacity: 1; }
                }
                .mc-acc { animation: mc-acc-fade 0.55s ease-out both; }
              `,
            }}
          />
          {/* Everything inside this group floats up and down */}
          <g>
            <animateTransform
              attributeName="transform"
              attributeType="XML"
              type="translate"
              values="0 0; 0 -4; 0 0"
              dur="3s"
              repeatCount="indefinite"
              calcMode="spline"
              keySplines="0.4 0 0.6 1; 0.4 0 0.6 1"
              keyTimes="0; 0.5; 1"
            />

            {/* Body */}
            <ellipse cx="100" cy="115" rx="62" ry="60" fill="#b45309" />
            <ellipse cx="100" cy="100" rx="60" ry="58" fill="#f59e0b" />

            {/* Antennae — wiggle around their base */}
            <g style={{ transformOrigin: '70px 55px', transformBox: 'fill-box' }}>
              <line
                x1="70"
                y1="55"
                x2="62"
                y2="32"
                stroke="#b45309"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <circle cx="62" cy="32" r="5" fill="#fde68a">
                <animate
                  attributeName="opacity"
                  values="0.6;1;0.6"
                  dur="2.5s"
                  repeatCount="indefinite"
                />
              </circle>
              <animateTransform
                attributeName="transform"
                attributeType="XML"
                type="rotate"
                values="-6 70 55; 6 70 55; -6 70 55"
                dur="2.4s"
                repeatCount="indefinite"
                calcMode="spline"
                keySplines="0.4 0 0.6 1; 0.4 0 0.6 1"
                keyTimes="0; 0.5; 1"
              />
            </g>

            <g>
              <line
                x1="130"
                y1="55"
                x2="138"
                y2="32"
                stroke="#b45309"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <circle cx="138" cy="32" r="5" fill="#fde68a">
                <animate
                  attributeName="opacity"
                  values="1;0.6;1"
                  dur="2.5s"
                  repeatCount="indefinite"
                />
              </circle>
              <animateTransform
                attributeName="transform"
                attributeType="XML"
                type="rotate"
                values="6 130 55; -6 130 55; 6 130 55"
                dur="2.4s"
                repeatCount="indefinite"
                calcMode="spline"
                keySplines="0.4 0 0.6 1; 0.4 0 0.6 1"
                keyTimes="0; 0.5; 1"
              />
            </g>

            {/* Eyes */}
            <circle cx="80" cy="100" r="11" fill="white" />
            <circle cx="120" cy="100" r="11" fill="white" />
            {/* Pupils — blink by squashing scaleY periodically */}
            <g>
              <ellipse cx="82" cy="102" rx="5" ry="5" fill="#0a0a0a">
                <animate
                  attributeName="ry"
                  values="5;5;5;0.5;5"
                  keyTimes="0;0.85;0.92;0.95;1"
                  dur="4.2s"
                  repeatCount="indefinite"
                />
              </ellipse>
              <ellipse cx="122" cy="102" rx="5" ry="5" fill="#0a0a0a">
                <animate
                  attributeName="ry"
                  values="5;5;5;0.5;5"
                  keyTimes="0;0.85;0.92;0.95;1"
                  dur="4.2s"
                  repeatCount="indefinite"
                />
              </ellipse>
              <circle cx="84" cy="100" r="1.5" fill="white" />
              <circle cx="124" cy="100" r="1.5" fill="white" />
            </g>

            {/* Mouth — small smile */}
            <path
              d="M 88 130 Q 100 138 112 130"
              stroke="white"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
            />

            {/* Side arms / claws */}
            <ellipse cx="40" cy="120" rx="11" ry="14" fill="#b45309" />
            <ellipse cx="160" cy="120" rx="11" ry="14" fill="#b45309" />

            {/* Feet */}
            <ellipse cx="78" cy="172" rx="14" ry="6" fill="#78350f" />
            <ellipse cx="122" cy="172" rx="14" ry="6" fill="#78350f" />

            {/* Accessory — keyed so React remounts the SMIL animations
                whenever the kind changes (otherwise the new accessory
                appears statically without the drop-in flourish). */}
            <Accessory key={accessory} kind={accessory} />
          </g>
        </svg>
      </div>
    </div>
  );
}

/**
 * Accessory props the mascot can show. Each one is wrapped in a `<g>`
 * with the `mc-acc` CSS class, which fades in via the @keyframes
 * defined inside the SVG. Combined with the `key={accessory}` prop on
 * the call site, this guarantees a fresh fade-in on every change.
 *
 * All shapes are sized noticeably larger than the original tiny
 * versions so the props read clearly at the wizard's mascot size.
 */
function Accessory({ kind }: { kind: MascotAccessory }) {
  if (kind === 'none') return null;

  if (kind === 'hat') {
    // Top hat sitting between the antennae.
    return (
      <g className="mc-acc">
        {/* brim */}
        <ellipse cx="100" cy="52" rx="34" ry="5" fill="#1f2937" />
        {/* crown */}
        <rect x="79" y="20" width="42" height="32" rx="2" fill="#111827" />
        {/* band */}
        <rect x="79" y="42" width="42" height="6" fill="#dc2626" />
      </g>
    );
  }

  if (kind === 'briefcase') {
    // Briefcase held in the right claw.
    return (
      <g className="mc-acc">
        {/* handle */}
        <path
          d="M 148 116 Q 160 106 172 116"
          stroke="#451a03"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        {/* body */}
        <rect x="142" y="116" width="36" height="28" rx="3" fill="#ea580c" />
        <rect
          x="142"
          y="116"
          width="36"
          height="28"
          rx="3"
          fill="none"
          stroke="#9a3412"
          strokeWidth="2"
        />
        {/* divider line */}
        <line
          x1="142"
          y1="124"
          x2="178"
          y2="124"
          stroke="#9a3412"
          strokeWidth="1.5"
        />
        {/* clasp */}
        <rect x="156" y="126" width="8" height="6" rx="1" fill="#fde68a" />
      </g>
    );
  }

  if (kind === 'phone') {
    // Smartphone held in the right claw.
    return (
      <g className="mc-acc">
        <rect
          x="148"
          y="110"
          width="22"
          height="36"
          rx="4"
          fill="#111827"
          stroke="#f59e0b"
          strokeWidth="2"
        />
        <rect x="152" y="116" width="14" height="22" rx="1.5" fill="#fef3c7" />
        <circle cx="159" cy="142" r="1.6" fill="#9ca3af" />
      </g>
    );
  }

  if (kind === 'heart') {
    // Heart held in the right claw — for the "like texting a friend"
    // tone. Filled with rose so it reads instantly as affection.
    return (
      <g className="mc-acc">
        <path
          d="M 160 148
             C 160 148, 140 132, 140 120
             C 140 113, 145 108, 151 108
             C 155 108, 158 110, 160 113
             C 162 110, 165 108, 169 108
             C 175 108, 180 113, 180 120
             C 180 132, 160 148, 160 148 Z"
          fill="#e11d48"
          stroke="#9f1239"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* tiny highlight */}
        <ellipse
          cx="151"
          cy="116"
          rx="3"
          ry="2"
          fill="#fecdd3"
          opacity="0.85"
        />
      </g>
    );
  }

  if (kind === 'sparkles') {
    // Drifting sparkles around the mascot — fades in, then twinkles.
    return (
      <g className="mc-acc">
        <Sparkle cx={32} cy={56} delay="0s" />
        <Sparkle cx={175} cy={78} delay="0.3s" />
        <Sparkle cx={162} cy={36} delay="0.6s" />
        <Sparkle cx={22} cy={92} delay="0.9s" />
      </g>
    );
  }

  return null;
}

function Sparkle({
  cx,
  cy,
  delay,
}: {
  cx: number;
  cy: number;
  delay: string;
}) {
  return (
    <g>
      <path
        d={`M ${cx} ${cy - 9} L ${cx + 2} ${cy - 2} L ${cx + 9} ${cy} L ${cx + 2} ${cy + 2} L ${cx} ${cy + 9} L ${cx - 2} ${cy + 2} L ${cx - 9} ${cy} L ${cx - 2} ${cy - 2} Z`}
        fill="#fde68a"
      />
      <animate
        attributeName="opacity"
        values="0.2;1;0.2"
        dur="1.6s"
        begin={delay}
        repeatCount="indefinite"
      />
    </g>
  );
}
