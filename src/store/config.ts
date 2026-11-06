import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RESERVED_SLOT_NAMES, TIERS } from "./defaults.ts";
import {
  array,
  boolean,
  integer,
  object,
  oneOf,
  refine,
  string,
  type Issue,
  type V,
} from "./validate.ts";

export type Slot = { name: string; model: string; when?: string };

export type Config = {
  classifier?: { url?: string; model?: string; apiKeyEnv?: string; timeoutMs?: number };
  tiers?: Partial<Record<(typeof TIERS)[number], string>>;
  crew?: { slots?: Slot[] };
  effort?: { holdProviders?: string[] };
  skills?: { inject?: "content" | "suggest" };
  tools?: { mode?: "observe" | "enforce" };
  state?: { parentRequest?: boolean };
  review?: { cli?: "codex" | "opencode" };
};

export type ConfigRead =
  | { kind: "ok"; present: boolean; config: Config }
  | { kind: "invalid"; issues: Issue[] };

const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

function urlAllowed(text: string): boolean {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "") return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname);
}

const modelId = string({ pattern: /^[A-Za-z0-9._-]+\/[^\s]+$/, max: 128 });
const url = refine(
  string({}),
  urlAllowed,
  "expected an https URL, or http on a loopback host, without credentials",
);

function slotName(seen: Set<string>): V<string> {
  const base = string({ pattern: /^[a-z][a-z0-9-]{0,23}$/ });
  return (value, path, issues) => {
    const name = base(value, path, issues);
    if (name === undefined) return undefined;
    if (RESERVED_SLOT_NAMES.includes(name)) {
      issues.push({ path, message: "expected a name that is not reserved" });
      return undefined;
    }
    if (seen.has(name)) {
      issues.push({ path, message: "expected a unique slot name" });
      return undefined;
    }
    seen.add(name);
    return name;
  };
}

/** Validates `crew.slots`; slot-name uniqueness is tracked per call. */
export const slotsValidator: V<Slot[]> = (value, path, issues) => {
  const seen = new Set<string>();
  return array(
    object(
      {
        name: slotName(seen),
        model: modelId,
        when: string({ min: 1, max: 500, trim: true }),
      },
      { required: ["name", "model"] },
    ),
    { max: 8 },
  )(value, path, issues) as Slot[] | undefined;
};

const providerName = string({ pattern: /^[A-Za-z0-9._-]{1,64}$/ });

function configValidator(): V<Config> {
  return object({
    classifier: object({
      url,
      model: string({ pattern: /^[A-Za-z0-9._-]{1,64}$/ }),
      apiKeyEnv: string({ pattern: /^[A-Z_][A-Z0-9_]{0,63}$/ }),
      timeoutMs: integer({ min: 300, max: 5000 }),
    }),
    tiers: object(Object.fromEntries(TIERS.map((t) => [t, modelId]))),
    crew: object({ slots: slotsValidator }),
    effort: object({ holdProviders: array(providerName, { max: 32, uniqueBy: (s) => s }) }),
    skills: object({ inject: oneOf(["content", "suggest"] as const) }),
    tools: object({ mode: oneOf(["observe", "enforce"] as const) }),
    state: object({ parentRequest: boolean() }),
    review: object({ cli: oneOf(["codex", "opencode"] as const) }),
  }) as V<Config>;
}

export function readConfig(dir: string): ConfigRead {
  let text: string;
  try {
    text = readFileSync(join(dir, "config.json"), "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "EIO";
    if (code === "ENOENT") return { kind: "ok", present: false, config: {} };
    return {
      kind: "invalid",
      issues: [{ path: "", message: `cannot read config.json (${code})` }],
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { kind: "invalid", issues: [{ path: "", message: "config.json is not valid JSON" }] };
  }
  const issues: Issue[] = [];
  const config = configValidator()(raw, "", issues);
  if (issues.length > 0 || config === undefined) return { kind: "invalid", issues };
  return { kind: "ok", present: true, config };
}
