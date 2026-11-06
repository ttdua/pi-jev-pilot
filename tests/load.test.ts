import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { PI_BIN, REPO_ROOT, run, tempDir } from "./helpers";

type LoadExtensionsResult = ReturnType<DefaultResourceLoader["getExtensions"]>;

const cleanup: string[] = [];
const previousOffline = process.env.PI_OFFLINE;

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (previousOffline === undefined) delete process.env.PI_OFFLINE;
  else process.env.PI_OFFLINE = previousOffline;
});

async function installAndLoad(pkgDir: string): Promise<LoadExtensionsResult> {
  const tmpCwd = tempDir("jev-cwd-");
  const agentDir = tempDir("jev-agent-");
  cleanup.push(tmpCwd, agentDir);
  const installed = run([PI_BIN, "install", pkgDir], {
    cwd: tmpCwd,
    env: { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" },
  });
  expect(installed.code).toBe(0);
  process.env.PI_OFFLINE = "1";
  const settingsManager = SettingsManager.create(tmpCwd, agentDir);
  const loader = new DefaultResourceLoader({ cwd: tmpCwd, agentDir, settingsManager });
  await loader.reload();
  return loader.getExtensions();
}

function resolvesTo(path: string, target: string): boolean {
  try {
    return realpathSync(path) === realpathSync(target);
  } catch {
    return false;
  }
}

describe("package loading", () => {
  const entry = join(REPO_ROOT, "src", "extension.ts");

  test("installed checkout is loaded", async () => {
    const result = await installAndLoad(REPO_ROOT);
    expect(result.errors).toEqual([]);
    const matches = result.extensions.filter((e) => resolvesTo(e.resolvedPath, entry));
    expect(matches.length).toBe(1);
  }, 60_000);

  test("loaded extension registers only /jev and handlers", async () => {
    const result = await installAndLoad(REPO_ROOT);
    const ext = result.extensions.find((e) => resolvesTo(e.resolvedPath, entry));
    expect(ext).toBeDefined();
    expect([...(ext?.handlers.keys() ?? [])].sort()).toEqual([
      "agent_settled",
      "before_agent_start",
      "before_provider_request",
      "session_shutdown",
      "session_start",
      "turn_end",
    ]);
    expect([...(ext?.tools.keys() ?? [])]).toEqual(["jev_review"]);
    expect([...(ext?.commands.keys() ?? [])]).toEqual(["jev"]);
    expect(ext?.flags.size).toBe(0);
    expect(ext?.shortcuts.size).toBe(0);
  }, 60_000);

  test("failing entry point is not reported as loaded", async () => {
    const fixture = join(REPO_ROOT, "tests", "fixtures", "throwing-extension");
    const target = join(fixture, "index.ts");
    const result = await installAndLoad(fixture);
    expect(result.extensions.filter((e) => resolvesTo(e.resolvedPath, target))).toEqual([]);
    expect(result.errors.filter((e) => resolvesTo(e.path, target)).length).toBe(1);
  }, 60_000);
});
