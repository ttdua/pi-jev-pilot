// Argument parsing and plain-JSON config reading for the replay CLI. No import of src/store/.
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { TierName } from "../../src/policy/launch.ts";
import { MODE_NAMES, type ModeName } from "../../src/policy/worker/index.ts";
import type { PlainConfig } from "./variants.ts";

export const USAGE =
  "usage: bun scripts/replay/cli.ts --pass 1|report [--seed N] [--main N] [--workers N] " +
  "[--sessions DIR] [--capabilities FILE] [--models FILE] [--url URL] [--only VARIANTS] [--send]\n" +
  "--workers defaults to 46 for pass 1 and 200 for report.";

export class UsageError extends Error {}

const PASS1_WORKERS = 46;
const REPORT_WORKERS = 200;

/** The worker sample size: `--workers` when given, else the pass default. */
export const workersFor = (args: Pick<Args, "pass" | "workers">): number =>
  args.workers ?? (args.pass === "report" ? REPORT_WORKERS : PASS1_WORKERS);

function passOf(value: string | undefined): 1 | "report" {
  if (value === "1") return 1;
  if (value === "report") return "report";
  throw new UsageError("--pass accepts 1 or report");
}

export type Args = {
  pass: 1 | "report";
  only?: string[];
  seed: number;
  main: number;
  /** Absent when `--workers` is not given; each pass applies its own default. */
  workers?: number;
  sessions?: string;
  capabilities?: string;
  url?: string;
  send: boolean;
};

const TEXT_FLAGS = ["--sessions", "--capabilities", "--models", "--url", "--only"] as const;
const NUMBER_FLAGS = ["--seed", "--main", "--workers"] as const;

function count(flag: string, value: string | undefined): number {
  const n = Number(value);
  if (value === undefined || value === "" || !Number.isInteger(n) || n < 0) {
    throw new UsageError(`${flag} needs a non-negative integer`);
  }
  return n;
}

function onlyVariants(value: string | undefined): string[] {
  const names = (value ?? "").split(",").filter((n) => n !== "");
  if (names.length === 0) throw new UsageError("--only needs a comma-separated list of variants");
  return names;
}

type TextFlag = (typeof TEXT_FLAGS)[number];
type ParseState = {
  text: Partial<Record<TextFlag, string>>;
  nums: Record<string, number>;
  pass: 1 | "report" | undefined;
  send: boolean;
};

const isNumberFlag = (flag: string): boolean => (NUMBER_FLAGS as readonly string[]).includes(flag);
const isTextFlag = (flag: string): flag is TextFlag =>
  (TEXT_FLAGS as readonly string[]).includes(flag);

function textValue(flag: string, value: string | undefined): string {
  if (value === undefined || value === "") throw new UsageError(`${flag} needs a value`);
  return value;
}

/** Applies one flag to `state`; returns true when it consumed the following value. */
function applyFlag(state: ParseState, flag: string, value: string | undefined): boolean {
  if (flag === "--send") {
    state.send = true;
    return false;
  }
  if (flag === "--pass") {
    state.pass = passOf(value);
  } else if (isNumberFlag(flag)) {
    state.nums[flag] = count(flag, value);
  } else if (isTextFlag(flag)) {
    state.text[flag] = textValue(flag, value);
  } else {
    throw new UsageError(`unknown argument: ${flag}`);
  }
  return true;
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

export function parseArgs(argv: readonly string[]): Args {
  const state: ParseState = {
    text: {},
    nums: { "--seed": 1, "--main": 100 },
    pass: undefined,
    send: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (applyFlag(state, argv[i]!, argv[i + 1])) i++;
  }
  const { text, nums, pass, send } = state;
  if (pass === undefined) throw new UsageError("--pass is required");
  if (pass === "report" && text["--only"] !== undefined) {
    throw new UsageError("--only applies to pass 1");
  }
  return {
    pass,
    seed: nums["--seed"]!,
    main: nums["--main"]!,
    ...optional("workers", nums["--workers"]),
    ...optional("sessions", text["--sessions"]),
    ...optional("capabilities", text["--capabilities"]),
    ...optional("url", text["--url"]),
    ...(text["--only"] === undefined ? {} : { only: onlyVariants(text["--only"]) }),
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
