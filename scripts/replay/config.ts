// Argument parsing and plain-JSON config reading for the replay CLI. No import of src/store/.
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { RICH_GROUPS, type RichGroup } from "../../src/jev/state.ts";
import type { TierName } from "../../src/policy/launch.ts";
import { MODE_NAMES, type ModeName } from "../../src/policy/modes.ts";
import type { PlainConfig } from "./variants.ts";

export const USAGE =
  "usage: bun scripts/replay/cli.ts --pass 1|2 [--kept GROUPS] [--seed N] [--main N] [--workers N] " +
  "[--sessions DIR] [--capabilities FILE] [--models FILE] [--url URL] [--send]";

export class UsageError extends Error {}

export type Args = {
  pass: 1 | 2;
  kept?: RichGroup[];
  seed: number;
  main: number;
  workers: number;
  sessions?: string;
  capabilities?: string;
  models?: string;
  url?: string;
  send: boolean;
};

const TEXT_FLAGS = ["--sessions", "--capabilities", "--models", "--url"] as const;
const NUMBER_FLAGS = ["--seed", "--main", "--workers"] as const;

function count(flag: string, value: string | undefined): number {
  const n = Number(value);
  if (value === undefined || value === "" || !Number.isInteger(n) || n < 0) {
    throw new UsageError(`${flag} needs a non-negative integer`);
  }
  return n;
}

function keptGroups(value: string | undefined): RichGroup[] {
  if (value === undefined) throw new UsageError("--kept needs a value");
  const names = value.split(",").filter((n) => n !== "");
  if (names.includes("git")) throw new UsageError("--kept lists kept groups; git is always probed");
  const known = new Set<string>(RICH_GROUPS);
  const unknown = names.filter((n) => !known.has(n));
  if (unknown.length > 0) throw new UsageError(`unknown group in --kept: ${unknown.join(", ")}`);
  return names as RichGroup[];
}

export function parseArgs(argv: readonly string[]): Args {
  const text: Partial<Record<(typeof TEXT_FLAGS)[number], string>> = {};
  const nums: Record<string, number> = { "--seed": 1, "--main": 100, "--workers": 46 };
  let pass: 1 | 2 | undefined;
  let kept: RichGroup[] | undefined;
  let send = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const value = argv[i + 1];
    if (flag === "--send") {
      send = true;
    } else if (flag === "--pass") {
      if (value !== "1" && value !== "2") throw new UsageError("--pass must be 1 or 2");
      pass = Number(value) as 1 | 2;
      i++;
    } else if (flag === "--kept") {
      kept = keptGroups(value);
      i++;
    } else if ((NUMBER_FLAGS as readonly string[]).includes(flag)) {
      nums[flag] = count(flag, value);
      i++;
    } else if ((TEXT_FLAGS as readonly string[]).includes(flag)) {
      if (value === undefined || value === "") throw new UsageError(`${flag} needs a value`);
      text[flag as (typeof TEXT_FLAGS)[number]] = value;
      i++;
    } else {
      throw new UsageError(`unknown argument: ${flag}`);
    }
  }
  if (pass === undefined) throw new UsageError("--pass is required");
  if (kept !== undefined && pass !== 2) throw new UsageError("--kept needs --pass 2");
  if (kept?.includes("capabilities") === true && text["--capabilities"] === undefined) {
    throw new UsageError("--kept capabilities needs --capabilities FILE");
  }
  return {
    pass,
    ...(kept === undefined ? {} : { kept }),
    seed: nums["--seed"]!,
    main: nums["--main"]!,
    workers: nums["--workers"]!,
    ...(text["--sessions"] === undefined ? {} : { sessions: text["--sessions"] }),
    ...(text["--capabilities"] === undefined ? {} : { capabilities: text["--capabilities"] }),
    ...(text["--models"] === undefined ? {} : { models: text["--models"] }),
    ...(text["--url"] === undefined ? {} : { url: text["--url"] }),
    send,
  };
}

export type ReplayConfig = {
  url: string;
  model: string;
  apiKeyEnv: string;
  plain: PlainConfig;
};

const DEFAULT_URL = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_MODEL = "jev-latest";
const DEFAULT_KEY_ENV = "TYPESAFE_API_KEY";
const TIER_NAMES: readonly TierName[] = ["fast", "balanced", "deep", "expert"];

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

function readJson(path: string): Rec {
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (isRec(parsed)) return parsed;
  } catch {
    /* reported below */
  }
  throw new UsageError(`${basename(path)} is not a JSON object: ${path}`);
}

function tiersOf(raw: unknown): PlainConfig["tiers"] {
  const out: PlainConfig["tiers"] = {};
  if (!isRec(raw)) return out;
  for (const name of TIER_NAMES) {
    const model = str(raw[name]);
    if (model !== undefined) out[name] = model;
  }
  return out;
}

function slotsOf(raw: unknown): PlainConfig["slots"] {
  const list = isRec(raw) && Array.isArray(raw.slots) ? raw.slots : [];
  return list.flatMap((s: unknown) => {
    if (!isRec(s)) return [];
    const [name, model, when] = [str(s.name), str(s.model), str(s.when)];
    return name && model && when ? [{ name, model, when }] : [];
  });
}

/** Reads `<jevDir>/config.json` and `state.json` as plain JSON; a missing file takes its defaults; a corrupt one is a UsageError. */
export function readConfig(jevDir: string): ReplayConfig {
  const config = readJson(join(jevDir, "config.json"));
  const state = readJson(join(jevDir, "state.json"));
  const classifier = isRec(config.classifier) ? config.classifier : {};
  const mode = (MODE_NAMES as readonly unknown[]).includes(state.mode)
    ? (state.mode as ModeName)
    : "standard";
  const switches = isRec(state.switches) ? state.switches : {};
  return {
    url: str(classifier.url) ?? DEFAULT_URL,
    model: str(classifier.model) ?? DEFAULT_MODEL,
    apiKeyEnv: str(classifier.apiKeyEnv) ?? DEFAULT_KEY_ENV,
    plain: {
      tiers: tiersOf(config.tiers),
      slots: slotsOf(config.crew),
      mode,
      expertOn: switches.expert !== false,
    },
  };
}

/** Reads `replay-git.jsonl` into `turnId -> counts`. Bad lines are skipped. */
export function readGitMap(
  jevDir: string,
): Map<string, { changed_files: number; diff_lines: number }> {
  const out = new Map<string, { changed_files: number; diff_lines: number }>();
  const path = join(jevDir, "replay-git.jsonl");
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    try {
      const rec: unknown = JSON.parse(line);
      if (
        isRec(rec) &&
        typeof rec.turnId === "string" &&
        typeof rec.changedFiles === "number" &&
        typeof rec.diffLines === "number"
      ) {
        out.set(rec.turnId, { changed_files: rec.changedFiles, diff_lines: rec.diffLines });
      }
    } catch {
      /* skip bad line */
    }
  }
  return out;
}
