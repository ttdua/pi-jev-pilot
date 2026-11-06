import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DECISION_FEATURES, FEATURES, type Feature } from "../store/defaults.ts";
import { resetState, updateState } from "../store/state-file.ts";
import type { Issue } from "../store/validate.ts";
import { isChild } from "./child.ts";
import type { Exec } from "./review-cli.ts";
import type { Snapshot } from "./readiness.ts";
import { drawStatus, statusText } from "./status.ts";

export type JevArgs =
  | { kind: "status" }
  | { kind: "set"; feature: Feature; on: boolean }
  | { kind: "all"; on: boolean }
  | { kind: "reset" }
  | { kind: "cli-review"; cli: "codex" | "opencode"; model?: string; effort?: string }
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

/** Split on whitespace and match case-sensitively; only an empty argument is the status form. */
export function parseJevArgs(text: string): JevArgs {
  const words = text.trim() === "" ? [] : text.trim().split(/\s+/);
  if (words.length === 0) return { kind: "status" };
  if (words[0] === "cli-review") return parseCliReview(words);
  const [head, value, ...rest] = words;
  if (words.length === 1) return head === "reset" ? { kind: "reset" } : USAGE;
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
    "  /jev reset                reset switches, mode and CLI review default",
    "  /jev cli-review <codex|opencode> [model|default] [effort|default]",
  ].join("\n");
}

function issueLines(label: string, issues: Issue[]): string[] {
  return issues.map((i) => `  ${label} ${i.path === "" ? "(file)" : i.path}: ${i.message}`);
}

function reviewLine(r: Snapshot["settings"]["review"]): string {
  const parts = [
    ...(r.model ? [`model ${r.model}`] : []),
    ...(r.effort ? [`effort ${r.effort}`] : []),
  ];
  return `cli review: ${r.cli} (${parts.length > 0 ? parts.join(", ") : "CLI defaults"})`;
}

export function formatStatus(s: Snapshot): string {
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
  if (problems.length > 0) lines.push("problems:", ...problems);
  return lines.join("\n");
}

function describeError(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string") return code;
  return err instanceof Error ? err.constructor.name : "UnknownError";
}

export async function runJev(
  args: string,
  ctx: ExtensionCommandContext,
  deps: { dir: string; load: () => Snapshot; exec: Exec },
): Promise<void> {
  try {
    if (isChild(ctx.sessionManager.getSessionId())) return;
    const notify = (message: string, type: "info" | "warning" | "error"): void => {
      if (ctx.hasUI) ctx.ui.notify(message, type);
    };
    const parsed = parseJevArgs(args);
    if (parsed.kind === "usage" || parsed.kind === "cli-review") {
      notify(usageText(), "warning");
      return;
    }
    if (parsed.kind !== "status") {
      const result =
        parsed.kind === "reset"
          ? resetState(deps.dir)
          : updateState(deps.dir, (st) => {
              const features = parsed.kind === "all" ? DECISION_FEATURES : [parsed.feature];
              const switches = { ...st.switches };
              for (const f of features) switches[f] = parsed.on;
              return { ...st, switches };
            });
      if (!result.ok) {
        notify(
          result.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("\n"),
          "error",
        );
        return;
      }
    }
    const snapshot = deps.load();
    drawStatus(ctx, snapshot);
    notify(formatStatus(snapshot), "info");
  } catch (err) {
    try {
      if (ctx.hasUI) ctx.ui.notify(`/jev failed: ${describeError(err)}`, "error");
    } catch {
      /* swallow: command failures stay inside the package */
    }
  }
}
