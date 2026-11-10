import type { BeforeAgentStartEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { isChild } from "../platform/index.ts";
import { loadSnapshot, type Snapshot } from "../platform/index.ts";
import { effectiveChoice, type Exec, type ReviewChoice } from "../../policy/review/index.ts";
import { runReview } from "./run.ts";

export { runReview, type ReviewRun } from "./run.ts";

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

export const REVIEW_OFF_MESSAGE = "jev_review is off. Turn it on with /jev cli-review on.";

/**
 * Registers the `jev_review` tool. It needs no key; `execute` refuses while the
 * review setting is off (or unreadable), and `syncReviewTool` hides it from the loadout.
 */
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
    async execute(...args) {
      const [, params, signal, , ctx] = args;
      try {
        if (isChild(ctx.sessionManager.getSessionId())) {
          return failure("jev_review is not available in a subagent session.");
        }
        let review: Snapshot["settings"]["review"];
        try {
          review = load().settings.review;
        } catch {
          return failure(REVIEW_OFF_MESSAGE);
        }
        if (!review.enabled) return failure(REVIEW_OFF_MESSAGE);
        const defaults: ReviewChoice = { cli: review.cli };
        if (review.model !== undefined) defaults.model = review.model;
        if (review.effort !== undefined) defaults.effort = review.effort;
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

/** Adds or removes `jev_review` in the live loadout to match the setting. Never throws. */
export function syncReviewTool(
  pi: Pick<ExtensionAPI, "getActiveTools" | "setActiveTools" | "getAllTools">,
  enabled: boolean,
): void {
  try {
    const active = pi.getActiveTools();
    const present = active.includes(REVIEW_TOOL);
    if (!enabled && present) {
      pi.setActiveTools(active.filter((n) => n !== REVIEW_TOOL));
    } else if (enabled && !present && pi.getAllTools().some((t) => t.name === REVIEW_TOOL)) {
      pi.setActiveTools([...active, REVIEW_TOOL]);
    }
  } catch {
    /* the turn proceeds with the loadout as it is */
  }
}
