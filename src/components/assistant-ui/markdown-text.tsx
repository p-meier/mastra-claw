'use client';

import { StreamdownTextPrimitive } from '@assistant-ui/react-streamdown';
import { code } from '@streamdown/code';
import { mermaid } from '@streamdown/mermaid';
import { memo } from 'react';

/**
 * Renderer for assistant text parts inside the Assistant UI chat surface.
 *
 * Backed by `@assistant-ui/react-streamdown`, which wraps `streamdown`
 * (built-in Shiki highlighting + mid-stream tolerant markdown). The
 * `code` plugin gives us syntax-highlighted code blocks with a copy
 * button out of the box; the `mermaid` plugin renders ```mermaid```
 * fences as diagrams. Math (KaTeX) and CJK optimisation are
 * intentionally not enabled — we don't need them and they pull in
 * non-trivial bundle weight.
 *
 * The `shikiTheme` prop is the streamdown default; we list it explicitly
 * as documentation, not behavior change.
 */
const MarkdownTextImpl = () => (
  <StreamdownTextPrimitive
    plugins={{ code, mermaid }}
    shikiTheme={['github-light', 'github-dark']}
  />
);

export const MarkdownText = memo(MarkdownTextImpl);
