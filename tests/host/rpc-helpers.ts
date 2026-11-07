// Shared helpers for host tests that talk to a real Pi process over RPC.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "bun:test";
import type { HostSession } from "./harness";
import type { RpcEvent } from "./rpc";

export type UiRequest = RpcEvent & {
  method?: string;
  widgetKey?: string;
  widgetLines?: string[];
  widgetPlacement?: string;
  message?: string;
  notifyType?: string;
};

export const uiRequests = (s: HostSession): UiRequest[] =>
  s.events.filter((e) => e.type === "extension_ui_request") as UiRequest[];

export const notifies = (s: HostSession): UiRequest[] =>
  uiRequests(s).filter((e) => e.method === "notify");

/** Sends a slash command as a prompt and waits for its response. */
export async function command(
  s: HostSession,
  text: string,
): Promise<Record<string, unknown> | undefined> {
  const r = await s.send({ type: "prompt", message: text });
  expect(r.success).toBe(true);
  return r.data;
}

const jevFile = (agentDir: string, name: string): string =>
  join(agentDir, "jev", name);

/**
 * Writes `<agentDir>/jev/config.json`. Call it before `startHostSession`: the harness keeps an
 * existing config, so it never adds a `timeoutMs` of its own.
 */
export function writeConfigFile(
  agentDir: string,
  config: Record<string, unknown>,
): void {
  mkdirSync(join(agentDir, "jev"), { recursive: true });
  writeFileSync(jevFile(agentDir, "config.json"), JSON.stringify(config));
}

export type SeedOptions = {
  /** The first `misses` lines are timeouts; the rest are answered. Default 0. */
  misses?: number;
  /** Fields added to every answered line. */
  answered?: Record<string, unknown>;
};

/** Writes `n` valid `main` lines to `<agentDir>/jev/ledger.jsonl` (replacing the file). */
export function seedLedger(
  agentDir: string,
  n: number,
  opts: SeedOptions = {},
): void {
  const misses = opts.misses ?? 0;
  const base = Date.now() - 100_000;
  const lines = Array.from({ length: n }, (_, i) => {
    const common = {
      v: 1,
      at: base + i,
      kind: "main",
      session: "seed",
      mode: "standard",
      turnId: `seed-${i}`,
      outcome: "ok",
    };
    return i < misses
      ? { ...common, answered: false, miss: "timeout" }
      : { ...common, answered: true, ms: 1000, ...opts.answered };
  });
  mkdirSync(join(agentDir, "jev"), { recursive: true });
  writeFileSync(
    jevFile(agentDir, "ledger.jsonl"),
    lines.map((l) => `${JSON.stringify(l)}\n`).join(""),
  );
}

/** Appends one `correction` line for each turn id. */
export function seedCorrections(
  agentDir: string,
  turnIds: readonly string[],
): void {
  const at = Date.now() - 50_000;
  const lines = turnIds.map((turnId) => ({
    v: 1,
    at,
    kind: "correction",
    session: "seed",
    turnId,
    corrects: 0.9,
  }));
  appendFileSync(
    jevFile(agentDir, "ledger.jsonl"),
    lines.map((l) => `${JSON.stringify(l)}\n`).join(""),
  );
}
