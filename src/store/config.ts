import { readFileSync } from "node:fs";
import { writeFileAtomic } from "./atomic.ts";
import { join } from "node:path";
import { isAllowedJevUrl } from "../shared/urls.ts";
import { LEGACY_TIER, RESERVED_SLOT_NAMES, TIERS } from "./defaults.ts";
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

export type Slot = { name: string; model: string; when: string };

export type Config = {
  classifier?: { url?: string; model?: string; apiKeyEnv?: string; timeoutMs?: number };
  tiers?: Partial<Record<(typeof TIERS)[number], string>>;
  crew?: { slots?: Slot[] };
  effort?: { holdProviders?: string[] };
  skills?: { inject?: "content" | "suggest" };
  state?: { parentRequest?: boolean };
  subagents?: { forkLaunch?: "untouched" | "thinking"; forkedLaunch?: "untouched" | "thinking" };
  review?: { cli?: "codex" | "opencode"; enabled?: boolean };
};

export type ConfigRead =
  | {
      kind: "ok";
      present: boolean;
      config: Config;
      notices: string[];
      deprecated: readonly "tools"[];
    }
  | { kind: "invalid"; issues: Issue[] };

const modelId = string({ pattern: /^[A-Za-z0-9._-]+\/[^\s]+$/, max: 128 });
const url = refine(
  string({}),
  isAllowedJevUrl,
  "expected an https URL, or http on a loopback host, without credentials",
);

// DEPRECATED(remove next minor): a slot named `frontier` is read on, never written.
const LEGACY_SLOT_NAME = "frontier";

/** `strict` refuses every reserved name (writes); a read also accepts an existing `frontier` slot. */
function slotName(seen: Set<string>, strict: boolean): V<string> {
  const base = string({ pattern: /^[a-z][a-z0-9-]{0,23}$/ });
  return (value, path, issues) => {
    const name = base(value, path, issues);
    if (name === undefined) return undefined;
    if (RESERVED_SLOT_NAMES.includes(name) && (strict || name !== LEGACY_SLOT_NAME)) {
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

function slotsFor(strict: boolean): V<Slot[]> {
  return (value, path, issues) => {
    const seen = new Set<string>();
    return array(
      object(
        {
          name: slotName(seen, strict),
          model: modelId,
          when: string({ min: 1, max: 500, trim: true }),
        },
        { required: ["name", "model", "when"] },
      ),
      { max: 8 },
    )(value, path, issues) as Slot[] | undefined;
  };
}

/** Validates `crew.slots` for a write; slot-name uniqueness is tracked per call. */
export const slotsValidator: V<Slot[]> = slotsFor(true);

const providerName = string({ pattern: /^[A-Za-z0-9._-]{1,64}$/ });

/** The Jev classifier's model id; its own rule, so router ids like `provider/vendor/model:tag` fit. */
const classifierModel = string({ pattern: /^[A-Za-z0-9._][A-Za-z0-9._:/-]{0,127}$/ });

/** The retired `tools` section: any value is accepted and ignored. */
const retiredSection: V<undefined> = () => undefined;

function configValidator(): V<Config> {
  return object({
    classifier: object({
      url,
      model: classifierModel,
      apiKeyEnv: string({ pattern: /^[A-Z_][A-Z0-9_]{0,63}$/ }),
      timeoutMs: integer({ min: 300, max: 5000 }),
    }),
    // DEPRECATED(remove next minor): the legacy tier keys are accepted beside the new ones.
    tiers: object(
      Object.fromEntries([...TIERS, ...Object.keys(LEGACY_TIER)].map((t) => [t, modelId])),
    ),
    crew: object({ slots: slotsFor(false) }),
    effort: object({ holdProviders: array(providerName, { max: 32, uniqueBy: (s) => s }) }),
    skills: object({ inject: oneOf(["content", "suggest"] as const) }),
    tools: retiredSection,
    state: object({ parentRequest: boolean() }),
    subagents: object({
      forkLaunch: oneOf(["untouched", "thinking"] as const),
      forkedLaunch: oneOf(["untouched", "thinking"] as const),
    }),
    review: object({ cli: oneOf(["codex", "opencode"] as const), enabled: boolean() }),
  }) as V<Config>;
}

type Loaded =
  | {
      kind: "ok";
      present: boolean;
      config: Config;
      raw: Record<string, unknown>;
      notices: string[];
    }
  | { kind: "invalid"; issues: Issue[] };

/** Reads config.json once; the validated config and the parsed raw object come from the same text. */
function load(dir: string): Loaded {
  let text: string;
  try {
    text = readFileSync(join(dir, "config.json"), "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "EIO";
    if (code === "ENOENT") return { kind: "ok", present: false, config: {}, raw: {}, notices: [] };
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
  reportBothForkKeys(raw, issues);
  reportBothTierKeys(raw, issues);
  if (issues.length > 0 || config === undefined) return { kind: "invalid", issues };
  const notices = [...applyDeprecatedAlias(config), ...applyLegacyTierNames(config)];
  return { kind: "ok", present: true, config, raw: raw as Record<string, unknown>, notices };
}

/** Both fork keys in the raw `subagents` object is a problem at the deprecated key, whatever else is wrong. */
function reportBothForkKeys(raw: unknown, issues: Issue[]): void {
  if (typeof raw !== "object" || raw === null) return;
  const sub = (raw as { subagents?: unknown }).subagents;
  if (typeof sub !== "object" || sub === null || Array.isArray(sub)) return;
  const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(sub, k);
  if (!has("forkLaunch") || !has("forkedLaunch")) return;
  issues.push({
    path: "subagents.forkedLaunch",
    message: "expected only one of subagents.forkLaunch and the deprecated subagents.forkedLaunch",
  });
}

// DEPRECATED(remove next minor): subagents.forkedLaunch alias
/** Moves the deprecated `subagents.forkedLaunch` onto `forkLaunch`; both keys are rejected before this runs. */
function applyDeprecatedAlias(config: Config): string[] {
  const sub = config.subagents;
  if (sub?.forkedLaunch === undefined) return [];
  sub.forkLaunch = sub.forkedLaunch;
  delete sub.forkedLaunch;
  return ["subagents.forkedLaunch is deprecated; rename it to subagents.forkLaunch"];
}

// DEPRECATED(remove next minor): tiers.fast|balanced|expert aliases
/** A legacy tier key beside its new key in the raw `tiers` object is a problem at the legacy key. */
function reportBothTierKeys(raw: unknown, issues: Issue[]): void {
  const tiers = rawTiers(raw);
  if (tiers === undefined) return;
  for (const [legacy, current] of Object.entries(LEGACY_TIER)) {
    if (Object.hasOwn(tiers, legacy) && Object.hasOwn(tiers, current)) {
      issues.push({
        path: `tiers.${legacy}`,
        message: `expected only one of tiers.${current} and the deprecated tiers.${legacy}`,
      });
    }
  }
}

function rawTiers(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const tiers = (raw as { tiers?: unknown }).tiers;
  return typeof tiers === "object" && tiers !== null && !Array.isArray(tiers)
    ? (tiers as Record<string, unknown>)
    : undefined;
}

// DEPRECATED(remove next minor): tiers.fast|balanced|expert aliases, and a `frontier` slot
/** Moves the legacy tier keys onto the new ones and notes a `frontier` slot; both keys were rejected before this runs. */
function applyLegacyTierNames(config: Config): string[] {
  const notices: string[] = [];
  const tiers = config.tiers as Record<string, string> | undefined;
  for (const [legacy, current] of Object.entries(LEGACY_TIER)) {
    if (tiers?.[legacy] === undefined) continue;
    tiers[current] = tiers[legacy];
    delete tiers[legacy];
    notices.push(`tiers.${legacy} is deprecated; rename it to tiers.${current}`);
  }
  if (config.crew?.slots?.some((s) => s.name === LEGACY_SLOT_NAME)) {
    notices.push(`crew.slots "${LEGACY_SLOT_NAME}" uses a reserved name; rename it`);
  }
  return notices;
}

export function readConfig(dir: string): ConfigRead {
  const loaded = load(dir);
  if (loaded.kind === "invalid") return loaded;
  const deprecated = Object.hasOwn(loaded.raw, "tools") ? (["tools"] as const) : ([] as const);
  return {
    kind: "ok",
    present: loaded.present,
    config: loaded.config,
    notices: loaded.notices,
    deprecated,
  };
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
    crew.slots = slots.map((s) => ({ name: s.name, model: s.model, when: s.when }));
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

// DEPRECATED(remove next minor)
/**
 * Renames the legacy tier keys in place, keeping every position and value; `undefined` when the
 * file is invalid, has a legacy key beside its new key, or has nothing to rename. Does not mutate `raw`.
 */
export function migrateTierKeys(
  raw: Record<string, unknown>,
): { raw: Record<string, unknown>; renamed: [string, string][] } | undefined {
  const tiers = rawTiers(raw);
  if (tiers === undefined) return undefined;
  const renamed: [string, string][] = [];
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(tiers)) {
    const current = (LEGACY_TIER as Record<string, string>)[key];
    if (current === undefined) next[key] = value;
    else {
      next[current] = value;
      renamed.push([`tiers.${key}`, `tiers.${current}`]);
    }
  }
  if (renamed.length === 0) return undefined;
  const issues: Issue[] = [];
  configValidator()(raw, "", issues);
  reportBothTierKeys(raw, issues);
  if (issues.length > 0) return undefined;
  return { raw: { ...raw, tiers: next }, renamed };
}

// DEPRECATED(remove next minor)
/** Rewrites config.json with the new tier keys, keeping the mode; `undefined` when nothing needed to change. */
export function migrateConfigFile(
  dir: string,
): { renamed: [string, string][] } | { error: string } | undefined {
  const current = load(dir);
  if (current.kind === "invalid" || !current.present) return undefined;
  const migrated = migrateTierKeys(current.raw);
  if (migrated === undefined) return undefined;
  const written = writeFileAtomic(
    dir,
    "config.json",
    JSON.stringify(migrated.raw, null, 2) + "\n",
    {
      keepMode: true,
    },
  );
  if (!written.ok) return { error: `cannot write config.json (${written.code})` };
  return { renamed: migrated.renamed };
}
