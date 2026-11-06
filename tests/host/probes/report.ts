import { appendFileSync } from "node:fs";

type Fields = { sessionId?: string; data?: Record<string, string | number | boolean> };

const SEQ = Symbol.for("jev-probe.seq");

function nextSeq(): number {
  const g = globalThis as Record<symbol, number | undefined>;
  const n = (g[SEQ] ?? 0) + 1;
  g[SEQ] = n;
  return n;
}

export function probeReport(probe: string): (event: string, fields?: Fields) => void {
  return (event, fields = {}) => {
    const path = process.env.JEV_PROBE_REPORT;
    if (!path) return;
    const record = { probe, event, seq: nextSeq(), t: performance.now(), ...fields };
    appendFileSync(path, `${JSON.stringify(record)}\n`);
  };
}
