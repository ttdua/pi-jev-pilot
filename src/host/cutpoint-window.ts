import { windowEntries, WINDOW_MAX, type WindowLine } from "../policy/cut-window.ts";
import type { WindowEntry } from "../policy/cutpoints.ts";
import { RUBRIC_VERSION } from "../jev/rubrics.ts";
import { validateLedgerEntry } from "../store/ledger-schema.ts";

/** In-memory window of the latest eligible worker lines; fed by the ledger and by this session. */
export type CutpointWindow = {
  load(lines: readonly unknown[]): void;
  add(line: unknown): void;
  entries(): WindowEntry[];
  clear(): void;
};

function eligible(line: unknown): WindowLine | undefined {
  const checked = validateLedgerEntry(line);
  if (!checked.ok || checked.entry.kind !== "worker") return undefined;
  const candidate: WindowLine = checked.entry;
  return windowEntries([candidate], RUBRIC_VERSION).length === 1 ? candidate : undefined;
}

function latest(lines: readonly WindowLine[]): WindowLine[] {
  return [...lines].sort((a, b) => a.at - b.at).slice(-WINDOW_MAX);
}

export function createCutpointWindow(): CutpointWindow {
  let lines: WindowLine[] = [];
  return {
    load(input) {
      lines = latest(input.flatMap((l) => eligible(l) ?? []));
    },
    add(line) {
      const ok = eligible(line);
      if (ok !== undefined) lines = latest([...lines, ok]);
    },
    entries: () => windowEntries(lines, RUBRIC_VERSION),
    clear() {
      lines = [];
    },
  };
}
