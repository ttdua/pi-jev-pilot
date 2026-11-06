import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BeforeAgentStartEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { isChild } from "./child.ts";
import { loadSnapshot, type Snapshot } from "./readiness.ts";
import {
  buildPrompt,
  classifyAttempt,
  codexArgs,
  effectiveChoice,
  formatFailure,
  formatSuccess,
  isTier,
  opencodeArgs,
  parseCodexCatalog,
  resolveTier,
  type Exec,
  type ExecResult,
  type ReviewChoice,
  type ReviewDetails,
} from "./review-cli.ts";

export type ReviewRun = { text: string; isError: boolean; details: ReviewDetails };

const ATTEMPT_TIMEOUT_MS = 600_000;
const CATALOG_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 8 * 1024 * 1024;

/** Newest slug for a tier, or the stored model when the catalog cannot answer. */
async function resolveModel(
  exec: Exec,
  model: string | undefined,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  if (model === undefined || !isTier(model)) return model;
  try {
    const r = await exec("codex", ["debug", "models"], {
      cwd,
      timeout: CATALOG_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
      maxBuffer: MAX_BUFFER,
    });
    if (r.code !== 0 || r.killed) return model;
    return resolveTier(model, parseCodexCatalog(r.stdout)) ?? model;
  } catch {
    return model;
  }
}

function readOut(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** Runs one review. Never throws; the brief and output stay out of `details`. */
export async function runReview(
  exec: Exec,
  input: { choice: ReviewChoice; brief: string; cwd: string; signal?: AbortSignal },
): Promise<ReviewRun> {
  const { choice, brief, cwd, signal } = input;
  const cli = choice.cli;
  const base = (outcome: ReviewDetails["outcome"], attempts: 1 | 2, used: ReviewChoice) => {
    const d: ReviewDetails = { cli, attempts, outcome };
    if (used.model !== undefined) d.model = used.model;
    if (used.effort !== undefined) d.effort = used.effort;
    return d;
  };
  const failed = (
    outcome: ReviewDetails["outcome"],
    attempts: 1 | 2,
    used: ReviewChoice,
    r?: ExecResult,
    errorName?: string,
  ): ReviewRun => {
    const details = base(outcome, attempts, used);
    if (outcome === "exit-error" && r) details.exitCode = r.code;
    return { text: formatFailure(cli, outcome, r, errorName), isError: true, details };
  };

  let dir: string | undefined;
  try {
    if (signal?.aborted) return failed("cancelled", 1, choice);

    let used = choice;
    if (cli === "codex") {
      const model = await resolveModel(exec, choice.model, cwd, signal);
      if (model !== choice.model && model !== undefined) used = { ...choice, model };
      if (signal?.aborted) return failed("cancelled", 1, used);
      dir = mkdtempSync(join(tmpdir(), "jev-review-"));
      chmodSync(dir, 0o700);
    }
    const out = dir === undefined ? undefined : join(dir, "last-message.txt");
    const prompt = buildPrompt(brief);
    const [command, args] =
      cli === "codex"
        ? ["codex", codexArgs({ ...used, cwd, out: out!, prompt })]
        : ["opencode", opencodeArgs({ ...used, prompt })];

    let attempts: 1 | 2 = 1;
    for (;;) {
      if (out !== undefined) rmSync(out, { force: true });
      let r: ExecResult;
      try {
        r = await exec(command!, args as string[], {
          cwd,
          timeout: ATTEMPT_TIMEOUT_MS,
          ...(signal ? { signal } : {}),
          maxBuffer: MAX_BUFFER,
        });
      } catch (e) {
        if (signal?.aborted) return failed("cancelled", attempts, used);
        return failed(
          "exec-error",
          attempts,
          used,
          undefined,
          e instanceof Error ? e.name : "Error",
        );
      }
      const outcome = classifyAttempt(r, signal?.aborted === true);
      if (outcome === "timeout" && attempts === 1) {
        attempts = 2;
        continue;
      }
      if (outcome !== "ok") return failed(outcome, attempts, used, r);
      const fromFile = out === undefined ? "" : readOut(out);
      const output = fromFile.trim() !== "" ? fromFile : r.stdout;
      const details = base("ok", attempts, used);
      details.exitCode = r.code;
      return { text: formatSuccess(used, output), isError: false, details };
    }
  } catch (e) {
    return failed("exec-error", 1, choice, undefined, e instanceof Error ? e.name : "Error");
  } finally {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
}

export const REVIEW_TOOL = "jev_review";

const MODEL_PATTERN = "^[A-Za-z0-9._][A-Za-z0-9._:/-]{0,127}$";
const EFFORT_PATTERN = "^[A-Za-z0-9._-]{1,64}$";

const reviewParameters = Type.Object({
  brief: Type.String({
    minLength: 1,
    maxLength: 20000,
    description: "What changed and what the reviewer should check.",
  }),
  reviewer: Type.Optional(
    Type.Union([Type.Literal("codex"), Type.Literal("opencode")], {
      description: "Which CLI reviews. Omit unless the user named one.",
    }),
  ),
  model: Type.Optional(
    Type.String({
      pattern: MODEL_PATTERN,
      description: "Model for the reviewer. Omit unless the user named one.",
    }),
  ),
  effort: Type.Optional(
    Type.String({
      pattern: EFFORT_PATTERN,
      description: "Effort for the reviewer. Omit unless the user named one.",
    }),
  ),
});

const failure = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: undefined,
  isError: true as const,
});

/** Registers the `jev_review` tool. It needs no key and no feature switch. */
export function registerReviewTool(
  pi: Pick<ExtensionAPI, "registerTool" | "exec" | "getAllTools">,
  deps: { load?: () => Snapshot; exec?: Exec } = {},
): void {
  const exec: Exec = deps.exec ?? ((c, a, o) => pi.exec(c, a, o));
  const load = deps.load ?? (() => loadSnapshot(pi));
  pi.registerTool({
    name: REVIEW_TOOL,
    label: "Jev review",
    description:
      "Ask the Codex or OpenCode CLI for a read-only code review of the current working tree. Pass what changed and what to check as `brief`. Returns the reviewer's findings.",
    promptSnippet: "Get a code review from the Codex or OpenCode CLI",
    promptGuidelines: [
      "Use jev_review only when the user asks for a review by Codex or OpenCode, passing what changed and what to check as `brief`; omit `reviewer`, `model` and `effort` unless the user named them.",
    ],
    parameters: reviewParameters,
    async execute(_id, params, signal, _onUpdate, ctx) {
      try {
        if (isChild(ctx.sessionManager.getSessionId())) {
          return failure("jev_review is not available in a subagent session.");
        }
        let defaults: ReviewChoice = { cli: "codex" };
        try {
          defaults = load().settings.review;
        } catch {
          /* fall back to codex */
        }
        const choice = effectiveChoice(defaults, params);
        const r = await runReview(exec, {
          choice,
          brief: params.brief,
          cwd: ctx.cwd,
          ...(signal ? { signal } : {}),
        });
        return {
          content: [{ type: "text" as const, text: r.text }],
          details: r.details,
          ...(r.isError ? { isError: true as const } : {}),
        };
      } catch (e) {
        return failure(`The review did not run: ${e instanceof Error ? e.name : "Error"}.`);
      }
    },
  });
}

/** Removes the review tool from a child's tool list for this turn. */
export function hideReviewInChild(event: BeforeAgentStartEvent, sessionId: string): void {
  if (!isChild(sessionId)) return;
  const tools = event.systemPromptOptions?.selectedTools;
  if (!Array.isArray(tools)) return;
  for (let i = tools.length - 1; i >= 0; i--) if (tools[i] === REVIEW_TOOL) tools.splice(i, 1);
}
