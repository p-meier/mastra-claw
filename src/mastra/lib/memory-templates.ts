/**
 * Working-memory templates.
 *
 * Working memory is keyed by (agentId, resourceId). For personal
 * agents the resourceId is `user:{userId}`, so the template describes
 * one person. Global agents usually disable working memory entirely.
 *
 * Agents reference the template via
 * `new Memory({ options: { workingMemory: { template: DEFAULT_USER_MEMORY_TEMPLATE } } })`
 * or inline a domain-specific one.
 */

export const DEFAULT_USER_MEMORY_TEMPLATE = `# User profile

- Name:
- Role / domain:
- Communication style (concise / detailed / formal / casual):
- Current projects:
- Known preferences:
- Things to remember long-term:
`;
