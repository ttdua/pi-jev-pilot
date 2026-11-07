// Helpers for comparing recorded provider request bodies with and without the package.

export function toolNames(body: unknown): string[] {
  const tools = (body as { tools?: { function?: { name?: string } }[] }).tools ?? [];
  return tools.map((t) => t.function?.name ?? "");
}
