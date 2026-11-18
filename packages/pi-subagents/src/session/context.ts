/**
 * context.ts — Text extraction from message content blocks.
 */

import type { TextContent } from "@earendil-works/pi-ai";

/** Type predicate: narrow an unknown content block to TextContent. */
function isTextContent(c: unknown): c is TextContent {
  return typeof c === "object" && c !== null && (c as { type: string }).type === "text";
}

/** Extract text from a message content block array. */
export function extractText(content: unknown[]): string {
  return content
    .filter(isTextContent)
    .map((c) => c.text)
    .join("\n");
}
