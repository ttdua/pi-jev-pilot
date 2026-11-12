/**
 * run-facts.ts — the one formatter for a subagent's run facts (model, thinking,
 * tool counts), shared by every surface that shows them.
 */
import type { ThinkingLevel } from "#src/types";
import { formatModel, type ModelIdentity } from "#src/ui/display";
import { GLYPHS } from "#src/ui/glyphs";

/** The run facts a row can show; each is absent until known. */
export interface RunFacts {
  readonly model?: string;
  readonly thinking?: ThinkingLevel;
  readonly toolCount?: number;
  readonly blockedToolCount?: number;
}

/** Structural source of run facts; a `Subagent` satisfies it. */
export interface RunFactsSource {
  readonly model?: ModelIdentity;
  readonly thinkingLevel?: ThinkingLevel;
  readonly toolFacts?: { readonly toolCount: number; readonly blockedToolCount: number };
}

/** Each fact rendered as its display part; absent facts are undefined. */
export interface RunFactParts {
  readonly model?: string;
  readonly thinking?: string;
  readonly tools?: string;
  readonly blocked?: string;
}

/** Read the known facts off a source, omitting unknown ones. */
export function runFactsOf(source: RunFactsSource): RunFacts {
  return {
    ...(source.model && { model: formatModel(source.model) }),
    ...(source.thinkingLevel && { thinking: source.thinkingLevel }),
    ...(source.toolFacts && {
      toolCount: source.toolFacts.toolCount,
      blockedToolCount: source.toolFacts.blockedToolCount,
    }),
  };
}

/** Render each known fact; blocked tools show only when there are some. */
export function formatRunFacts(facts: RunFacts): RunFactParts {
  return {
    model: facts.model,
    thinking: facts.thinking === undefined ? undefined : `thinking: ${facts.thinking}`,
    tools: facts.toolCount === undefined ? undefined : `${GLYPHS.tools}${facts.toolCount}`,
    blocked: facts.blockedToolCount ? `${GLYPHS.blocked}${facts.blockedToolCount}` : undefined,
  };
}

/** The display parts in order (model, thinking, tools, blocked), absent ones omitted. */
export function runFactParts(facts: RunFacts): string[] {
  const parts = formatRunFacts(facts);
  return [parts.model, parts.thinking, parts.tools, parts.blocked].filter(
    (part): part is string => part !== undefined,
  );
}
