import { describe, expect, it } from "vitest";
import { formatRunFacts, runFactParts, runFactsOf } from "#src/ui/run-facts";

describe("runFactParts", () => {
  it("all facts known", () => {
    expect(
      runFactParts({
        model: "anthropic/claude-haiku-4-5",
        thinking: "high",
        toolCount: 12,
        blockedToolCount: 3,
      }),
    ).toEqual(["anthropic/claude-haiku-4-5", "thinking: high", "🔧12", "⊘3"]);
  });

  it("nothing blocked", () => {
    const facts = { toolCount: 5, blockedToolCount: 0 };
    expect(runFactParts(facts).some((part) => part.startsWith("⊘"))).toBe(false);
    expect(formatRunFacts(facts).blocked).toBeUndefined();
  });

  it("unknown facts", () => {
    expect(runFactParts({ model: "a/b" })).toEqual(["a/b"]);
    expect(runFactParts({})).toEqual([]);
  });
});

describe("runFactsOf", () => {
  it("reads a record", () => {
    expect(
      runFactsOf({
        model: { provider: "a", id: "b" },
        thinkingLevel: "low",
        toolFacts: { toolCount: 4, blockedToolCount: 1 },
      }),
    ).toEqual({ model: "a/b", thinking: "low", toolCount: 4, blockedToolCount: 1 });
    expect(runFactsOf({})).toEqual({});
  });
});
