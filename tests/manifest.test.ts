import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./helpers";

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));

describe("package manifest", () => {
  test("Manifest names both entry points", () => {
    expect(pkg.pi.extensions).toEqual([
      "./packages/pi-subagents/src/index.ts",
      "./src/extension.ts",
    ]);
    expect(pkg.keywords).toContain("pi-package");
    expect(pkg.license).toBe("MIT");
  });

  test("Host package is a peer, not bundled", () => {
    expect(pkg.peerDependencies).toEqual({
      "@earendil-works/pi-ai": "*",
      "@earendil-works/pi-coding-agent": "*",
      "@earendil-works/pi-tui": "*",
      typebox: "*",
    });
    expect(Object.keys(pkg.dependencies ?? {}).length).toBe(0);
  });

  test("Every imported host package is declared", () => {
    const names = new Set<string>();
    for (const root of ["src", join("packages", "pi-subagents", "src")]) {
      for (const file of readdirSync(join(REPO_ROOT, root), { recursive: true })) {
        if (!String(file).endsWith(".ts")) continue;
        const text = readFileSync(join(REPO_ROOT, root, String(file)), "utf8")
          .split("\n")
          .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
          .join("\n");
        for (const match of text.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)) {
          const specifier = match[1];
          if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
          if (specifier.startsWith("#src/") || specifier === "@ttdua/pi-subagents") continue;
          const parts = specifier.split("/");
          names.add(specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
        }
      }
    }
    expect(names.size).toBeGreaterThan(0);
    expect(Object.keys(pkg.peerDependencies)).toEqual(expect.arrayContaining([...names]));
  });

  test("No published executor dependency: executor comes from the vendored package", () => {
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      expect(Object.keys(pkg[field] ?? {})).not.toContain("@gotgenes/pi-subagents");
    }
    expect(Object.keys(pkg.dependencies ?? {}).length).toBe(0);
    expect(pkg.workspaces).toContain("packages/pi-subagents");
    expect(pkg.scripts["test:executor"]).toBeDefined();
  });

  test("vendored package is private and renamed", () => {
    const vendored = JSON.parse(
      readFileSync(join(REPO_ROOT, "packages", "pi-subagents", "package.json"), "utf8"),
    );
    expect(vendored.name).toBe("@ttdua/pi-subagents");
    expect(vendored.private).toBe(true);
    expect(vendored.imports["#src/*"]).toBe("./src/*");
  });

  test("LICENSE is MIT", () => {
    const text = readFileSync(join(REPO_ROOT, "LICENSE"), "utf8");
    expect(text).toContain("MIT License");
    expect(text).toContain("Permission is hereby granted");
  });
});
