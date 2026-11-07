import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMain, type MainDeps } from "../../src/host/main.ts";
import { buildSnapshot } from "../../src/host/readiness.ts";
import { branchItems, scanPlatforms } from "../../src/host/context.ts";
import type { JevRequest } from "../../src/jev/client.ts";
import { mainState } from "../../src/jev/state.ts";
import type { AgentFacts } from "../../src/policy/launch.ts";
import type { MainSample } from "../../scripts/replay/corpus.ts";
import {
  agentFacts,
  parseModels,
  readSnapshot,
  rebuildMain,
  rebuildRich,
  SnapshotError,
  type ReplayContext,
} from "../../scripts/replay/inputs.ts";
import type { SessionEntry } from "../../scripts/replay/sessions.ts";

const msg = (id: string, message: object): SessionEntry => ({ type: "message", id, message });
const user = (id: string, text: string) => msg(id, { role: "user", content: text });
const assistant = (id: string, totalTokens: number) =>
  msg(id, {
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    provider: "p",
    model: "m",
    usage: { totalTokens },
  });
const custom = (id: string, customType: string, data: object): SessionEntry => ({
  type: "custom",
  id,
  customType,
  data,
});

const ctx = (over: Partial<ReplayContext> = {}): ReplayContext => ({
  ledger: new Map(),
  models: new Map([["p/m", 200_000]]),
  ...over,
});
const sampleOf = (branch: SessionEntry[], over: Partial<MainSample> = {}): MainSample => ({
  session: "s",
  cwd: "/nonexistent-replay-cwd",
  entryId: "u",
  prompt: "go",
  branch: [...branch, user("u", "go")],
  ...over,
});

describe("last_decision", () => {
  test("last decision from the earlier port", () => {
    const s = sampleOf([
      custom("c", "jev-pilot:effort", { requested: "high", decision: { strategy: "direct" } }),
    ]);
    expect(rebuildRich(s, ctx()).rich.lastDecision).toEqual({ effort: "high", strategy: "direct" });
  });

  test("last decision from jev-turn and ledger", () => {
    const s = sampleOf([custom("t", "jev-turn", { turnId: "t1" })]);
    const ledger = new Map([["t1", { effective: "medium", strategy: "delegate" }]]);
    expect(rebuildRich(s, ctx({ ledger })).rich.lastDecision).toEqual({
      effort: "medium",
      strategy: "delegate",
    });
  });

  test("no earlier decision is omitted and not missing", () => {
    const r = rebuildRich(sampleOf([]), ctx());
    expect("lastDecision" in r.rich).toBe(false);
    expect(r.missing).not.toContain("last_decision");
  });
});

describe("context_used_percent", () => {
  test("context from usage", () => {
    const r = rebuildRich(sampleOf([assistant("a", 50_000)]), ctx());
    expect(r.rich.contextPercent).toBe(25);
    expect(r.missing).not.toContain("context_used_percent");
  });

  test("context unknown after compaction", () => {
    const s = sampleOf([assistant("a", 50_000), { type: "compaction", id: "k" }]);
    const r = rebuildRich(s, ctx());
    expect("contextPercent" in r.rich).toBe(false);
    expect(r.missing).toContain("context_used_percent");
  });

  test("context unknown without the model", () => {
    const r = rebuildRich(sampleOf([assistant("a", 50_000)]), ctx({ models: new Map() }));
    expect(r.missing).toContain("context_used_percent");
  });
});

describe("other groups", () => {
  test("missing cwd lists languages", () => {
    const r = rebuildRich(sampleOf([]), ctx());
    expect(r.missing).toContain("languages");
    expect("languages" in r.rich).toBe(false);
  });

  test("unmatched git count", () => {
    const s = sampleOf([], { turnId: "t9" });
    const hit = rebuildRich(
      s,
      ctx({ git: new Map([["t9", { changed_files: 2, diff_lines: 5 }]]) }),
    );
    expect(hit.rich.git).toEqual({ changed_files: 2, diff_lines: 5 });
    expect(rebuildRich(s, ctx({ git: new Map() })).missing).toContain("git");
    expect(rebuildRich(sampleOf([]), ctx()).missing).toContain("git");
  });

  test("capabilities come from the snapshot, and are missing without it", () => {
    const agent = { name: "scout", description: "d", declaredTools: ["read"] } as AgentFacts;
    const snapshot = {
      v: 1 as const,
      tools: [{ name: "read", description: "Reads." }],
      agents: [agent],
    };
    const r = rebuildRich(sampleOf([]), ctx({ capabilities: snapshot }));
    expect(r.rich.capabilities).toEqual({
      tools: [{ name: "read", description: "Reads." }],
      agents: [{ name: "scout", description: "d", tools: ["read"] }],
    });
    expect(rebuildRich(sampleOf([]), ctx()).missing).toContain("capabilities");
  });
});

describe("models and snapshot", () => {
  test("parseModels reads the context column", () => {
    const text = [
      "provider  model  context  max-out  thinking  images",
      "p  m  200K  64K  yes  yes",
      "q  big  1M  64K  yes  no",
    ].join("\n");
    expect(parseModels(text)).toEqual(
      new Map([
        ["p/m", 200_000],
        ["q/big", 1_000_000],
      ]),
    );
  });

  test("worker agent missing from snapshot", () => {
    const snapshot = { v: 1 as const, tools: [], agents: [] };
    expect(agentFacts(snapshot, "ghost")).toBeUndefined();
    expect(agentFacts(undefined, "ghost")).toBeUndefined();
  });

  test("bad snapshot throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "replay-snap-"));
    try {
      const wrong = join(dir, "v2.json");
      writeFileSync(wrong, JSON.stringify({ v: 2, tools: [], agents: [] }));
      expect(() => readSnapshot(wrong)).toThrow(SnapshotError);
      expect(() => readSnapshot(join(dir, "absent.json"))).toThrow(SnapshotError);
      const good = join(dir, "v1.json");
      writeFileSync(good, JSON.stringify({ v: 1, tools: [], agents: [] }));
      expect(readSnapshot(good).v).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("snapshot element validation", () => {
  const agent = {
    name: "scout",
    source: "builtin",
    description: "d",
    instructionsExcerpt: "",
    declaredTools: null,
    maxTurns: null,
    sets: { model: false, thinking: false },
  };
  const load = (snapshot: object) => {
    const dir = mkdtempSync(join(tmpdir(), "replay-snap-"));
    try {
      const path = join(dir, "s.json");
      writeFileSync(path, JSON.stringify(snapshot));
      return readSnapshot(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const bad: [string, object][] = [
    ["tool is not an object", { v: 1, tools: [1], agents: [] }],
    ["tool lacks description", { v: 1, tools: [{ name: "read" }], agents: [] }],
    ["agent is null", { v: 1, tools: [], agents: [null] }],
    ["agent lacks name", { v: 1, tools: [], agents: [{ ...agent, name: 3 }] }],
    ["agent declaredTools bad", { v: 1, tools: [], agents: [{ ...agent, declaredTools: [1] }] }],
    [
      "agent declaredTools missing",
      { v: 1, tools: [], agents: [{ ...agent, declaredTools: undefined }] },
    ],
    ["agent maxTurns bad", { v: 1, tools: [], agents: [{ ...agent, maxTurns: "5" }] }],
    ["agent source bad", { v: 1, tools: [], agents: [{ ...agent, source: "x" }] }],
    ["agent sets bad", { v: 1, tools: [], agents: [{ ...agent, sets: { model: 1 } }] }],
    ["agent locked bad", { v: 1, tools: [], agents: [{ ...agent, locked: "yes" }] }],
    ["agent flag bad", { v: 1, tools: [], agents: [{ ...agent, inheritContext: "no" }] }],
  ];
  for (const [name, snapshot] of bad) {
    test(`rejects: ${name}`, () => {
      expect(() => load(snapshot)).toThrow(SnapshotError);
    });
  }

  test("accepts well-formed elements", () => {
    const ok = load({
      v: 1,
      tools: [{ name: "read", description: "Reads." }],
      agents: [{ ...agent, declaredTools: ["read"], maxTurns: 5, locked: ["model"] }],
    });
    expect(ok.agents[0]!.name).toBe("scout");
  });

  test("non-finite token count is missing", () => {
    for (const t of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = rebuildRich(sampleOf([assistant("a", t)]), ctx());
      expect(r.missing).toContain("context_used_percent");
    }
  });
});

describe("same state as live", () => {
  const branch = [
    user("u0", "earlier question?"),
    msg("a0", { role: "assistant", content: [{ type: "toolCall", name: "read", id: "x" }] }),
    msg("r0", { role: "toolResult", toolCallId: "x", isError: true }),
    assistant("a1", 1000),
  ];

  /** Runs the real `createMain` in-process (not the spawned CLI) and returns the state it sent. */
  async function liveState(entries: SessionEntry[], cwd: string, rich?: MainDeps["rich"]) {
    const requests: JevRequest[] = [];
    const snapshot = buildSnapshot({
      configRead: { kind: "ok", present: true, config: {} },
      stateRead: { kind: "ok", state: {} },
      env: { TYPESAFE_API_KEY: "k" },
      toolNames: [],
    });
    const pi = {
      getThinkingLevel: () => "low",
      setThinkingLevel: () => undefined,
      appendEntry: () => undefined,
      getAllTools: () => [],
    };
    const deps: MainDeps = {
      load: () => snapshot,
      ask: async (req) => (requests.push(req), { kind: "failed" } as never),
      append: () => ({ ok: true }) as never,
      now: () => 1,
      newId: () => "id",
      platforms: scanPlatforms,
      env: () => ({ TYPESAFE_API_KEY: "k" }),
      commands: () => [],
      readFile: () => "",
      ...(rich === undefined ? {} : { rich }),
    };
    const ctxLive = {
      sessionManager: {
        getSessionId: () => "live-1",
        buildSessionProjection: () => ({ entries: [], messages: [] }),
        getBranch: () => entries,
      },
      model: { provider: "p", id: "m", reasoning: true, thinkingLevelMap: {} },
      cwd,
      hasUI: true,
      mode: "rpc",
      signal: undefined,
      ui: { setWidget: () => undefined },
      getContextUsage: () => undefined,
    };
    await createMain(pi as never, deps).beforeAgentStart(
      { type: "before_agent_start", messageType: "user", prompt: "go" } as never,
      ctxLive as never,
    );
    return requests[0]!.state;
  }

  test("base state equals the host state", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "replay-live-"));
    try {
      const live = await liveState(branch, cwd, {
        groups: [],
        git: async () => undefined,
        tools: () => [],
        agents: () => [],
      });
      const built = rebuildMain(sampleOf(branch, { cwd }), ctx());
      expect(mainState({ prompt: "go", items: built.items, platforms: built.platforms })).toEqual(
        live as never,
      );
      expect(built.items).toEqual(branchItems(branch));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("a shipped languages group equals the host state", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "replay-live-"));
    try {
      writeFileSync(join(cwd, "a.ts"), "");
      const live = await liveState(branch, cwd, {
        groups: ["languages"],
        git: async () => undefined,
        tools: () => [],
        agents: () => [],
      });
      const built = rebuildMain(sampleOf(branch, { cwd }), ctx());
      const replay = mainState({
        prompt: "go",
        items: built.items,
        platforms: built.platforms,
        rich: { languages: built.rich.languages! },
      });
      expect(replay).toEqual(live as never);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
