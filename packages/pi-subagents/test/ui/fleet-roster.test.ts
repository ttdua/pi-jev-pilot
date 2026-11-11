import { describe, expect, it } from "vitest";
import type { AgentConfigLookup } from "#src/config/agent-types";
import {
  type FleetAgent,
  fleetRows,
  formatFleetElapsed,
  formatFleetTokens,
  renderFleetLines,
} from "#src/ui/fleet-roster";
import { visibleWidth } from "@earendil-works/pi-tui";
import { makeNavigable } from "../helpers/make-navigable";

const theme = { fg: (_: string, t: string) => t, bold: (t: string) => t };
const registry = {
  resolveAgentConfig: () => ({ name: "Explore", displayName: "Explore" }),
} as unknown as AgentConfigLookup;
const HINT = "  esc to interrupt · ← for agents · ↓ to manage";

function agent(overrides: Partial<FleetAgent> = {}): FleetAgent {
  return {
    ...makeNavigable({ status: "running", completedAt: undefined, description: "audit auth" }),
    lifetimeUsage: { input: 10_000, output: 3_000, cacheWrite: 100 },
    ...overrides,
  };
}

function many(count: number): FleetAgent[] {
  return Array.from({ length: count }, (_, i) =>
    agent({ id: `a${i}`, startedAt: 1000 + i, description: `task ${i}` }),
  );
}

function render(rows: FleetAgent[], selected = 0, extra: { active?: boolean; width?: number; now?: number } = {}) {
  return renderFleetLines({
    rows,
    selected,
    active: extra.active ?? false,
    width: extra.width ?? 80,
    now: extra.now ?? 13_400,
    theme,
    registry,
  });
}

describe("fleetRows", () => {
  it("lists a running agent with a ready session", () => {
    const a = agent();
    expect(fleetRows([a], 5000, undefined)).toEqual([a]);
  });

  it("lists a foreground agent", () => {
    const a = agent({ id: "fg" });
    expect(fleetRows([a], 5000, undefined)).toHaveLength(1);
  });

  it("skips a queued agent with no session and no outputFile", () => {
    const a = agent({ status: "queued", isSessionReady: () => false, outputFile: undefined });
    expect(fleetRows([a], 5000, undefined)).toEqual([]);
  });

  it("orders by startedAt", () => {
    const a = agent({ id: "A", startedAt: 1000 });
    const b = agent({ id: "B", startedAt: 500 });
    expect(fleetRows([a, b], 5000, undefined).map((r) => r.id)).toEqual(["B", "A"]);
  });

  it("keeps an agent finished 3000 ms ago", () => {
    const a = agent({ status: "completed", startedAt: 1000, completedAt: 13_000 });
    expect(fleetRows([a], 16_000, undefined)).toEqual([a]);
    const row = render([a], 0, { now: 99_000 })[3];
    expect(row.endsWith("12s · ↓ 13.1k tokens")).toBe(true);
  });

  it("drops an agent finished 10000 ms ago with a held session", () => {
    const a = agent({ status: "completed", completedAt: 1000 });
    expect(fleetRows([a], 11_000, undefined)).toEqual([]);
  });

  it("keeps the viewed agent past the linger", () => {
    const a = agent({ id: "v", status: "completed", completedAt: 1000 });
    expect(fleetRows([a], 11_000, "v")).toEqual([a]);
  });
});

describe("formatting", () => {
  it("formats elapsed seconds", () => {
    expect(formatFleetElapsed(12_400)).toBe("12s");
  });

  it("formats token counts compactly", () => {
    expect(formatFleetTokens(950)).toBe("↓ 950 tokens");
    expect(formatFleetTokens(13_100)).toBe("↓ 13.1k tokens");
    expect(formatFleetTokens(1_200_000)).toBe("↓ 1.2M tokens");
  });
});

describe("renderFleetLines", () => {
  it("inactive layout", () => {
    const lines = render([agent()]);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe(HINT);
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("  ○ main");
    expect(lines[4]).toBe("");
  });

  it("active hint and marker", () => {
    const lines = render([agent()], 1, { active: true });
    expect(lines[0]).toBe("  ↑↓ select · enter view · esc back");
    expect(lines[2]).toBe("  ○ main");
    expect(lines[3]).toContain("●");
  });

  it("row text", () => {
    const row = render([agent({ startedAt: 1000 })], 0, { now: 13_400 })[3];
    expect(row).toContain("Explore");
    expect(row).toContain("audit auth");
    expect(row.startsWith("  ○ Explore  audit auth")).toBe(true);
    expect(row.endsWith("12s · ↓ 13.1k tokens")).toBe(true);
  });

  it("overflow shows ↓ 2 more", () => {
    const lines = render(many(7), 1, { active: true });
    expect(lines.some((l) => l.includes("↓ 2 more"))).toBe(true);
    expect(lines.some((l) => /↑ \d+ more/.test(l))).toBe(false);
    expect(lines).toHaveLength(3 + 5 + 1 + 1);
  });

  it("windows to keep the selected row visible", () => {
    const lines = render(many(7), 7, { active: true });
    expect(lines.some((l) => l.includes("↑ 2 more"))).toBe(true);
    expect(lines.some((l) => l.includes("task 6"))).toBe(true);
    expect(lines.some((l) => l.includes("task 1"))).toBe(false);
  });

  it.each([20, 10])("clamps every line at width %i", (width) => {
    const rows = many(7).map((r) => ({ ...r, description: "a very long description indeed" }));
    for (const selected of [0, 3, 7]) {
      for (const line of render(rows, selected, { width, active: true })) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });
});
