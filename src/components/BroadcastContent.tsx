import type { ReactNode } from "react";
import { parseBroadcast, parseBroadcastInline, type BroadcastInline } from "@/lib/broadcast-format";

function renderInline(nodes: BroadcastInline[]): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${node.type}-${index}`;
    if (node.type === "text") return node.value;
    if (node.type === "link") return <a key={key} href={node.url} target="_blank" rel="noopener noreferrer" className="text-lime underline decoration-lime/30 underline-offset-2 hover:decoration-lime">{node.label}</a>;
    const content = renderInline(node.children);
    if (node.type === "bold") return <strong key={key} className="font-bold text-text-primary">{content}</strong>;
    if (node.type === "italic") return <em key={key}>{content}</em>;
    if (node.type === "underline") return <u key={key} className="underline-offset-2">{content}</u>;
    if (node.type === "strike") return <s key={key} className="text-text-tertiary">{content}</s>;
    return <code key={key} className="rounded bg-black/25 px-1.5 py-0.5 font-mono text-[0.9em] text-mint">{content}</code>;
  });
}

export default function BroadcastContent({ message, className = "" }: { message: string; className?: string }) {
  return <div className={`space-y-2 whitespace-pre-wrap text-sm leading-relaxed ${className}`}>
    {parseBroadcast(message).map((block, index) => {
      if (block.type === "blank") return <div key={index} className="h-1" aria-hidden="true" />;
      if (block.type === "quote") return <blockquote key={index} className="border-l-2 border-lime/50 bg-lime/[0.04] px-3 py-2 italic text-text-secondary">{renderInline(block.children)}</blockquote>;
      return <p key={index}>{renderInline(block.children)}</p>;
    })}
  </div>;
}

export function BroadcastInlineContent({ message }: { message: string }) {
  return <>{renderInline(parseBroadcastInline(message))}</>;
}
