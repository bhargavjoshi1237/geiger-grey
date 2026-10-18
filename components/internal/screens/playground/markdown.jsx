"use client";

import React, { useMemo } from "react";
import { Check, Copy } from "lucide-react";

import { cn } from "@/lib/utils";
import { parseMarkdown } from "@/lib/grey/chat_markdown";
import { useCopy } from "@/lib/hooks/use-copy";

// Renders a model answer from the AST in lib/grey/chat_markdown.js — React nodes only, so
// model output never becomes markup. `renderCite(n, key)` draws the [n] citation markers.

const ALIGN = { left: "text-left", center: "text-center", right: "text-right" };

function Inline({ tokens, renderCite }) {
  return tokens.map((token, i) => {
    switch (token.type) {
      case "text":
        return <React.Fragment key={i}>{token.text}</React.Fragment>;
      case "code":
        return (
          <code key={i} className="rounded-[5px] border border-border bg-surface-card px-1 py-px font-mono text-[0.8125rem]">
            {token.text}
          </code>
        );
      case "strong":
        return (
          <strong key={i} className="font-semibold text-foreground">
            <Inline tokens={token.children} renderCite={renderCite} />
          </strong>
        );
      case "em":
        return (
          <em key={i}>
            <Inline tokens={token.children} renderCite={renderCite} />
          </em>
        );
      case "del":
        return (
          <del key={i} className="text-text-secondary">
            <Inline tokens={token.children} renderCite={renderCite} />
          </del>
        );
      case "link":
        return (
          <a
            key={i}
            href={token.href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline decoration-border-strong underline-offset-2 transition-colors hover:decoration-foreground"
          >
            <Inline tokens={token.children} renderCite={renderCite} />
          </a>
        );
      case "cite":
        return renderCite ? renderCite(token.n, i) : <React.Fragment key={i}>[{token.n}]</React.Fragment>;
      default:
        return null;
    }
  });
}

function CodeBlock({ lang, text }) {
  const { copied, copy } = useCopy({ successMessage: null });
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-card">
      <div className="flex h-8 items-center justify-between border-b border-border pl-3 pr-1">
        <span className="font-mono text-[11px] text-text-tertiary">{lang || "text"}</span>
        <button
          type="button"
          onClick={() => copy(text)}
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="scrollbar-subtle overflow-x-auto p-3 font-mono text-xs leading-5 text-foreground">
        <code>{text}</code>
      </pre>
    </div>
  );
}

function Blocks({ blocks, renderCite, tight = false }) {
  return blocks.map((block, i) => {
    switch (block.type) {
      case "paragraph":
        return (
          <p key={i} className="whitespace-pre-line">
            <Inline tokens={block.inline} renderCite={renderCite} />
          </p>
        );
      case "heading":
        return React.createElement(
          `h${Math.min(block.level + 1, 6)}`,
          {
            key: i,
            className: cn("font-semibold text-foreground", block.level === 1 ? "pt-1 text-base" : "pt-1 text-sm"),
          },
          <Inline tokens={block.inline} renderCite={renderCite} />,
        );
      case "list": {
        const ListTag = block.ordered ? "ol" : "ul";
        return (
          <ListTag
            key={i}
            start={block.ordered && block.start !== 1 ? block.start : undefined}
            className={cn("space-y-1 pl-5 marker:text-text-tertiary", block.ordered ? "list-decimal" : "list-disc")}
          >
            {block.items.map((item, j) => (
              <li key={j} className="space-y-1 pl-1">
                <Blocks blocks={item.blocks} renderCite={renderCite} tight />
              </li>
            ))}
          </ListTag>
        );
      }
      case "code":
        return <CodeBlock key={i} lang={block.lang} text={block.text} />;
      case "quote":
        return (
          <blockquote key={i} className="space-y-2 border-l-2 border-border-strong pl-3 text-text-secondary">
            <Blocks blocks={block.blocks} renderCite={renderCite} />
          </blockquote>
        );
      case "table":
        return (
          <div key={i} className="scrollbar-subtle overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-surface-card">
                <tr>
                  {block.header.map((cell, c) => (
                    <th key={c} className={cn("px-3 py-2 font-medium text-text-secondary", ALIGN[block.align[c]] || "text-left")}>
                      <Inline tokens={cell} renderCite={renderCite} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c} className={cn("border-t border-border px-3 py-2 align-top leading-5", ALIGN[block.align[c]])}>
                        <Inline tokens={cell} renderCite={renderCite} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "hr":
        return <hr key={i} className={cn("border-border", tight ? "my-1" : "my-2")} />;
      default:
        return null;
    }
  });
}

export function Markdown({ text, renderCite, className }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className={cn("space-y-3 break-words text-sm leading-relaxed text-foreground", className)}>
      <Blocks blocks={blocks} renderCite={renderCite} />
    </div>
  );
}

export default Markdown;
