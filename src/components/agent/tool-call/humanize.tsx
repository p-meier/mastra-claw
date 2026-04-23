/**
 * Convert a tool's machine name to something a human can read in a
 * chat bubble. Mastra's built-in workspace tools are namespaced as
 * `mastra_workspace_<verb>` (see `WORKSPACE_TOOLS` in
 * `@mastra/core/workspace`); we strip that prefix and present them as
 * `Workspace · <verb>` so the chat doesn't read like an API log.
 *
 * Anything else falls back to a slug-to-words conversion.
 */
export function humanizeToolName(toolName: string): string {
  if (toolName.startsWith('mastra_workspace_')) {
    const verb = toolName
      .slice('mastra_workspace_'.length)
      .replace(/_/g, ' ');
    return `Workspace · ${verb}`;
  }
  if (toolName.startsWith('mastra-memory-')) {
    const rest = toolName.slice('mastra-memory-'.length).replace(/[-_]+/g, ' ');
    return `Memory · ${rest}`;
  }
  return toolName.replace(/[_-]+/g, ' ');
}
