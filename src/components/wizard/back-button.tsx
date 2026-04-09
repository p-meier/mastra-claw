'use client';

/**
 * Wizard Back button. Flat outlined silhouette by default, the chevron
 * slides slightly to the left on hover so it's recognizable as a back
 * affordance. Used by both wizards (admin setup, personal onboarding).
 *
 * Render this conditionally — pass `canGoBack={false}` and the button
 * is omitted entirely so step 1 of any wizard has nothing where the
 * back affordance would otherwise sit.
 */
export function BackButton({
  onClick,
  disabled,
  canGoBack,
  label = 'Back',
}: {
  onClick: () => void;
  disabled?: boolean;
  canGoBack: boolean;
  label?: string;
}) {
  if (!canGoBack) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group inline-flex h-10 items-center gap-1.5 rounded-lg border border-white/[0.14] bg-transparent px-4 text-sm text-white/70 transition-colors hover:border-white/[0.30] hover:text-white disabled:pointer-events-none disabled:opacity-30"
    >
      <span
        aria-hidden
        className="inline-block transition-transform duration-200 group-hover:-translate-x-0.5"
      >
        ←
      </span>
      <span>{label}</span>
    </button>
  );
}
