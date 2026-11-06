import type { WorkerEntry } from "../../src/store/ledger-schema.ts";

/** A valid worker ledger entry; `briefChars` carries the sequence number. */
export function entry(i: number): WorkerEntry {
  return {
    v: 1,
    at: 1762400000000 + i,
    kind: "worker",
    session: "s-1",
    mode: "standard",
    answered: false,
    agent: "w",
    briefChars: i,
    reason: "untouched",
    status: "completed",
  };
}
