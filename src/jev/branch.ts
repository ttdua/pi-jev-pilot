// Reads Pi-shaped session entries into the plain branch items of the state builder.
import type { BranchItem } from "./state.ts";

/** The structural slice of a Pi session entry that the readers use. */
export type SessionEntryLike = {
  type: string;
  id?: string;
  customType?: string;
  data?: unknown;
  message?: unknown;
};

type Part = { type?: string; text?: string; name?: string; id?: string };

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Part[])
    .filter((p) => p?.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n");
}

/** Text and tool names only; never arguments, results, thinking or images. */
export function branchItems(entries: readonly SessionEntryLike[]): BranchItem[] {
  const items: BranchItem[] = [];
  const calls = new Map<string, { name: string; failed?: true }>();
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message as unknown as {
      role: string;
      content?: unknown;
      toolCallId?: string;
      isError?: boolean;
    };
    if (message.role === "user") {
      items.push({ role: "user", text: textOf(message.content), tools: [] });
    } else if (message.role === "assistant") {
      const tools: { name: string; failed?: true }[] = [];
      if (Array.isArray(message.content)) {
        for (const part of message.content as Part[]) {
          if (part?.type !== "toolCall" || typeof part.name !== "string") continue;
          const tool: { name: string; failed?: true } = { name: part.name };
          tools.push(tool);
          if (typeof part.id === "string") calls.set(part.id, tool);
        }
      }
      items.push({ role: "assistant", text: textOf(message.content), tools });
    } else if (message.role === "toolResult") {
      const isError = message.isError === true;
      if (isError && message.toolCallId) {
        const call = calls.get(message.toolCallId);
        if (call) call.failed = true;
      }
      items.push({ role: "toolResult", text: "", tools: [], ...(isError ? { isError } : {}) });
    }
  }
  return items;
}
