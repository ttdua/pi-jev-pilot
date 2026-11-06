import { expect, test } from "bun:test";

test("No timer left behind", () => {
  const probe = new URL("./no-timer-probe.ts", import.meta.url).pathname;
  const t0 = performance.now();
  const res = Bun.spawnSync([process.execPath, probe], { timeout: 10_000 });
  expect(res.exitCode).toBe(0);
  expect(performance.now() - t0).toBeLessThan(10_000);
});
