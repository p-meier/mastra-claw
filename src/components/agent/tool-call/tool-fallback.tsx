'use client';

import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { useAuiState } from '@assistant-ui/react';

import { humanizeToolName } from './humanize';
import { JsonBlock } from './json-block';
import { ToolCard } from './tool-card';
import { statusToVariant } from './tool-status';

/**
 * Generic tool-call card. Renders for every tool the agent invokes
 * unless a `tools.by_name` entry takes over.
 *
 * Surfaces:
 * - Humanized tool name (`mastra_workspace_write_file` →
 *   `Workspace · write file`).
 * - Live status icon + label, derived from the assistant-ui
 *   `MessagePartStatus` via `statusToVariant` so every tool renderer
 *   in the chat agrees on the visual vocabulary.
 * - Collapsible Args (raw JSON, monospaced).
 * - Collapsible Result if present.
 *
 * **Approval is NOT rendered here.** Mastra emits a separate
 * `data-tool-call-approval` part on the same assistant message when
 * a tool call is suspended; that part is rendered by
 * `ToolCallApprovalDataPart` (registered via
 * `MessagePrimitive.Parts components.data.by_name`). The approval
 * data part carries the `runId` + `toolCallId` we need to call
 * `chat.regenerate({ body: { resumeData, ... } })` against the chat
 * route's resume branch — none of which is available on a plain
 * `ToolCallMessagePartProps`. Keeping the two concerns split means
 * the fallback card stays a pure status surface and approvals get
 * their own first-class rendering slot.
 *
 * The component still surfaces `requires-action` visually (amber
 * "Needs approval" pill) so a tool that emits the AI SDK status
 * without a Mastra data part is at least readable, and the user can
 * see *why* the chat is paused.
 */
export const ToolFallback: ToolCallMessagePartComponent = ({
  toolName,
  toolCallId,
  args,
  result,
  isError,
  status,
}) => {
  // Mastra emits two separate parts on the same assistant message
  // when a tool call is suspended for approval:
  //
  //   1. the standard `tool-call` part (which lands here)
  //   2. a `data-tool-call-approval` data part (rendered by
  //      `ToolCallApprovalDataPart`) that carries `runId` +
  //      `toolCallId` and the approval buttons
  //
  // Without coordination both render and the user sees two
  // identical cards stacked. We deduplicate by checking the parent
  // message's parts for a matching approval data part — if there
  // is one, the dedicated approval card wins and we render
  // nothing here. The selector returns a stable boolean so this
  // doesn't trigger extra re-renders.
  const hasApprovalDataPart = useAuiState((s) => {
    const parts = s.message?.parts;
    if (!parts) return false;
    return parts.some(
      (p) =>
        p.type === 'data' &&
        p.name === 'tool-call-approval' &&
        (p.data as { toolCallId?: string } | undefined)?.toolCallId ===
          toolCallId,
    );
  });

  if (hasApprovalDataPart) return null;

  const variant = statusToVariant(status, isError ?? false);
  return (
    <ToolCard label={humanizeToolName(toolName)} variant={variant}>
      {args !== undefined && <JsonBlock label="Arguments" value={args} />}
      {result !== undefined && <JsonBlock label="Result" value={result} />}
    </ToolCard>
  );
};
