import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./helpers";

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));

describe("package manifest", () => {
  test("Manifest names one entry point", () => {
    expect(pkg.name).toBe("@ttdua/pi-jev-pilot");
    expect(pkg.pi.extensions).toEqual(["./src/extension.ts"]);
    expect(pkg.workspaces).toBeUndefined();
    expect(pkg.scripts["test:executor"]).toBeUndefined();
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

  test("Executor is a dev dependency only", () => {
    expect(Object.keys(pkg.devDependencies)).toContain("@ttdua/pi-subagents");
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("@ttdua/pi-subagents");
    expect(Object.keys(pkg.peerDependencies)).not.toContain("@ttdua/pi-subagents");
    expect(Object.keys(pkg.optionalDependencies ?? {})).not.toContain("@ttdua/pi-subagents");
  });

  test("Pinned to a release tag", () => {
    expect(pkg.devDependencies["@ttdua/pi-subagents"]).toMatch(
      /^github:ttdua\/pi-subagents#v\d+\.\d+\.\d+$/,
    );
  });

  test("No published executor dependency", () => {
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      expect(Object.keys(pkg[field] ?? {})).not.toContain("@gotgenes/pi-subagents");
    }
  });

  test("Every imported host package is declared", () => {
    const names = new Set<string>();
    for (const file of readdirSync(join(REPO_ROOT, "src"), { recursive: true })) {
      if (!String(file).endsWith(".ts")) continue;
      const text = readFileSync(join(REPO_ROOT, "src", String(file)), "utf8")
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
    expect(names.size).toBeGreaterThan(0);
    expect(Object.keys(pkg.peerDependencies)).toEqual(expect.arrayContaining([...names]));
  });

  test("LICENSE is MIT", () => {
    const text = readFileSync(join(REPO_ROOT, "LICENSE"), "utf8");
    expect(text).toContain("MIT License");
    expect(text).toContain("Permission is hereby granted");
  });
});
