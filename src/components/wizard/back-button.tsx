'use client';

/**
 * Wizard Back button. Flat outlined silhouette by default, the chevron
 * slides slightly to the left on hover so it's recognizable as a back
 * affordance. Used by both wizards (admin setup, personal onboarding).
 *
 * Restyled to use App theme tokens (`border`, `text-muted-foreground`)
 * so the button inherits the surrounding theme — light by default in
 * the admin wizard, dark inside the personal-onboarding bootstrap stage
 * where the parent forces `dark` on its container.
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
      className="group inline-flex h-10 items-center gap-1.5 rounded-lg border bg-transparent px-4 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
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
