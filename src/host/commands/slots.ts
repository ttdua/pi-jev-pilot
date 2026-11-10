// The `/jev` slot forms: add or replace, show and remove a custom model slot.
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { readConfig, writeSlots, type Slot } from "../../store/config.ts";
import { RESERVED_SLOT_NAMES } from "../../store/defaults.ts";
import type { Issue } from "../../store/validate.ts";
import { checkModel, nearestModels, splitModel } from "../platform/index.ts";

export type SlotArgs =
  | { kind: "set"; name: string; model: string; when?: string }
  | { kind: "show"; name: string }
  | { kind: "remove"; name: string };

export type SlotOutcome =
  | { ok: true; message: string }
  | { ok: false; message: string; usage?: true };

const NAME = /^[a-z][a-z0-9-]{0,23}$/;
const SET_FORM = /^(\S+)\s+(\S+)(?:\s+when\s+(\S[\s\S]*))?$/;

const NEEDS_WHEN =
  "a new slot needs when: say what Jev should choose the slot for, and what not.\n" +
  "  /jev <slot> <provider/model> when Choose for code reviews. Not for fixing.";

function isSlotName(word: string): boolean {
  return NAME.test(word) && !RESERVED_SLOT_NAMES.includes(word);
}

function parseRemove(text: string): SlotArgs | "usage" {
  const words = text.split(/\s+/);
  const name = words[1];
  return words.length === 2 && name !== undefined && isSlotName(name)
    ? { kind: "remove", name }
    : "usage";
}

/**
 * `undefined` means the text is not a slot form (the caller's other parsers decide);
 * `"usage"` means it is meant as one but is malformed.
 */
export function parseSlotArgs(text: string): SlotArgs | "usage" | undefined {
  const trimmed = text.trim();
  const head = trimmed.split(/\s+/)[0] ?? "";
  if (head === "remove") return parseRemove(trimmed);
  if (!isSlotName(head)) return undefined;
  if (trimmed === head) return { kind: "show", name: head };
  const match = SET_FORM.exec(trimmed);
  if (match === null) return "usage";
  const [, name, model, when] = match;
  return when === undefined
    ? { kind: "set", name: name!, model: model! }
    : { kind: "set", name: name!, model: model!, when: when.trim() };
}

function refuse(message: string, usage = false): SlotOutcome {
  return usage ? { ok: false, message, usage: true } : { ok: false, message };
}

function issueMessage(issues: readonly Issue[]): string {
  return issues.map((i) => `${i.path === "" ? "(file)" : i.path}: ${i.message}`).join("\n");
}

function report(slot: Slot): string {
  return `slot ${slot.name}: ${slot.model}\nwhen: ${slot.when}`;
}

function modelRefusal(registry: ModelRegistry, model: string): SlotOutcome | undefined {
  const check = checkModel(registry, model);
  if (check.ok) return undefined;
  const base = `${model}: ${check.why}`;
  if (check.why === "not a provider/model") return refuse(base, true);
  const near = nearestModels(registry, model, 3);
  return refuse(near.length > 0 ? `${base}\nTry: ${near.join(", ")}` : base);
}

/** What a slot form works against: the stored slots and where they are written. */
type SlotStore = {
  existing: Slot | undefined;
  slots: readonly Slot[];
  registry: ModelRegistry;
  dir: string;
};

function runSet(args: Extract<SlotArgs, { kind: "set" }>, store: SlotStore): SlotOutcome {
  const { existing, slots, registry, dir } = store;
  if (splitModel(args.model) === undefined) {
    return refuse(`${args.model}: not a provider/model`, true);
  }
  const when = args.when ?? existing?.when;
  if (when === undefined) return refuse(NEEDS_WHEN);
  const refusal = modelRefusal(registry, args.model);
  if (refusal !== undefined) return refusal;

  const next: Slot = { name: args.name, model: args.model, when };
  const list =
    existing === undefined ? [...slots, next] : slots.map((s) => (s === existing ? next : s));
  const written = writeSlots(dir, list);
  return written.ok ? { ok: true, message: report(next) } : refuse(issueMessage(written.issues));
}

function runRemove(name: string, slots: readonly Slot[], dir: string): SlotOutcome {
  const written = writeSlots(
    dir,
    slots.filter((s) => s.name !== name),
  );
  return written.ok
    ? { ok: true, message: `slot ${name} removed` }
    : refuse(issueMessage(written.issues));
}

export function runSlot(args: SlotArgs, registry: ModelRegistry, dir: string): SlotOutcome {
  const read = readConfig(dir);
  if (read.kind === "invalid") return refuse(issueMessage(read.issues));
  const slots = read.config.crew?.slots ?? [];
  const existing = slots.find((s) => s.name === args.name);
  if (args.kind === "set") return runSet(args, { existing, slots, registry, dir });
  if (existing === undefined) return refuse(`no slot named ${args.name}`, true);
  return args.kind === "show"
    ? { ok: true, message: report(existing) }
    : runRemove(args.name, slots, dir);
}
