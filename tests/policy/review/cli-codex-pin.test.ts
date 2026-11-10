import { describe, expect, test } from "bun:test";

import {
  checkCodexChoice,
  parseCodexCatalog,
  type CodexModel,
} from "../../../src/policy/review/cli.ts";

const wrap = (models: unknown) => JSON.stringify({ models });

describe("parseCodexCatalog (pin)", () => {
  test("unreadable input gives []", () => {
    for (const s of [
      "",
      "banner\n{",
      "null",
      "[]",
      "5",
      '"x"',
      "{}",
      '{"models":{}}',
      '{"models":"a"}',
    ]) {
      expect(parseCodexCatalog(s)).toEqual([]);
    }
  });

  test("entries that are not records or lack a slug are skipped", () => {
    const raw = [
      null,
      5,
      "slug",
      [],
      {},
      { slug: "" },
      { slug: 3 },
      { slug: null },
      { slug: "ok" },
    ];
    expect(parseCodexCatalog(wrap(raw))).toEqual([{ slug: "ok", name: "ok", efforts: [] }]);
  });

  test("visibility: absent or list is kept; anything else is dropped", () => {
    const raw = [
      { slug: "a" },
      { slug: "b", visibility: "list" },
      { slug: "c", visibility: "hide" },
      { slug: "d", visibility: null },
      { slug: "e", visibility: "" },
      { slug: "f", visibility: 1 },
      { slug: "g", visibility: "List" },
    ];
    expect(parseCodexCatalog(wrap(raw)).map((m) => m.slug)).toEqual(["a", "b"]);
  });

  test("name: non-empty string display_name else slug", () => {
    const raw = [
      { slug: "a", display_name: "Alpha" },
      { slug: "b", display_name: "" },
      { slug: "c", display_name: 5 },
      { slug: "d", display_name: null },
      { slug: "e" },
      { slug: "f", display_name: " " },
    ];
    expect(parseCodexCatalog(wrap(raw)).map((m) => m.name)).toEqual([
      "Alpha",
      "b",
      "c",
      "d",
      "e",
      " ",
    ]);
  });

  test("efforts: only non-empty string efforts of record levels, in order, duplicates kept", () => {
    const raw = [
      {
        slug: "a",
        supported_reasoning_levels: [
          { effort: "low" },
          null,
          5,
          "high",
          [],
          { effort: "" },
          { effort: 3 },
          {},
          { effort: "low" },
          { effort: "high", extra: 1 },
        ],
      },
      { slug: "b", supported_reasoning_levels: "low" },
      { slug: "c", supported_reasoning_levels: { effort: "low" } },
      { slug: "d", supported_reasoning_levels: null },
    ];
    expect(parseCodexCatalog(wrap(raw)).map((m) => m.efforts)).toEqual([
      ["low", "low", "high"],
      [],
      [],
      [],
    ]);
  });

  test("result objects have exactly slug, name, efforts in that order", () => {
    const [m] = parseCodexCatalog(
      wrap([
        {
          efforts: ["x"],
          name: "ignored",
          supported_reasoning_levels: [{ effort: "low" }],
          display_name: "D",
          slug: "s",
          visibility: "list",
        },
      ]),
    );
    expect(m).toEqual({ slug: "s", name: "D", efforts: ["low"] });
    expect(Object.keys(m!)).toEqual(["slug", "name", "efforts"]);
  });

  test("duplicate slugs are all kept in input order", () => {
    const raw = [
      { slug: "a", display_name: "one" },
      { slug: "a", display_name: "two" },
    ];
    expect(parseCodexCatalog(wrap(raw)).map((m) => m.name)).toEqual(["one", "two"]);
  });

  test("property order and unknown fields do not matter", () => {
    const a = parseCodexCatalog('{"models":[{"visibility":"list","slug":"s","zzz":1}],"x":1}');
    expect(a).toEqual([{ slug: "s", name: "s", efforts: [] }]);
  });

  test("a hidden entry is skipped before its levels are used", () => {
    const raw = [
      { slug: "h", visibility: "hide", supported_reasoning_levels: [{ effort: "low" }] },
    ];
    expect(parseCodexCatalog(wrap(raw))).toEqual([]);
  });
});

describe("checkCodexChoice (pin)", () => {
  const m = (slug: string, name: string, efforts: string[] = []): CodexModel => ({
    slug,
    name,
    efforts,
  });
  const cat = [
    m("gpt-5.6-luna", "GPT-5.6-Luna", ["low", "high"]),
    m("gpt-6-luna", "gpt-6-luna", ["low"]),
    m("gpt-5-sol", "Sol Five", []),
    m("gpt-4o", "Four 4", ["low"]),
  ];

  test("no model: effort passes through unchecked; key shapes", () => {
    const e = checkCodexChoice(undefined, "whatever", cat);
    expect(e).toEqual({ ok: true, effort: "whatever" });
    expect(Object.keys(e)).toEqual(["ok", "effort"]);
    expect(checkCodexChoice(undefined, undefined, [])).toEqual({ ok: true });
  });

  test("tier names resolve to the newest slug but store the tier as typed", () => {
    expect(checkCodexChoice("luna", undefined, cat)).toEqual({ ok: true, model: "luna" });
    expect(checkCodexChoice("LUNA", "low", cat)).toEqual({
      ok: true,
      model: "LUNA",
      effort: "low",
    });
    expect(checkCodexChoice("luna", "high", cat)).toMatchObject({ ok: false });
    expect(checkCodexChoice("sol", undefined, cat)).toEqual({ ok: true, model: "sol" });
  });

  test("tier effort is checked against the newest slug's efforts", () => {
    const r = checkCodexChoice("luna", "high", cat);
    expect(r).toEqual({
      ok: false,
      message: 'Codex model gpt-6-luna does not support the effort "high".',
      suggestions: ["low"],
    });
    expect(Object.keys(r)).toEqual(["ok", "message", "suggestions"]);
  });

  test("slug or display name match is case-insensitive and stores the slug", () => {
    expect(checkCodexChoice("GPT-5.6-LUNA", undefined, cat)).toEqual({
      ok: true,
      model: "gpt-5.6-luna",
    });
    expect(checkCodexChoice("sol five", "x", cat)).toMatchObject({
      ok: false,
      message: 'Codex model gpt-5-sol does not support the effort "x".',
      suggestions: [],
    });
    expect(checkCodexChoice("gpt-4o", "low", cat)).toEqual({
      ok: true,
      model: "gpt-4o",
      effort: "low",
    });
    const r = checkCodexChoice("FOUR 4", "low", cat);
    expect(r).toEqual({ ok: true, model: "gpt-4o", effort: "low" });
    expect(Object.keys(r)).toEqual(["ok", "model", "effort"]);
  });

  test("first catalog match wins for slug-or-name", () => {
    const dup = [m("a-1", "Shared 1"), m("b-2", "shared 1", ["z"])];
    expect(checkCodexChoice("SHARED 1", "z", dup)).toMatchObject({ ok: false });
    expect(checkCodexChoice("SHARED 1", undefined, dup)).toEqual({ ok: true, model: "a-1" });
  });

  test("unknown model: message and tier suggestions in first-seen order, deduplicated", () => {
    const r = checkCodexChoice("nova", "high", cat);
    expect(r).toEqual({
      ok: false,
      message: 'Unknown Codex model "nova".',
      suggestions: ["luna (now gpt-6-luna)", "sol (now gpt-5-sol)"],
    });
  });

  test("suggestions skip non-letter tails and cap at five", () => {
    const many = ["a", "b", "c", "d", "e", "f", "g"].map((t) => m(`gpt-1-${t}`, t));
    const r = checkCodexChoice("zzz", undefined, many);
    expect(!r.ok && r.suggestions).toEqual([
      "a (now gpt-1-a)",
      "b (now gpt-1-b)",
      "c (now gpt-1-c)",
      "d (now gpt-1-d)",
      "e (now gpt-1-e)",
    ]);
    const r2 = checkCodexChoice("zzz", undefined, [m("gpt-4o", "x"), m("slug-5", "y")]);
    expect(!r2.ok && r2.suggestions).toEqual([]);
  });

  test("unknown tier-shaped model on an empty catalog fails with no suggestions", () => {
    expect(checkCodexChoice("luna", undefined, [])).toEqual({
      ok: false,
      message: 'Unknown Codex model "luna".',
      suggestions: [],
    });
  });

  test("effort support suggestions are the model's efforts, capped at five", () => {
    const wide = [m("x-luna", "x", ["1", "2", "3", "4", "5", "6", "7"])];
    const r = checkCodexChoice("luna", "nope", wide);
    expect(!r.ok && r.suggestions).toEqual(["1", "2", "3", "4", "5"]);
  });

  test("model is checked before effort", () => {
    const r = checkCodexChoice("nova", "bad", cat);
    expect(!r.ok && r.message).toContain("Unknown Codex model");
  });

  test("a model with an empty effort list rejects any effort but accepts none", () => {
    expect(checkCodexChoice("sol", "low", cat)).toMatchObject({ ok: false, suggestions: [] });
    expect(checkCodexChoice("sol", undefined, cat)).toEqual({ ok: true, model: "sol" });
  });
});
