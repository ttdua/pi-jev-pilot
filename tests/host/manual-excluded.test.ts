import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../helpers";

const SCRIPT = join(REPO_ROOT, "tests", "host", "manual", "q8-claude-code.ts");

describe("manual Q8 script", () => {
  test("manual script is not collected", () => {
    expect(existsSync(SCRIPT)).toBe(true);
    expect(SCRIPT.endsWith(".test.ts")).toBe(false);
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
      expect(command.includes("manual/"), `package.json script "${name}" mentions manual/`).toBe(
        false,
      );
    }
  });
});
