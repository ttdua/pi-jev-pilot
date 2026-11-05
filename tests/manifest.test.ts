import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./helpers";

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));

describe("package manifest", () => {
  test("manifest names one entry point", () => {
    expect(pkg.pi.extensions).toEqual(["./src/extension.ts"]);
    expect(pkg.keywords).toContain("pi-package");
    expect(pkg.license).toBe("MIT");
  });

  test("host package is a peer, not bundled", () => {
    expect(pkg.peerDependencies["@earendil-works/pi-coding-agent"]).toBe("*");
    expect(Object.keys(pkg.dependencies ?? {}).length).toBe(0);
  });

  test("LICENSE is MIT", () => {
    const text = readFileSync(join(REPO_ROOT, "LICENSE"), "utf8");
    expect(text).toContain("MIT License");
    expect(text).toContain("Permission is hereby granted");
  });
});
