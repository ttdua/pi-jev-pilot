import { describe, expect, test } from "bun:test";
import { LaunchWarnings, warningText } from "../../../src/host/worker/warnings.ts";

const target = { target: "deep", model: "fx/deep", why: "no credentials" } as const;

describe("warningText", () => {
  test("names the tier, model, cause, the tier used instead and where to fix it", () => {
    const text = warningText({ ...target, to: "balanced" }, "/agent/jev/config.json");
    expect(text).toBe(
      "Jev: tier deep (fx/deep) cannot run (no credentials); using balanced. Fix tiers.deep in /agent/jev/config.json.",
    );
  });

  test("names a slot and says the launch was left unchanged when nothing replaced it", () => {
    const text = warningText(
      { target: "slot::review", model: "fx/r", why: "unknown model", to: undefined },
      "/c.json",
    );
    expect(text).toBe(
      'Jev: slot review (fx/r) cannot run (unknown model); launch left unchanged. Fix crew.slots "review" model in /c.json.',
    );
  });
});

describe("LaunchWarnings", () => {
  const ui = () => {
    const shown: string[] = [];
    return { shown, notify: (text: string) => void shown.push(text) };
  };

  test("shows a target and model once until cleared", () => {
    const warnings = new LaunchWarnings(() => "/c.json");
    const sink = ui();

    warnings.show(sink, { ...target, to: undefined });
    warnings.show(sink, { ...target, to: "balanced" });
    warnings.clear();
    warnings.show(sink, { ...target, to: undefined });

    expect(sink.shown).toHaveLength(2);
  });

  test("shows the same target again for another model", () => {
    const warnings = new LaunchWarnings(() => "/c.json");
    const sink = ui();

    warnings.show(sink, { ...target, to: undefined });
    warnings.show(sink, { ...target, model: "fx/deep2", to: undefined });

    expect(sink.shown).toHaveLength(2);
  });
});
