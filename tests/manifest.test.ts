import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
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
    expect(pkg.peerDependencies).toEqual({
      "@earendil-works/pi-coding-agent": "*",
      typebox: "*",
    });
    expect(Object.keys(pkg.dependencies ?? {}).length).toBe(0);
  });

  test("every imported host package is declared", () => {
    const names = new Set<string>();
    for (const file of readdirSync(join(REPO_ROOT, "src"), { recursive: true })) {
      if (!String(file).endsWith(".ts")) continue;
      const text = readFileSync(join(REPO_ROOT, "src", String(file)), "utf8");
      for (const match of text.matchAll(/from\s+["']([^"']+)["']/g)) {
        const specifier = match[1];
        if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
        const parts = specifier.split("/");
        names.add(specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
      }
    }
    expect(names.size).toBeGreaterThan(0);
    expect(Object.keys(pkg.peerDependencies)).toEqual(expect.arrayContaining([...names]));
  });

  test("executor is pinned exactly", () => {
    expect(pkg.devDependencies["@gotgenes/pi-subagents"]).toBe("25.0.5");
    expect(Object.keys(pkg.dependencies ?? {}).length).toBe(0);
  });

  test("LICENSE is MIT", () => {
    const text = readFileSync(join(REPO_ROOT, "LICENSE"), "utf8");
    expect(text).toContain("MIT License");
    expect(text).toContain("Permission is hereby granted");
  });
});
