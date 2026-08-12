export type BroadcastInline =
  | { type: "text"; value: string }
  | { type: "bold" | "italic" | "underline" | "strike" | "code"; children: BroadcastInline[] }
  | { type: "link"; label: string; url: string };

export type BroadcastBlock =
  | { type: "paragraph" | "quote"; children: BroadcastInline[] }
  | { type: "blank" };

const markers = [
  { token: "**", type: "bold" as const },
  { token: "__", type: "underline" as const },
  { token: "~~", type: "strike" as const },
  { token: "`", type: "code" as const },
  { token: "*", type: "italic" as const },
];

function safeLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseBroadcastInline(input: string): BroadcastInline[] {
  const nodes: BroadcastInline[] = [];
  let text = "";
  const flush = () => { if (text) { nodes.push({ type: "text", value: text }); text = ""; } };

  for (let index = 0; index < input.length;) {
    const link = input.slice(index).match(/^\[([^\]\n]+)]\((https?:\/\/[^\s)]+)\)/);
    if (link) {
      const url = safeLink(link[2]);
      if (url) { flush(); nodes.push({ type: "link", label: link[1], url }); index += link[0].length; continue; }
    }

    const marker = markers.find(({ token }) => input.startsWith(token, index));
    if (marker) {
      const end = input.indexOf(marker.token, index + marker.token.length);
      if (end > index + marker.token.length) {
        flush();
        const inner = input.slice(index + marker.token.length, end);
        nodes.push({
          type: marker.type,
          children: marker.type === "code" ? [{ type: "text", value: inner }] : parseBroadcastInline(inner),
        });
        index = end + marker.token.length;
        continue;
      }
    }

    text += input[index];
    index += 1;
  }
  flush();
  return nodes;
}

export function parseBroadcast(message: string): BroadcastBlock[] {
  return message.split("\n").map((line) => {
    if (!line) return { type: "blank" } as const;
    if (line.startsWith("> ")) return { type: "quote", children: parseBroadcastInline(line.slice(2)) } as const;
    return { type: "paragraph", children: parseBroadcastInline(line) } as const;
  });
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inlineToTelegram(nodes: BroadcastInline[]): string {
  return nodes.map((node) => {
    if (node.type === "text") return escapeHtml(node.value);
    if (node.type === "link") return `<a href="${escapeHtml(node.url)}">${escapeHtml(node.label)}</a>`;
    const content = inlineToTelegram(node.children);
    if (node.type === "bold") return `<b>${content}</b>`;
    if (node.type === "italic") return `<i>${content}</i>`;
    if (node.type === "underline") return `<u>${content}</u>`;
    if (node.type === "strike") return `<s>${content}</s>`;
    return `<code>${content}</code>`;
  }).join("");
}

export function broadcastInlineToTelegramHtml(message: string) {
  return inlineToTelegram(parseBroadcastInline(message));
}

export function broadcastToTelegramHtml(message: string) {
  return parseBroadcast(message).map((block) => {
    if (block.type === "blank") return "";
    const content = inlineToTelegram(block.children);
    return block.type === "quote" ? `<blockquote>${content}</blockquote>` : content;
  }).join("\n");
}
