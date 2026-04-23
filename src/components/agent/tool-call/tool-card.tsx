'use client';

import { ChevronDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import {
  getToolStatusVisual,
  type ToolStatusVariant,
} from './tool-status';

/**
 * Collapsible card shell shared by every tool-call renderer in the
 * chat — generic fallback, workspace-specialized, and the data-part
 * approval / suspend renderers.
 *
 * Built on a native `<details>` element to keep dependencies thin and
 * avoid wrestling with controlled disclosure state. The variant prop
 * picks the icon, label, and colour from `tool-status.tsx` so every
 * card agrees on what `running`, `complete`, `requires-action`, and
 * `failed` look like.
 *
 * Cards default to *open* when they need approval — so the user
 * doesn't have to click twice (once to expand, once to approve) — and
 * collapsed otherwise to keep the chat tidy.
 */
export type ToolCardProps = {
  label: string;
  variant: ToolStatusVariant;
  /** Override the variant's default label, e.g. "Declined". */
  statusLabel?: string;
  /** Default open state. Approval cards open by default. */
  defaultOpen?: boolean;
  children: ReactNode;
};

export function ToolCard({
  label,
  variant,
  statusLabel,
  defaultOpen,
  children,
}: ToolCardProps) {
  const visual = getToolStatusVisual(variant);
  const open = defaultOpen ?? variant === 'requires-action';

  return (
    <details
      open={open || undefined}
      className={cn(
        'group max-w-[80%] rounded-xl border text-xs',
        variant === 'requires-action'
          ? 'border-amber-300/60 bg-amber-50/40 dark:border-amber-500/30 dark:bg-amber-950/20'
          : 'bg-muted/40',
      )}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2">
        <visual.Icon
          className={cn('size-3.5 shrink-0', visual.iconClass)}
          aria-hidden
        />
        <span className="text-foreground font-medium">{label}</span>
        <span className="text-muted-foreground ml-auto inline-flex items-center gap-1">
          {statusLabel ?? visual.label}
          <ChevronDownIcon
            className="size-3.5 transition-transform group-open:rotate-180"
            aria-hidden
          />
        </span>
      </summary>
      <div className="space-y-2 border-t px-3 py-2">{children}</div>
    </details>
  );
}
