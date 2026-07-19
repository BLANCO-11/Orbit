'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * MarkdownMessage — renders assistant markdown with react-markdown so React
 * RECONCILES the DOM as tokens stream in: only the changed tail mutates.
 *
 * This replaces the previous `marked.parse` + `DOMPurify.sanitize` +
 * `dangerouslySetInnerHTML` path, which rebuilt the entire HTML string and blew
 * away the whole bubble subtree every animation frame — the cause of the
 * streaming flicker/stutter (lost text selection, reloaded images, relayout, and
 * O(n²) cost as the message grew). react-markdown produces a React element tree
 * that React diffs, so a growing message only appends nodes.
 *
 * Safety: react-markdown does not render raw HTML by default (no rehype-raw), so
 * model output can't inject markup — DOMPurify is no longer needed here.
 *
 * Memoized on `content`/`className` so a bubble whose text is unchanged (every
 * prior message during streaming) never re-parses.
 */
function MarkdownMessageBase({ content, className = '' }: { content: string; className?: string }) {
  return (
    <div className={`markdown-content ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // External links open safely in a new tab.
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener" />
          ),
          // Lazy-load images so a mid-stream <img> doesn't block/reflow.
          img: ({ node, ...props }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img {...props} loading="lazy" alt={props.alt || ''} />
          ),
        }}
      >
        {content || ''}
      </ReactMarkdown>
    </div>
  );
}

const MarkdownMessage = React.memo(MarkdownMessageBase);
export default MarkdownMessage;
