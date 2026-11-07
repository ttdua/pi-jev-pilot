import { chmodSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  readState,
  resetState,
  updateState,
  validateCliReview,
} from "../../src/store/state-file.ts";
import { tempDir } from "../helpers.ts";

const isRoot = process.getuid?.() === 0;
const FEATURES = [
  "effort",
  "subagents",
  "skills",
  "strategy",
  "tools",
  "expert",
  "status",
  "verbose",
];

function withDir(fn: (dir: string) => void): void {
  const dir = tempDir("jev-state-");
  try {
    fn(dir);
  } finally {
    chmodSync(dir, 0o700);
    try {
      chmodSync(join(dir, "state.json"), 0o600);
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
}

function put(dir: string, text: string): void {
  writeFileSync(join(dir, "state.json"), text);
}

function paths(r: ReturnType<typeof readState>): string[] {
  return "issues" in r ? r.issues.map((i) => i.path) : [];
}

describe("state content", () => {
  test("Valid state read", () =>
    withDir((dir) => {
      put(
        dir,
        '{"version":1,"switches":{"skills":false},"mode":"budget","cliReview":{"cli":"codex","model":"luna","effort":"high"}}',
      );
      expect(readState(dir)).toEqual({
        kind: "ok",
        state: {
          switches: { skills: false },
          mode: "budget",
          cliReview: { cli: "codex", model: "luna", effort: "high" },
        },
      });
    }));

  test("Every documented feature accepted", () =>
    withDir((dir) => {
      const switches = Object.fromEntries(FEATURES.map((f) => [f, false]));
      put(dir, JSON.stringify({ version: 1, switches }));
      expect(readState(dir)).toEqual({ kind: "ok", state: { switches } });
    }));

  test("Literal default rejected", () =>
    withDir((dir) => {
      put(dir, '{"version":1,"cliReview":{"cli":"codex","model":"default"}}');
      const r = readState(dir);
      expect(r.kind).toBe("malformed");
      expect(paths(r)).toEqual(["cliReview.model"]);
    }));

  test("CLI review switch read", () =>
    withDir((dir) => {
      put(dir, '{"version":1,"cliReviewEnabled":true}');
      expect(readState(dir)).toEqual({ kind: "ok", state: { cliReviewEnabled: true } });
    }));

  test("Non-boolean CLI review switch", () =>
    withDir((dir) => {
      put(dir, '{"version":1,"cliReviewEnabled":"yes"}');
      const r = readState(dir);
      expect(r.kind).toBe("malformed");
      expect(paths(r)).toEqual(["cliReviewEnabled"]);
    }));

  test("Legacy review switch accepted and dropped", () =>
    withDir((dir) => {
      put(dir, '{"version":1,"mode":"budget","switches":{"review":false,"skills":false}}');
      expect(readState(dir)).toEqual({
        kind: "ok",
        state: { mode: "budget", switches: { skills: false } },
      });
    }));

  test("Legacy review switch alone", () =>
    withDir((dir) => {
      put(dir, '{"version":1,"switches":{"review":true}}');
      expect(readState(dir)).toEqual({ kind: "ok", state: {} });
    }));

  test("Legacy review switch gone after a write", () =>
    withDir((dir) => {
      put(
        dir,
        '{"version":1,"mode":"budget","cliReviewEnabled":true,"switches":{"review":false,"skills":false}}',
      );
      expect(updateState(dir, (s) => ({ ...s, mode: "premium" })).ok).toBe(true);
      const raw = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
      expect(raw.mode).toBe("premium");
      expect(raw.cliReviewEnabled).toBe(true);
      expect(raw.switches).toEqual({ skills: false });
      expect(existsSync(join(dir, "state.json.bad"))).toBe(false);
    }));

  test("Non-boolean legacy review switch", () =>
    withDir((dir) => {
      put(dir, '{"version":1,"switches":{"review":"off"}}');
      const r = readState(dir);
      expect(r.kind).toBe("malformed");
      expect(paths(r)).toEqual(["switches.review"]);
    }));

  test("OpenCode provider/model id accepted", () =>
    withDir((dir) => {
      put(dir, '{"version":1,"cliReview":{"cli":"opencode","model":"ollama-cloud/gpt-oss:120b"}}');
      expect(readState(dir)).toEqual({
        kind: "ok",
        state: { cliReview: { cli: "opencode", model: "ollama-cloud/gpt-oss:120b" } },
      });
    }));

  test("Model starting with dash rejected", () =>
    withDir((dir) => {
      put(dir, '{"version":1,"cliReview":{"cli":"codex","model":"-m"}}');
      const r = readState(dir);
      expect(r.kind).toBe("malformed");
      expect(paths(r)).toEqual(["cliReview.model"]);
    }));

  test("Model over 128 characters rejected", () =>
    withDir((dir) => {
      put(dir, JSON.stringify({ version: 1, cliReview: { cli: "codex", model: "a".repeat(129) } }));
      expect(readState(dir).kind).toBe("malformed");
    }));

  test("Effort with slash rejected", () =>
    withDir((dir) => {
      put(dir, '{"version":1,"cliReview":{"cli":"codex","effort":"a/b"}}');
      const r = readState(dir);
      expect(r.kind).toBe("malformed");
      expect(paths(r)).toEqual(["cliReview.effort"]);
    }));

  test("validateCliReview reports prefixed paths", () => {
    const bad = validateCliReview({ cli: "codex", model: "-m" });
    expect(bad.map((i) => i.path)).toEqual(["cliReview.model"]);
    expect(validateCliReview({ cli: "opencode", model: "p/m" })).toEqual([]);
  });

  test("Unknown feature", () =>
    withDir((dir) => {
      put(dir, '{"version":1,"switches":{"colors":true}}');
      const r = readState(dir);
      expect(r.kind).toBe("malformed");
      expect(paths(r)).toEqual(["switches.colors"]);
    }));
});

describe("missing and malformed", () => {
  test("No file", () =>
    withDir((dir) => {
      expect(readState(dir)).toEqual({ kind: "missing", state: {} });
    }));

  test("Bad JSON", () =>
    withDir((dir) => {
      put(dir, '{"version":1,"mode":');
      const r = readState(dir);
      expect(r).toMatchObject({ kind: "malformed", state: {} });
      expect(paths(r)).toEqual([""]);
    }));

  test("Partly valid file is not salvaged", () =>
    withDir((dir) => {
      put(dir, '{"version":1,"mode":"budget","switches":{"skills":"no"}}');
      const r = readState(dir);
      expect(r.kind).toBe("malformed");
      expect(r.state).toEqual({});
      expect(paths(r)).toEqual(["switches.skills"]);
    }));

  test("Future version", () =>
    withDir((dir) => {
      put(dir, '{"version":2}');
      const r = readState(dir);
      expect(r.kind).toBe("malformed");
      expect(paths(r)).toEqual(["version"]);
    }));
});

describe("unreadable", () => {
  test.skipIf(isRoot)("Permission denied", () =>
    withDir((dir) => {
      put(dir, '{"version":1}');
      chmodSync(join(dir, "state.json"), 0o000);
      const r = readState(dir);
      expect(r.kind).toBe("unreadable");
      expect(JSON.stringify(r)).toContain("EACCES");
      const u = updateState(dir, (s) => ({ ...s, mode: "premium" }));
      expect(u).toEqual({ ok: false, issues: "issues" in r ? r.issues : [] });
      expect(existsSync(join(dir, "state.json.bad"))).toBe(false);
    }),
  );
});

describe("updates", () => {
  test("Switch persists", () =>
    withDir((dir) => {
      put(dir, '{"version":1,"mode":"budget"}');
      const r = updateState(dir, (s) => ({ ...s, switches: { skills: false } }));
      expect(r).toEqual({ ok: true });
      expect(readState(dir)).toEqual({
        kind: "ok",
        state: { mode: "budget", switches: { skills: false } },
      });
      expect(readFileSync(join(dir, "state.json"), "utf8")).toBe(
        '{\n  "version": 1,\n  "mode": "budget",\n  "switches": {\n    "skills": false\n  }\n}\n',
      );
      expect(statSync(join(dir, "state.json")).mode & 0o777).toBe(0o600);
    }));

  test("Bad file moved aside", () =>
    withDir((dir) => {
      const bad = '{"version":1,"mode":';
      put(dir, bad);
      expect(updateState(dir, (s) => ({ ...s, mode: "premium" }))).toEqual({ ok: true });
      expect(readFileSync(join(dir, "state.json.bad"), "utf8")).toBe(bad);
      expect(statSync(join(dir, "state.json.bad")).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf8"))).toEqual({
        version: 1,
        mode: "premium",
      });
    }));

  test.skipIf(isRoot)("move aside fails without throwing", () =>
    withDir((dir) => {
      put(dir, '{"version":1,"mode":');
      chmodSync(dir, 0o500);
      const r = updateState(dir, (s) => ({ ...s, mode: "premium" }));
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).toContain("EACCES");
      expect(JSON.stringify(r)).toContain("cannot move state.json aside");
      chmodSync(dir, 0o700);
      expect(readFileSync(join(dir, "state.json"), "utf8")).toBe('{"version":1,"mode":');
    }),
  );

  test("Invalid update refused", () =>
    withDir((dir) => {
      const before = '{"version":1,"mode":"budget"}';
      put(dir, before);
      const r = updateState(dir, (s) => ({ ...s, mode: "turbo" as never }));
      expect(r).toMatchObject({ ok: false, issues: [{ path: "mode" }] });
      expect(readFileSync(join(dir, "state.json"), "utf8")).toBe(before);
    }));

  test("throwing mutate is returned", () =>
    withDir((dir) => {
      const before = '{"version":1,"mode":"budget"}';
      put(dir, before);
      const r = updateState(dir, () => {
        throw new Error("boom");
      });
      expect(r).toEqual({ ok: false, issues: [{ path: "", message: "update failed" }] });
      expect(readFileSync(join(dir, "state.json"), "utf8")).toBe(before);
    }));
});

describe("Reset", () => {
  test("Reset clears everything", () =>
    withDir((dir) => {
      put(
        dir,
        '{"version":1,"switches":{"skills":false},"mode":"budget","cliReview":{"cli":"codex"},"cliReviewEnabled":true}',
      );
      expect(resetState(dir)).toEqual({ ok: true });
      expect(readState(dir)).toEqual({ kind: "ok", state: {} });
    }));
});

describe("Read-only directory", () => {
  test.skipIf(isRoot)("valid state in a read-only directory", () =>
    withDir((dir) => {
      put(dir, '{"version":1,"mode":"budget"}');
      chmodSync(dir, 0o500);
      const r = updateState(dir, (s) => ({ ...s, mode: "premium" }));
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).toContain("EACCES");
    }),
  );

  test.skipIf(isRoot)("missing state in a read-only directory", () =>
    withDir((dir) => {
      chmodSync(dir, 0o500);
      const r = updateState(dir, (s) => ({ ...s, mode: "premium" }));
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).toContain("EACCES");
    }),
  );
});
