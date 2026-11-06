import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { REPO_ROOT } from "../helpers.ts";

const STORE = join(REPO_ROOT, "src", "store");

function storeSources(): { file: string; text: string }[] {
  return readdirSync(STORE, { recursive: true })
    .map(String)
    .filter((p) => p.endsWith(".ts"))
    .map((file) => ({ file, text: readFileSync(join(STORE, file), "utf8") }));
}

test("stores read no environment", () => {
  const files = storeSources();
  expect(files.length).toBeGreaterThan(0);
  expect(files.filter((f) => /process\.env/.test(f.text)).map((f) => f.file)).toEqual([]);
});

test("stores never import Pi", () => {
  const files = storeSources();
  expect(files.length).toBeGreaterThan(0);
  expect(files.filter((f) => /from ["']@earendil-works\//.test(f.text)).map((f) => f.file)).toEqual(
    [],
  );
});
