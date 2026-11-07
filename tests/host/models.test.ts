import { describe, expect, test } from "bun:test";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

import { checkModel, nearestModels, resolveModel, splitModel } from "../../src/host/models.ts";

type FakeModel = { provider: string; id: string; reasoning: boolean; thinkingLevelMap?: undefined };

function fake(ids: string[], keyless: string[] = []): ModelRegistry {
  const models: FakeModel[] = ids.map((full) => {
    const [provider, ...rest] = full.split("/");
    return { provider: provider ?? "", id: rest.join("/"), reasoning: true };
  });
  const key = (m: FakeModel): string => `${m.provider}/${m.id}`;
  return {
    find: (p: string, id: string) => models.find((m) => m.provider === p && m.id === id),
    hasConfiguredAuth: (m: FakeModel) => !keyless.includes(key(m)),
    getAvailable: () => models.filter((m) => !keyless.includes(key(m))),
  } as unknown as ModelRegistry;
}

describe("splitModel", () => {
  test("Nested provider id", () => {
    expect(splitModel("9router/openai/gpt-6")).toEqual(["9router", "openai/gpt-6"]);
  });
  test("Malformed", () => {
    expect(splitModel("x")).toBeUndefined();
    expect(splitModel("/x")).toBeUndefined();
    expect(splitModel("x/")).toBeUndefined();
  });
});

describe("checkModel", () => {
  const reg = fake(["fixture/a", "fixture2/k"], ["fixture2/k"]);
  test("not a provider/model", () => {
    expect(checkModel(reg, "x")).toEqual({ ok: false, why: "not a provider/model" });
  });
  test("not in the registry", () => {
    expect(checkModel(reg, "fixture/zzz")).toEqual({ ok: false, why: "not in the model registry" });
  });
  test("no credentials", () => {
    expect(checkModel(reg, "fixture2/k")).toEqual({ ok: false, why: "no credentials" });
  });
  test("ok with thinking", () => {
    expect(checkModel(reg, "fixture/a")).toEqual({
      ok: true,
      thinking: { reasoning: true, thinkingLevelMap: undefined },
    });
  });
});

describe("nearestModels", () => {
  test("Typo suggests the right model", () => {
    const reg = fake(["fixture/fixture-review", "fixture/fixture-a", "fixture/other", "x/y"]);
    const out = nearestModels(reg, "fixture/fixture-reviw");
    expect(out[0]).toBe("fixture/fixture-review");
    expect(out.length).toBeLessThanOrEqual(3);
  });
  test("Keyless model not suggested", () => {
    const reg = fake(
      ["fixture/a", "fixture2/fixture-review-keyless"],
      ["fixture2/fixture-review-keyless"],
    );
    expect(nearestModels(reg, "fixture2/fixture-review-keyles")).toEqual(["fixture/a"]);
  });
  test("No usable model at all", () => {
    expect(nearestModels(fake(["a/b"], ["a/b"]), "a/c")).toEqual([]);
  });
  test("Case-insensitive ranking", () => {
    const reg = fake(["P/Model-One", "p/zzzzzzzzzz"]);
    expect(nearestModels(reg, "p/model-one", 1)).toEqual(["P/Model-One"]);
  });
  test("Alphabetic tie-break", () => {
    const reg = fake(["p/b", "p/a", "p/c"]);
    expect(nearestModels(reg, "p/z", 3)).toEqual(["p/a", "p/b", "p/c"]);
  });
});

describe("resolveModel", () => {
  test("tier", () => {
    expect(resolveModel("deep", { deep: "a/b" }, [])).toBe("a/b");
  });
  test("slot", () => {
    expect(resolveModel("slot::r", {}, [{ name: "r", model: "c/d", when: "x" }])).toBe("c/d");
  });
  test("unknown slot", () => {
    expect(resolveModel("slot::q", {}, [])).toBeUndefined();
  });
});
