'use client';

import type { DataMessagePartComponent } from '@assistant-ui/react';

import { humanizeToolName } from './humanize';
import { JsonBlock } from './json-block';
import { ToolApprovalButtons } from './tool-approval-buttons';
import { ToolCard } from './tool-card';

/**
 * Data parts emitted by Mastra when a tool call requires approval or is
 * suspended waiting for human input. The shape is constructed in
 * `@mastra/ai-sdk` (`dist/index.js` ~line 11719-11744) when the agent
 * stream emits a `tool-call-approval` or `tool-call-suspended` chunk.
 *
 * AI SDK v6 wraps it as a `data-<name>` UI message part; assistant-ui
 * surfaces the part with `type: 'data'`, `name: '<name>'`, and `data:
 * { ... }`. We register two name-keyed renderers via
 * `MessagePrimitive.Parts components.data.by_name`.
 *
 * Both shapes carry the same `runId` + `toolCallId` we need to call
 * `chat.regenerate({ body: { resumeData, runId, toolCallId } })`. The
 * suspended variant additionally carries a `suspendPayload` which we
 * surface as a JSON block so the user can see *what* the workflow is
 * waiting for.
 */

type ToolApprovalData = {
  readonly state: 'data-tool-call-approval';
  readonly runId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args?: unknown;
  readonly resumeSchema?: unknown;
};

type ToolSuspendedData = {
  readonly state: 'data-tool-call-suspended';
  readonly runId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly suspendPayload?: unknown;
  readonly resumeSchema?: unknown;
};

export const ToolCallApprovalDataPart: DataMessagePartComponent<
  ToolApprovalData
> = ({ data }) => {
  return (
    <ToolCard
      label={humanizeToolName(data.toolName)}
      variant="requires-action"
      defaultOpen
    >
      {data.args !== undefined && (
        <JsonBlock label="Arguments" value={data.args} />
      )}
      <ToolApprovalButtons
        runId={data.runId}
        toolCallId={data.toolCallId}
      />
    </ToolCard>
  );
};

export const ToolCallSuspendedDataPart: DataMessagePartComponent<
  ToolSuspendedData
> = ({ data }) => {
  return (
    <ToolCard
      label={humanizeToolName(data.toolName)}
      variant="requires-action"
      statusLabel="Suspended"
      defaultOpen
    >
      {data.suspendPayload !== undefined && (
        <JsonBlock label="Suspend payload" value={data.suspendPayload} />
      )}
      <ToolApprovalButtons
        runId={data.runId}
        toolCallId={data.toolCallId}
      />
    </ToolCard>
  );
};
