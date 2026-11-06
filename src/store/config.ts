import { readFileSync } from "node:fs";
import { writeFileAtomic } from "./atomic.ts";
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
  type WriteResult,
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

type Loaded =
  | { kind: "ok"; present: boolean; config: Config; raw: Record<string, unknown> }
  | { kind: "invalid"; issues: Issue[] };

/** Reads config.json once; the validated config and the parsed raw object come from the same text. */
function load(dir: string): Loaded {
  let text: string;
  try {
    text = readFileSync(join(dir, "config.json"), "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "EIO";
    if (code === "ENOENT") return { kind: "ok", present: false, config: {}, raw: {} };
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
  return { kind: "ok", present: true, config, raw: raw as Record<string, unknown> };
}

export function readConfig(dir: string): ConfigRead {
  const loaded = load(dir);
  if (loaded.kind === "invalid") return loaded;
  return { kind: "ok", present: loaded.present, config: loaded.config };
}

/** Replaces only `crew.slots` in config.json, keeping every other key and its order. Never throws. */
export function writeSlots(dir: string, slots: Slot[]): WriteResult {
  const current = load(dir);
  if (current.kind === "invalid") return { ok: false, issues: current.issues };
  const issues: Issue[] = [];
  slotsValidator(slots, "crew.slots", issues);
  if (issues.length > 0) return { ok: false, issues };
  if (!current.present && slots.length === 0) return { ok: true };

  const raw = current.raw;
  const crew = { ...(raw.crew as Record<string, unknown> | undefined) };
  if (slots.length > 0) {
    crew.slots = slots.map((s) => ({
      name: s.name,
      model: s.model,
      ...(s.when === undefined ? {} : { when: s.when }),
    }));
  } else {
    delete crew.slots;
  }
  if (slots.length === 0 && Object.keys(crew).length === 0) delete raw.crew;
  else raw.crew = crew;

  const written = writeFileAtomic(dir, "config.json", JSON.stringify(raw, null, 2) + "\n", {
    keepMode: true,
  });
  if (!written.ok) {
    return {
      ok: false,
      issues: [{ path: "", message: `cannot write config.json (${written.code})` }],
    };
  }
  return { ok: true };
}
