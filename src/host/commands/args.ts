// The `/jev` argument grammar: one parser per sub-command, tried in a fixed order.
import { FEATURES, MODES, type Feature, type Mode } from "../../store/defaults.ts";
import type { TuneSub } from "../tuning/index.ts";
import { parseSlotArgs, type SlotArgs } from "./slots.ts";

export type JevArgs =
  | { kind: "status" }
  | { kind: "set"; feature: Feature; on: boolean }
  | { kind: "all"; on: boolean }
  | { kind: "mode"; mode: Mode; target: "local" | "global" }
  | { kind: "mode-clear" }
  | { kind: "reset" }
  | { kind: "cli-review-switch"; on: boolean }
  | { kind: "cli-review"; cli: "codex" | "opencode"; model?: string; effort?: string }
  | { kind: "slot"; args: SlotArgs }
  | { kind: "tune"; sub: TuneSub }
  | { kind: "usage" };

const USAGE: JevArgs = { kind: "usage" };

function parseCliReview(words: string[]): JevArgs {
  const [, cli, model, effort] = words;
  if (words.length === 2 && (cli === "on" || cli === "off")) {
    return { kind: "cli-review-switch", on: cli === "on" };
  }
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

const isMode = (w: string | undefined): w is Mode => (MODES as readonly string[]).includes(w!);

/** `mode <m> [global]` or `mode clear`; `value` and `rest` follow `mode`. */
function parseMode(value: string, rest: string[]): JevArgs {
  if (value === "clear") return rest.length === 0 ? { kind: "mode-clear" } : USAGE;
  if (!isMode(value) || rest.length > 1) return USAGE;
  if (rest.length === 0) return { kind: "mode", mode: value, target: "local" };
  return rest[0] === "global" ? { kind: "mode", mode: value, target: "global" } : USAGE;
}

/** `all on|off` or `<feature> on|off`. */
function parseSwitch(head: string, value: string | undefined, rest: string[]): JevArgs {
  if (rest.length > 0 || (value !== "on" && value !== "off")) return USAGE;
  const on = value === "on";
  if (head === "all") return { kind: "all", on };
  if ((FEATURES as readonly string[]).includes(head)) {
    return { kind: "set", feature: head as Feature, on };
  }
  return USAGE;
}

/** The forms that are neither `cli-review`, `tune` nor a slot. */
function parsePlain(words: string[]): JevArgs {
  const [head, value, ...rest] = words;
  if (words.length === 1) return head === "reset" ? { kind: "reset" } : USAGE;
  if (head === "mode") return parseMode(value!, rest);
  return parseSwitch(head!, value, rest);
}

/** Split on whitespace and match case-sensitively; only an empty argument is the status form. */
export function parseJevArgs(text: string): JevArgs {
  const words = text.trim() === "" ? [] : text.trim().split(/\s+/);
  if (words.length === 0) return { kind: "status" };
  if (words[0] === "cli-review") return parseCliReview(words);
  if (words[0] === "tune") return parseTune(words);
  const slot = parseSlotArgs(text);
  if (slot !== undefined) return slot === "usage" ? USAGE : { kind: "slot", args: slot };
  return parsePlain(words);
}
