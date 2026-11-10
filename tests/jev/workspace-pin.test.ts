import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanPlatforms } from "../../src/jev/workspace.ts";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "ws-pin-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      chmodSync(join(d, "locked"), 0o755);
    } catch {
      // the dir may not exist in this test; nothing to restore
    }
    rmSync(d, { recursive: true, force: true });
  }
});
const touch = (root: string, rel: string) => {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, "");
};
const mk = (root: string, rel: string) => mkdirSync(join(root, rel), { recursive: true });

describe("scanPlatforms pin", () => {
  test("empty directory and missing directory report none found", () => {
    expect(scanPlatforms(tmp())).toEqual(["none found"]);
    expect(scanPlatforms(join(tmp(), "nope"))).toEqual(["none found"]);
  });

  test("results follow marker order, not discovery order", () => {
    const d = tmp();
    touch(d, "web/bitbucket-pipelines.yml");
    touch(d, "Dockerfile");
    touch(d, "api/fly.toml");
    touch(d, "vercel.json");
    expect(scanPlatforms(d)).toEqual(["Vercel", "Fly.io", "Docker", "Bitbucket Pipelines"]);
  });

  test("every file-name marker matches", () => {
    const names: [string, string][] = [
      ["vercel.json", "Vercel"],
      ["cdk.json", "AWS CDK"],
      ["serverless.yaml", "AWS Serverless"],
      ["template.yml", "AWS SAM"],
      ["samconfig.toml", "AWS SAM"],
      ["buildspec.yaml", "AWS CodeBuild"],
      ["amplify.yml", "AWS Amplify"],
      ["netlify.toml", "Netlify"],
      ["firebase.json", "Firebase"],
      ["fly.toml", "Fly.io"],
      ["wrangler.jsonc", "Cloudflare Workers"],
      ["cloudbuild.yaml", "Google Cloud"],
      ["render.yaml", "Render"],
      ["railway.toml", "Railway"],
      ["docker-compose.yml", "Docker Compose"],
      ["compose.yaml", "Docker Compose"],
      ["Dockerfile", "Docker"],
    ];
    for (const [file, platform] of names) {
      const d = tmp();
      touch(d, file);
      expect(scanPlatforms(d)).toEqual([platform]);
    }
  });

  test("directory markers match directories only, file markers files only", () => {
    const a = tmp();
    mk(a, ".vercel");
    mk(a, "amplify");
    expect(scanPlatforms(a)).toEqual(["Vercel", "AWS Amplify"]);
    const b = tmp();
    touch(b, ".vercel");
    touch(b, "amplify");
    mk(b, "Dockerfile");
    mk(b, "vercel.json");
    expect(scanPlatforms(b)).toEqual(["none found"]);
  });

  test("path markers: supabase config.toml is a file, workflows is a directory", () => {
    const a = tmp();
    touch(a, "supabase/config.toml");
    mk(a, ".github/workflows");
    expect(scanPlatforms(a)).toEqual(["Supabase", "GitHub Actions"]);
    const b = tmp();
    mk(b, "supabase/config.toml");
    touch(b, ".github/workflows");
    expect(scanPlatforms(b)).toEqual(["none found"]);
  });

  test("path markers resolve one level below too", () => {
    const d = tmp();
    touch(d, "svc/supabase/config.toml");
    mk(d, "svc/.github/workflows");
    expect(scanPlatforms(d)).toEqual(["Supabase", "GitHub Actions"]);
  });

  test("two levels below does not count", () => {
    const d = tmp();
    touch(d, "a/b/Dockerfile");
    expect(scanPlatforms(d)).toEqual(["none found"]);
  });

  test("skipped directories are not scanned", () => {
    const d = tmp();
    for (const s of [
      "node_modules",
      ".git",
      "dist",
      "build",
      ".next",
      "out",
      "cdk.out",
      "vendor",
      "target",
      ".venv",
      "venv",
      "__pycache__",
      "coverage",
    ])
      touch(d, `${s}/Dockerfile`);
    expect(scanPlatforms(d)).toEqual(["none found"]);
  });

  test("symlinked directories and symlinked marker files are ignored", () => {
    const d = tmp();
    const outside = tmp();
    touch(outside, "Dockerfile");
    symlinkSync(outside, join(d, "linked"));
    symlinkSync(join(outside, "Dockerfile"), join(d, "Dockerfile"));
    expect(scanPlatforms(d)).toEqual(["none found"]);
  });

  test("an unreadable subdirectory is skipped and the rest still scanned", () => {
    const d = tmp();
    mk(d, "locked");
    touch(d, "locked/Dockerfile");
    chmodSync(join(d, "locked"), 0o000);
    touch(d, "ok/fly.toml");
    expect(scanPlatforms(d)).toEqual(["Fly.io"]);
  });

  test("a platform found at the root and below appears once", () => {
    const d = tmp();
    touch(d, "Dockerfile");
    touch(d, "a/Dockerfile");
    touch(d, "b/Dockerfile");
    expect(scanPlatforms(d)).toEqual(["Docker"]);
  });

  test("plain files at root level are not treated as scan roots", () => {
    const d = tmp();
    touch(d, "fly.toml/x");
    writeFileSync(join(d, "plain"), "");
    expect(scanPlatforms(d)).toEqual(["none found"]);
  });
});
