'use client';

import type { ToolCallMessagePartStatus } from '@assistant-ui/react';
import {
  CheckIcon,
  CircleSlashIcon,
  Loader2Icon,
  TriangleAlertIcon,
  WrenchIcon,
} from 'lucide-react';
import type { ComponentType } from 'react';

/**
 * The visual identity of a tool call's lifecycle state.
 *
 * Centralised so the generic fallback card, the workspace card, and any
 * future per-tool renderers all show the same icon, label, and colour for
 * the same Mastra/AI SDK part status. The four states map onto the
 * `MessagePartStatus` shapes that `@assistant-ui/react` exposes for
 * tool-call parts:
 *
 * - `running`            — the tool call is in flight
 * - `requires-action`    — Mastra has suspended this call (e.g. workspace
 *                          write that needs approval) — handled separately
 *                          by the data-part renderers, but we still expose
 *                          a fallback variant for tools that surface the
 *                          status without an explicit data part
 * - `complete`           — tool call resolved successfully
 * - `incomplete` / error — tool call failed, was cancelled, or returned an
 *                          error response
 */
export type ToolStatusVariant =
  | 'running'
  | 'requires-action'
  | 'complete'
  | 'failed';

export type ToolStatusVisual = {
  Icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  iconClass: string;
  label: string;
};

const VISUALS: Record<ToolStatusVariant, ToolStatusVisual> = {
  running: {
    Icon: Loader2Icon,
    iconClass: 'animate-spin text-muted-foreground',
    label: 'Running',
  },
  'requires-action': {
    Icon: WrenchIcon,
    iconClass: 'text-amber-600',
    label: 'Needs approval',
  },
  complete: {
    Icon: CheckIcon,
    iconClass: 'text-emerald-600',
    label: 'Done',
  },
  failed: {
    Icon: TriangleAlertIcon,
    iconClass: 'text-destructive',
    label: 'Failed',
  },
};

const DECLINED_VISUAL: ToolStatusVisual = {
  Icon: CircleSlashIcon,
  iconClass: 'text-muted-foreground',
  label: 'Declined',
};

export function getToolStatusVisual(
  variant: ToolStatusVariant,
): ToolStatusVisual {
  return VISUALS[variant];
}

export function getDeclinedVisual(): ToolStatusVisual {
  return DECLINED_VISUAL;
}

/**
 * Map an assistant-ui `MessagePartStatus` (the prop the runtime hands to
 * a tool-call component) onto our visual variant. `isError` short-circuits
 * to `failed` since the AI SDK can return `state: 'output-available'`
 * with an error result.
 */
export function statusToVariant(
  status: ToolCallMessagePartStatus,
  isError: boolean,
): ToolStatusVariant {
  if (isError) return 'failed';
  if (status.type === 'requires-action') return 'requires-action';
  if (status.type === 'incomplete') return 'failed';
  if (status.type === 'complete') return 'complete';
  return 'running';
}
