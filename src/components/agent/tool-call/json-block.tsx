'use client';

/**
 * Pretty-printed JSON / string body used everywhere a tool card needs to
 * surface arguments, results, or a Mastra suspend payload. Strings pass
 * through verbatim so a Markdown error message or stack trace stays
 * legible; everything else is `JSON.stringify`d with two-space indent.
 *
 * Capped at `max-h-64` so a multi-megabyte tool result can't blow out
 * the chat scroll position — the user can still scroll the inner block
 * to inspect the full payload.
 */
export type JsonBlockProps = {
  label: string;
  value: unknown;
};

export function JsonBlock({ label, value }: JsonBlockProps) {
  let body: string;
  try {
    body = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    body = String(value);
  }
  return (
    <div>
      <div className="text-muted-foreground mb-1 text-[10px] font-medium tracking-wide uppercase">
        {label}
      </div>
      <pre className="bg-background/60 max-h-64 overflow-auto rounded-md border p-2 text-[11px] whitespace-pre-wrap">
        {body}
      </pre>
    </div>
  );
}
