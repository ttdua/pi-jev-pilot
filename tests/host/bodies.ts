// Helpers for comparing recorded provider request bodies with and without the package.

export function toolNames(body: unknown): string[] {
  const tools = (body as { tools?: { function?: { name?: string } }[] }).tools ?? [];
  return tools.map((t) => t.function?.name ?? "");
}

/** Drops the jev_review tool entry and the system-prompt lines that mention it. */
export function withoutReview(body: unknown): unknown {
  const b = structuredClone(body) as {
    tools?: { function?: { name?: string } }[];
    messages?: { content?: unknown }[];
  };
  if (b.tools) b.tools = b.tools.filter((t) => t.function?.name !== "jev_review");
  for (const m of b.messages ?? []) {
    if (typeof m.content === "string") {
      m.content = m.content
        .split("\n")
        .filter((l) => !l.includes("jev_review"))
        .join("\n");
    }
  }
  return b;
}
