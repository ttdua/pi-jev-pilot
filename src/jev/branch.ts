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

type Tool = { name: string; failed?: true };
type Message = {
  role: string;
  content?: unknown;
  toolCallId?: string;
  isError?: boolean;
};

function readUser(message: Message): BranchItem {
  return { role: "user", text: textOf(message.content), tools: [] };
}

/** Tool calls of an assistant message, registered by id so a failed result can mark them. */
function readAssistant(message: Message, calls: Map<string, Tool>): BranchItem {
  const tools: Tool[] = [];
  if (Array.isArray(message.content)) {
    for (const part of message.content as Part[]) {
      if (part?.type !== "toolCall" || typeof part.name !== "string") continue;
      const tool: Tool = { name: part.name };
      tools.push(tool);
      if (typeof part.id === "string") calls.set(part.id, tool);
    }
  }
  return { role: "assistant", text: textOf(message.content), tools };
}

function readToolResult(message: Message, calls: Map<string, Tool>): BranchItem {
  const isError = message.isError === true;
  if (isError && message.toolCallId) {
    const call = calls.get(message.toolCallId);
    if (call) call.failed = true;
  }
  return { role: "toolResult", text: "", tools: [], ...(isError ? { isError } : {}) };
}

function readMessage(message: Message, calls: Map<string, Tool>): BranchItem | undefined {
  if (message.role === "user") return readUser(message);
  if (message.role === "assistant") return readAssistant(message, calls);
  if (message.role === "toolResult") return readToolResult(message, calls);
  return undefined;
}

/** Text and tool names only; never arguments, results, thinking or images. */
export function branchItems(entries: readonly SessionEntryLike[]): BranchItem[] {
  const items: BranchItem[] = [];
  const calls = new Map<string, Tool>();
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const item = readMessage(entry.message as unknown as Message, calls);
    if (item) items.push(item);
  }
  return items;
}
