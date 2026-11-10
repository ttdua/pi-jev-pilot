import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { jevDir } from "../src/host/platform/stores.ts";
import { REPO_ROOT, tempDir } from "./helpers.ts";

const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
const cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
});

describe("jevDir", () => {
  test("PI_CODING_AGENT_DIR moves the files", () => {
    const dir = tempDir("jev-host-");
    cleanup.push(dir);
    process.env.PI_CODING_AGENT_DIR = dir;
    expect(jevDir()).toBe(join(dir, "jev"));
  });

  test("Default location", () => {
    const home = tempDir("jev-home-");
    cleanup.push(home);
    // Bun's homedir() ignores an in-process HOME change, so ask a fresh process.
    const env: Record<string, string | undefined> = { ...process.env, HOME: home };
    delete env.PI_CODING_AGENT_DIR;
    const result = Bun.spawnSync(
      [
        process.execPath,
        "-e",
        `import { jevDir } from ${JSON.stringify(join(REPO_ROOT, "src", "host", "platform", "stores.ts"))}; process.stdout.write(jevDir());`,
      ],
      { cwd: REPO_ROOT, env: env as Record<string, string> },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe(join(home, ".pi", "agent", "jev"));
  });
});
