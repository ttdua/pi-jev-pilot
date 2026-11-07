export type ToolFacts = {
  name: string;
  description: string;
  source: string;
  parameters: Record<string, string>;
};

function attempt<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sourceOf(info: Record<string, unknown>): string {
  const sourceInfo = info["sourceInfo"];
  if (!isObject(sourceInfo)) return "unknown";
  const source = sourceInfo["source"];
  return typeof source === "string" && source !== "" ? source : "unknown";
}

function parametersOf(info: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const schema = info["parameters"];
  if (!isObject(schema)) return out;
  const properties = schema["properties"];
  if (!isObject(properties)) return out;
  for (const key of Object.keys(properties)) {
    const property = properties[key];
    const description = isObject(property) ? property["description"] : undefined;
    if (typeof description === "string") {
      Object.defineProperty(out, key, {
        value: description,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return out;
}

/** Map Pi's ToolInfo to a tool entry; never throws, falls back per field. */
export function toolFacts(info: unknown): ToolFacts | undefined {
  if (!isObject(info)) return undefined;
  const name = attempt(() => info["name"], undefined);
  if (typeof name !== "string" || name === "") return undefined;
  const description = attempt(() => {
    const value = info["description"];
    return typeof value === "string" ? value : "";
  }, "");
  return {
    name,
    description,
    source: attempt(() => sourceOf(info), "unknown"),
    parameters: attempt(() => parametersOf(info), {}),
  };
}
