/**
 * Three-dot bouncing loading indicator. Used as an overlay on the chat
 * input while the model is responding so the user has a clear visual
 * cue that the assistant is thinking — instead of just a greyed-out
 * input field.
 *
 * Pure CSS animation, no client component needed.
 */
export function ThinkingDots({ className }: { className?: string }) {
  return (
    <div
      className={`flex items-center gap-1.5 ${className ?? ''}`}
      role="status"
      aria-label="Assistant is thinking"
    >
      <span className="block size-2 animate-bounce rounded-full bg-amber-400 [animation-delay:-0.3s]" />
      <span className="block size-2 animate-bounce rounded-full bg-amber-400 [animation-delay:-0.15s]" />
      <span className="block size-2 animate-bounce rounded-full bg-amber-400" />
    </div>
  );
}
