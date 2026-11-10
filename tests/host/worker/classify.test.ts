import { describe, expect, test } from "bun:test";
import type { JevRequest } from "../../../src/jev/client.ts";
import {
  classifyLaunch,
  lastUserText,
  type ClassifyDeps,
} from "../../../src/host/worker/classify.ts";
import { tempDir } from "../../helpers.ts";
import { base, body, ok, snap } from "../worker-fakes.ts";

const ctx = (branch: unknown[] = []) =>
  ({
    cwd: tempDir("jev-classify-cwd-"),
    signal: undefined,
    sessionManager: { getBranch: () => branch },
    modelRegistry: {
      find: (p: string, id: string) =>
        p === "fx" && id === "fast" ? { name: "Fixture Fast" } : undefined,
    },
  }) as never;

const deps = (asked: JevRequest[] = []): ClassifyDeps => ({
  ask: (req) => (asked.push(req), Promise.resolve(ok(body("fast")))),
  agentDir: () => tempDir("jev-classify-agents-"),
  window: () => [],
  apiKey: () => "k",
});

describe("classifyLaunch", () => {
  test("asks Jev with the tier names the registry knows", async () => {
    const asked: JevRequest[] = [];
    const entry = classifyLaunch(base(), ctx(), snap(), deps(asked));
    await entry.outcome;

    expect(entry.kind.kind).toBe("ask");
    expect(asked).toHaveLength(1);
    expect(JSON.stringify(asked[0]?.questions)).toContain("Fixture Fast");
    expect(asked[0]?.apiKey).toBe("k");
  });

  test("leaves a resumed launch untouched without asking", () => {
    const asked: JevRequest[] = [];
    const entry = classifyLaunch({ ...base(), resume: "ag-1" }, ctx(), snap(), deps(asked));

    expect(entry.kind.kind).toBe("untouched");
    expect(entry.outcome).toBeUndefined();
    expect(asked).toHaveLength(0);
  });

  test("turns a rejected ask into an error miss", async () => {
    const failing: ClassifyDeps = { ...deps(), ask: () => Promise.reject(new Error("down")) };
    const entry = classifyLaunch(base(), ctx(), snap(), failing);

    expect(await entry.outcome).toEqual({
      kind: "miss",
      miss: "error",
      reason: "ask failed",
      ms: 0,
    });
  });

  test("sends the parent request only when the setting is on", async () => {
    const asked: JevRequest[] = [];
    const branch = [{ type: "message", message: { role: "user", content: "fix the parser" } }];
    await classifyLaunch(base(), ctx(branch), snap({ parentRequest: true }), deps(asked)).outcome;
    await classifyLaunch(base(), ctx(branch), snap(), deps(asked)).outcome;

    expect(JSON.stringify(asked[0]?.state)).toContain("fix the parser");
    expect(JSON.stringify(asked[1]?.state)).not.toContain("fix the parser");
  });
});

describe("lastUserText", () => {
  test("joins the text parts of the newest user message", () => {
    const branch = [
      { type: "message", message: { role: "user", content: "old" } },
      {
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }],
        },
      },
      { type: "message", message: { role: "assistant", content: "ok" } },
    ];
    expect(lastUserText(ctx(branch))).toBe("a\nb");
  });

  test("returns undefined when the newest user message has no text", () => {
    const branch = [{ type: "message", message: { role: "user", content: [] } }];
    expect(lastUserText(ctx(branch))).toBeUndefined();
  });
});
