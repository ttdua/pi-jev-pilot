import { expect, test } from "bun:test";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runJev } from "../../../src/host/commands/jev.ts";
import { buildSnapshot } from "../../../src/host/platform/readiness.ts";
import { tempDir } from "../../helpers.ts";

test("a status command draws and notifies before its first await yields", async () => {
  const cwd = tempDir("jev-order-");
  const log: string[] = [];
  const ctx = {
    cwd,
    hasUI: true,
    ui: { notify: () => log.push("notify"), setWidget: () => log.push("draw") },
    sessionManager: { getSessionId: () => "main", getBranch: () => [] },
  } as unknown as ExtensionCommandContext;
  const deps = {
    dir: `${cwd}/jev`,
    load: () =>
      buildSnapshot({
        configRead: { kind: "ok", present: false, config: {} },
        stateRead: { kind: "missing", state: {} },
        env: { TYPESAFE_API_KEY: "k" },
        toolNames: [],
      }),
    decision: () => undefined,
    exec: async () => {
      throw new Error("exec must not run");
    },
  };
  const p = runJev("", ctx, deps);
  log.push("handler-returned");
  await p;
  expect(log.slice(0, 3)).toEqual(["draw", "notify", "handler-returned"]);
});
