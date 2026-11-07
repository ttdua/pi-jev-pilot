import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DECISION_FEATURES, FEATURES, MODES, type Feature, type Mode } from "../store/defaults.ts";
import { resetState, updateState, validateCliReview } from "../store/state-file.ts";
import { recentMix, WINDOW_MIN } from "../policy/cut-window.ts";
import type { WindowEntry } from "../policy/cutpoints.ts";
import { MODE_TARGETS } from "../policy/modes.ts";
import { isChild } from "./child.ts";
import {
  checkCodexChoice,
  checkOpencodeChoice,
  parseCodexCatalog,
  parseOpencodeModels,
  type CheckResult,
  type Exec,
} from "./review-cli.ts";
import type { Snapshot } from "./readiness.ts";
import { parseSlotArgs, runSlot, type SlotArgs } from "./slots.ts";
import type { TuneOutcome, TuneSub } from "./tune-command.ts";
import type { UiCtx } from "./tuning-deps.ts";
import { issueLines } from "./tuning-text.ts";
import {
  EMPTY_TALLY,
  drawStatus,
  statusText,
  tallyLines,
  type Decision,
  type Tally,
} from "./status.ts";

export type JevArgs =
  | { kind: "status" }
  | { kind: "set"; feature: Feature; on: boolean }
  | { kind: "all"; on: boolean }
  | { kind: "mode"; mode: Mode }
  | { kind: "reset" }
  | { kind: "cli-review"; cli: "codex" | "opencode"; model?: string; effort?: string }
  | { kind: "slot"; args: SlotArgs }
  | { kind: "tune"; sub: TuneSub }
  | { kind: "usage" };

const USAGE: JevArgs = { kind: "usage" };

function parseCliReview(words: string[]): JevArgs {
  const [, cli, model, effort] = words;
  if (words.length < 2 || words.length > 4) return USAGE;
  if (cli !== "codex" && cli !== "opencode") return USAGE;
  return {
    kind: "cli-review",
    cli,
    ...(model === undefined || model === "default" ? {} : { model }),
    ...(effort === undefined || effort === "default" ? {} : { effort }),
  };
}

const TUNE_SUBS: readonly string[] = ["undo", "reset", "on", "off"];

function parseTune(words: string[]): JevArgs {
  if (words.length === 1) return { kind: "tune", sub: "report" };
  const sub = words[1]!;
  return words.length === 2 && TUNE_SUBS.includes(sub)
    ? { kind: "tune", sub: sub as TuneSub }
    : USAGE;
}

/** Split on whitespace and match case-sensitively; only an empty argument is the status form. */
export function parseJevArgs(text: string): JevArgs {
  const words = text.trim() === "" ? [] : text.trim().split(/\s+/);
  if (words.length === 0) return { kind: "status" };
  if (words[0] === "cli-review") return parseCliReview(words);
  if (words[0] === "tune") return parseTune(words);
  const slot = parseSlotArgs(text);
  if (slot !== undefined) return slot === "usage" ? USAGE : { kind: "slot", args: slot };
  const [head, value, ...rest] = words;
  if (words.length === 1) return head === "reset" ? { kind: "reset" } : USAGE;
  if (head === "mode") {
    return rest.length === 0 && (MODES as readonly string[]).includes(value!)
      ? { kind: "mode", mode: value as Mode }
      : USAGE;
  }
  if (rest.length > 0 || (value !== "on" && value !== "off")) return USAGE;
  const on = value === "on";
  if (head === "all") return { kind: "all", on };
  if ((FEATURES as readonly string[]).includes(head!)) {
    return { kind: "set", feature: head as Feature, on };
  }
  return USAGE;
}

export function usageText(): string {
  return [
    "Usage:",
    "  /jev                      show the status",
    "  /jev <feature> on|off     switch one feature",
    `      features: ${FEATURES.join(", ")}`,
    "  /jev all on|off           switch the seven decision features",
    "  /jev mode budget|standard|premium  choose the worker mode",
    "  /jev reset                reset switches, mode and CLI review default",
    "  /jev cli-review <codex|opencode> [model|default] [effort|default]",
    "  /jev <slot> <provider/model> [when <text>]",
    "  /jev <slot>",
    "  /jev remove <slot>",
    "  /jev tune [undo|reset|on|off]   show or change tuning",
  ].join("\n");
}

function reviewLine(r: Snapshot["settings"]["review"]): string {
  const parts = [
    ...(r.model ? [`model ${r.model}`] : []),
    ...(r.effort ? [`effort ${r.effort}`] : []),
  ];
  return `cli review: ${r.cli} (${parts.length > 0 ? parts.join(", ") : "CLI defaults"})`;
}

function mixLines(mode: Mode, window: readonly WindowEntry[]): string[] {
  const { n, shares } = recentMix(window);
  if (shares === undefined) return ["mix: no routed workers yet", "cut points: seed"];
  const tg = MODE_TARGETS[mode];
  const lines = [
    `mix (last ${n}, ${mode}): fast ${shares.fast}% / balanced ${shares.balanced}% / ` +
      `deep ${shares.deep}% / expert ${shares.expert}% · ` +
      `target ${tg.fast}/${tg.balanced}/${tg.deep}/≤${tg.expertCap}`,
  ];
  if (n < WINDOW_MIN) lines.push("cut points: seed");
  return lines;
}

export function formatStatus(s: Snapshot, t?: Tally, window?: readonly WindowEntry[]): string {
  const lines = [statusText(s), `mode: ${s.settings.mode}`, "features:"];
  for (const f of FEATURES) lines.push(`  ${f}: ${s.settings.switches[f] ? "on" : "off"}`);
  lines.push(reviewLine(s.settings.review));
  lines.push(`key: ${s.keyVar} ${s.keySet ? "set" : "not set"}`);
  lines.push(
    s.executor
      ? "executor: present"
      : "executor: no executor; worker routing and tool assessment are off",
  );
  const problems: string[] = [];
  if (!s.config.valid) problems.push(...issueLines("config", s.config.issues));
  problems.push(...issueLines(`state (${s.state.kind})`, s.state.issues));
  problems.push(...issueLines(`tuning (${s.tuning.kind})`, s.tuning.issues));
  if (problems.length > 0) lines.push("problems:", ...problems);
  if (s.executor && window) lines.push(...mixLines(s.settings.mode, window));
  if (t) lines.push(...tallyLines(t));
  return lines.join("\n");
}

function describeError(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string") return code;
  return err instanceof Error ? err.constructor.name : "UnknownError";
}

type CliReviewArgs = Extract<JevArgs, { kind: "cli-review" }>;

/** The check, or a `reason` when the model list cannot be read. */
async function checkAgainstCli(
  a: CliReviewArgs,
  exec: Exec,
): Promise<{ check: CheckResult } | { reason: string }> {
  const [cmd, args] = a.cli === "codex" ? ["codex", ["debug", "models"]] : ["opencode", ["models"]];
  let r: Awaited<ReturnType<Exec>> | undefined;
  try {
    r = await exec(cmd!, args!, { timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  } catch {
    r = undefined;
  }
  const unreadable = (): { reason: string } => ({
    reason:
      r !== undefined && r.stdout === "" && r.stderr.includes("ENOENT")
        ? `${a.cli} not found`
        : "could not read the model list",
  });
  if (r === undefined || r.code !== 0 || r.killed) return unreadable();
  if (a.cli === "codex") {
    const catalog = parseCodexCatalog(r.stdout);
    if (catalog.length === 0) return unreadable();
    return { check: checkCodexChoice(a.model, a.effort, catalog) };
  }
  const ids = parseOpencodeModels(r.stdout);
  if (ids.length === 0) return unreadable();
  return { check: checkOpencodeChoice(a.model, a.effort, ids) };
}

type Change = Exclude<JevArgs, { kind: "status" | "usage" | "slot" | "tune" }>;

function applyChange(
  parsed: Change,
  dir: string,
  cliReview: { model?: string; effort?: string } | undefined,
): ReturnType<typeof updateState> {
  switch (parsed.kind) {
    case "reset":
      return resetState(dir);
    case "mode":
      return updateState(dir, (st) => ({ ...st, mode: parsed.mode }));
    case "cli-review":
      return updateState(dir, (st) => ({
        ...st,
        cliReview: {
          cli: parsed.cli,
          ...(cliReview?.model ? { model: cliReview.model } : {}),
          ...(cliReview?.effort ? { effort: cliReview.effort } : {}),
        },
      }));
    case "set":
    case "all":
      return updateState(dir, (st) => {
        const features = parsed.kind === "all" ? DECISION_FEATURES : [parsed.feature];
        const switches = { ...st.switches };
        for (const f of features) switches[f] = parsed.on;
        return { ...st, switches };
      });
  }
}

export async function runJev(
  args: string,
  ctx: ExtensionCommandContext,
  deps: {
    dir: string;
    load: () => Snapshot;
    decision: () => Decision | undefined;
    exec: Exec;
    tally?: () => Tally;
    window?: () => readonly WindowEntry[];
    overlay?: () => string | undefined;
    tune?: (sub: TuneSub, ctx: UiCtx) => TuneOutcome;
  },
): Promise<void> {
  try {
    if (isChild(ctx.sessionManager.getSessionId())) return;
    const notify = (message: string, type: "info" | "warning" | "error"): void => {
      if (ctx.hasUI) ctx.ui.notify(message, type);
    };
    const parsed = parseJevArgs(args);
    if (parsed.kind === "usage") {
      notify(usageText(), "warning");
      return;
    }
    if (parsed.kind === "tune") {
      if (deps.tune === undefined) {
        notify(usageText(), "warning");
        return;
      }
      const out = deps.tune(parsed.sub, ctx);
      notify(out.message, out.ok ? "info" : "error");
      return;
    }
    if (parsed.kind === "slot") {
      const out = runSlot(parsed.args, ctx.modelRegistry, deps.dir);
      if (out.ok) notify(out.message, "info");
      else notify(out.usage ? `${out.message}\n${usageText()}` : out.message, "error");
      return;
    }
    let cliReview: { model?: string; effort?: string } | undefined;
    if (parsed.kind === "cli-review") {
      const stateIssues = validateCliReview({
        cli: parsed.cli,
        ...(parsed.model === undefined ? {} : { model: parsed.model }),
        ...(parsed.effort === undefined ? {} : { effort: parsed.effort }),
      });
      if (stateIssues.length > 0) {
        notify(stateIssues.map((i) => `${i.path}: ${i.message}`).join("\n"), "error");
        return;
      }
      cliReview = { model: parsed.model, effort: parsed.effort };
      // A list is read only when a model is given, or to refuse an OpenCode effort with no model.
      if (
        parsed.model !== undefined ||
        (parsed.cli === "opencode" && parsed.effort !== undefined)
      ) {
        const outcome =
          parsed.model === undefined
            ? { check: checkOpencodeChoice(undefined, parsed.effort, []) }
            : await checkAgainstCli(parsed, deps.exec);
        if ("reason" in outcome) {
          notify(`CLI review model not checked: ${outcome.reason}.`, "warning");
        } else if (!outcome.check.ok) {
          const { message, suggestions } = outcome.check;
          notify(
            suggestions.length > 0 ? `${message}\nTry: ${suggestions.join(", ")}` : message,
            "error",
          );
          return;
        } else {
          cliReview = { model: outcome.check.model, effort: outcome.check.effort };
        }
      }
    }
    if (parsed.kind !== "status") {
      const result = applyChange(parsed, deps.dir, cliReview);
      if (!result.ok) {
        notify(
          result.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("\n"),
          "error",
        );
        return;
      }
    }
    const snapshot = deps.load();
    drawStatus(ctx, snapshot, deps.decision(), deps.overlay?.());
    notify(formatStatus(snapshot, deps.tally?.() ?? EMPTY_TALLY, deps.window?.()), "info");
  } catch (err) {
    try {
      if (ctx.hasUI) ctx.ui.notify(`/jev failed: ${describeError(err)}`, "error");
    } catch {
      /* swallow: command failures stay inside the package */
    }
  }
}
