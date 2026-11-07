// Pure strategy advice gates and block text. Imports nothing outside src/policy/.

export type Strategy = "direct" | "delegate" | "parallel" | "graph";
type Advised = Exclude<Strategy, "direct">;

export const STRATEGIES: readonly Strategy[] = ["direct", "delegate", "parallel", "graph"];

/** Minimum probability of `delegate` and `parallel` for advice. */
export const STRATEGY_THRESHOLD = 0.6;
/** Minimum probability of `graph` for advice. */
export const GRAPH_THRESHOLD = 0.8;

export type AdviceInput = {
  strategy?: { choice: string; probabilities: Record<string, number> };
  tier?: string;
};

export type Advice =
  | { strategy: Strategy; strategyP: number; advised: boolean; block?: string }
  | undefined;

/** The `<how>` text per strategy, copied verbatim from docs/jev-questions.md. */
const HOW: Record<Advised, string> = {
  delegate:
    "Send the broad, mechanical part (searching or reading across many files) to one subagent with a self-contained brief and a request for a short report, then do the rest here. Keep small lookups here: a subagent costs a fresh context.",
  parallel:
    "Fan out, then join. Split the work into independent pieces that share no files, and start one subagent per piece in a single message, in the background, so they run at the same time. Give each a self-contained brief naming its files and how to check its piece. Then join here: read their reports, integrate, and run the tests once. Two pieces that touch the same file are one piece.",
  graph: [
    "Split the work into nodes, one subagent per independent part (a step you could do inline is not a node).",
    "Nodes with no dependency between them start together, in one message, in the background; a dependent wave starts after its inputs join here.",
    "Keep a plan file only if there are more than two waves. After the final join, one read-only reviewer checks the result against the tests; a failed node is redone alone.",
    "At most 4 subagents at a time. If it cannot be explained in one breath, work directly.",
  ].join("\n"),
};

/** The `<execution_strategy>` block added to the model's context. */
export function strategyBlock(s: Advised): string {
  return [
    "<execution_strategy>",
    `A fast decision model read this request as best carried out as: ${s}.`,
    HOW[s],
    "It saw only the request and a few recent messages, not the code. If the actual work does not fit, ignore this and work directly.",
    "</execution_strategy>",
  ].join("\n");
}

function isStrategy(value: string): value is Strategy {
  return (STRATEGIES as readonly string[]).includes(value);
}

/** Whether the chosen strategy passes its probability and tier gate. */
function passes(choice: Advised, p: number, tier: string | undefined): boolean {
  if (choice === "delegate") return p >= STRATEGY_THRESHOLD;
  if (choice === "parallel")
    return p >= STRATEGY_THRESHOLD && tier !== undefined && tier !== "fast";
  return p >= GRAPH_THRESHOLD && tier === "deep";
}

/** Gates the strategy answer. `undefined` when `strategy` is unanswered or unknown. */
export function adviseStrategy(input: AdviceInput): Advice {
  const answer = input.strategy;
  if (answer === undefined || !isStrategy(answer.choice)) return undefined;
  const choice = answer.choice;
  const strategyP = answer.probabilities[choice] ?? 0;
  if (choice === "direct" || !passes(choice, strategyP, input.tier)) {
    return { strategy: choice, strategyP, advised: false };
  }
  return { strategy: choice, strategyP, advised: true, block: strategyBlock(choice) };
}
