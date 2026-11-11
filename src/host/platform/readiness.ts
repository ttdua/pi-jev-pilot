import type { ExtensionAPI, ToolInfo } from "@earendil-works/pi-coding-agent";
import { readConfig, type ConfigRead } from "../../store/config.ts";
import { resolveSettings, untunedTimeout, type Settings } from "../../store/settings.ts";
import { readState, type StateRead } from "../../store/state-file.ts";
import { readTuning, type TuningDocument, type TuningRead } from "../../store/tuning-file.ts";
import type { Issue } from "../../store/validate.ts";
import { readLocalMode, type LocalModeRead } from "../../store/local-mode.ts";
import { capturedService, publishedService } from "./service.ts";
import { mainCwd } from "./main-cwd.ts";
import { jevDir } from "./stores.ts";

export type Snapshot = {
  config: { valid: true } | { valid: false; issues: Issue[] };
  state: { kind: StateRead["kind"]; issues: Issue[] };
  /** The directory mode file read, kept so the status can report a bad file. */
  localMode: { kind: LocalModeRead["kind"]; issues: Issue[] };
  settings: Settings;
  keyVar: string;
  keySet: boolean;
  executor: ExecutorState;
  tuning: { kind: TuningRead["kind"]; issues: Issue[]; record: TuningDocument };
  /** The classifier timeout before tuning: config value, else the default. */
  untunedTimeoutMs: number;
};

/** True when the variable holds a non-empty string. The value is never kept. */
export function isKeySet(env: Record<string, string | undefined>, varName: string): boolean {
  const value = env[varName];
  return typeof value === "string" && value.length > 0;
}

/** Whether exactly one usable executor is installed: none, the vendored one, or a second one beside it. */
export type ExecutorState =
  | { kind: "present" }
  | { kind: "absent" }
  | { kind: "duplicate"; path?: string };

const VENDORED_DIR = "/packages/pi-subagents/";

function insideVendored(path: string): boolean {
  return path.split("\\").join("/").includes(VENDORED_DIR);
}

function isOtherService(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  return (value as { implementation?: unknown }).implementation !== "@ttdua/pi-subagents";
}

/** A captured service the launch seams can be driven through. */
function isUsableCapture(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const service = value as { implementation?: unknown; registerLaunchPolicy?: unknown };
  return (
    service.implementation === "@ttdua/pi-subagents" &&
    typeof service.registerLaunchPolicy === "function"
  );
}

/**
 * Pure. `published` is the executor slot now, `captured` this package's copy of the main
 * service. Order: duplicate, then present (a usable captured service), else absent.
 */
export function executorState(
  tools: readonly ToolInfo[],
  published: unknown,
  captured: unknown,
): ExecutorState {
  const tool = tools.find((t) => t.name === "subagent");
  if (tool === undefined) return { kind: "absent" };
  const path = tool.sourceInfo?.path;
  if (path !== undefined && !insideVendored(path)) return { kind: "duplicate", path };
  if (isOtherService(published)) return { kind: "duplicate", ...(path ? { path } : {}) };
  return isUsableCapture(captured) ? { kind: "present" } : { kind: "absent" };
}

function toolNamesState(toolNames: readonly string[], given?: ExecutorState): ExecutorState {
  if (given !== undefined) return given;
  return { kind: hasExecutor(toolNames) ? "present" : "absent" };
}

export function hasExecutor(toolNames: readonly string[]): boolean {
  return toolNames.includes("subagent");
}

/** Pure: combine the two store reads, the environment and the tool list. */
export function buildSnapshot(input: {
  configRead: ConfigRead;
  stateRead: StateRead;
  env: Record<string, string | undefined>;
  toolNames: string[];
  /** The executor state; derived from the tool names when missing. */
  executor?: ExecutorState;
  tuningRead?: TuningRead;
  /** The directory mode file read; a missing read applies nothing. */
  localModeRead?: LocalModeRead;
}): Snapshot {
  const { configRead, stateRead, env, toolNames } = input;
  const tuningRead: TuningRead = input.tuningRead ?? {
    kind: "missing",
    record: {},
  };
  const state = stateRead.kind === "ok" ? stateRead.state : {};
  // An invalid config contributes nothing, so the key variable falls back to the default.
  const config = configRead.kind === "ok" ? configRead.config : {};
  // Tuning applies only on top of a valid config (design D3).
  const tuning = configRead.kind === "ok" ? tuningRead.record : undefined;
  const localModeRead: LocalModeRead = input.localModeRead ?? {
    kind: "missing",
  };
  const settings = resolveSettings({
    config,
    state,
    ...(tuning ? { tuning } : {}),
    ...(localModeRead.kind === "ok" ? { localMode: localModeRead.mode } : {}),
  });
  const keyVar = settings.classifier.apiKeyEnv;
  return {
    config:
      configRead.kind === "ok" ? { valid: true } : { valid: false, issues: configRead.issues },
    state: {
      kind: stateRead.kind,
      issues: "issues" in stateRead ? stateRead.issues : [],
    },
    localMode: {
      kind: localModeRead.kind,
      issues: "issues" in localModeRead ? localModeRead.issues : [],
    },
    settings,
    keyVar,
    keySet: isKeySet(env, keyVar),
    executor: toolNamesState(toolNames, input.executor),
    tuning: {
      kind: tuningRead.kind,
      issues: "issues" in tuningRead ? tuningRead.issues : [],
      record: tuningRead.record,
    },
    untunedTimeoutMs: untunedTimeout(config),
  };
}

/** Reads the three files, the directory mode file, the environment and the tool list now; keeps nothing between calls. */
export function loadSnapshot(pi: Pick<ExtensionAPI, "getAllTools">, cwd?: string): Snapshot {
  const dir = jevDir();
  const tools = pi.getAllTools();
  return buildSnapshot({
    executor: executorState(tools, publishedService(), capturedService()),
    configRead: readConfig(dir),
    stateRead: readState(dir),
    tuningRead: readTuning(dir),
    env: process.env,
    toolNames: tools.map((t) => t.name),
    localModeRead: readLocalMode(cwd ?? mainCwd() ?? process.cwd()),
  });
}
