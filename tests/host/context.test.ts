import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { branchItems, previousTurnId, scanPlatforms } from "../../src/host/context.ts";

const e = (x: unknown) => x as SessionEntry;
const msg = (message: unknown) => e({ type: "message", message });

describe("branchItems", () => {
  test("user text and image parts", () => {
    const items = branchItems([
      msg({ role: "user", content: "hello" }),
      msg({
        role: "user",
        content: [
          { type: "text", text: "a" },
          { type: "image", data: "xx", mimeType: "image/png" },
          { type: "text", text: "b" },
        ],
      }),
    ]);
    expect(items).toEqual([
      { role: "user", text: "hello", tools: [] },
      { role: "user", text: "a\nb", tools: [] },
    ]);
  });

  test("assistant text only plus tool names; failed marking", () => {
    const items = branchItems([
      msg({
        role: "assistant",
        content: [
          { type: "thinking", thinking: "secret" },
          { type: "text", text: "doing" },
          { type: "toolCall", id: "c1", name: "bash", arguments: { cmd: "rm" } },
          { type: "toolCall", id: "c2", name: "read", arguments: {} },
        ],
      }),
      msg({
        role: "toolResult",
        toolCallId: "c1",
        toolName: "bash",
        isError: true,
        content: [{ type: "text", text: "boom" }],
      }),
      msg({ role: "toolResult", toolCallId: "c2", toolName: "read", isError: false, content: [] }),
    ]);
    expect(items).toEqual([
      {
        role: "assistant",
        text: "doing",
        tools: [{ name: "bash", failed: true }, { name: "read" }],
      },
      { role: "toolResult", text: "", tools: [], isError: true },
      { role: "toolResult", text: "", tools: [] },
    ]);
  });

  test("non-message entries and other roles produce nothing", () => {
    const items = branchItems([
      e({ type: "custom_message", customType: "x", content: "injected" }),
      e({ type: "custom", customType: "jev-turn", data: { turnId: "T" } }),
      e({ type: "thinking_level_change", thinkingLevel: "high" }),
      e({ type: "model_change", provider: "p", modelId: "m" }),
      e({ type: "compaction", summary: "s" }),
      e({ type: "branch_summary", summary: "s" }),
      e({ type: "label", label: "l" }),
      msg({ role: "bashExecution", command: "ls" }),
      msg({ role: "custom", content: "x" }),
    ]);
    expect(items).toEqual([]);
  });
});

describe("previousTurnId", () => {
  const turn = (turnId: unknown) => e({ type: "custom", customType: "jev-turn", data: { turnId } });
  test("later id wins", () =>
    expect(previousTurnId([turn("T1"), msg({ role: "user", content: "x" }), turn("T2")])).toBe(
      "T2",
    ));
  test("branch ending at T1", () =>
    expect(previousTurnId([msg({ role: "user", content: "x" }), turn("T1")])).toBe("T1"));
  test("non-string id ignored", () => expect(previousTurnId([turn(7)])).toBeUndefined());
  test("none", () => expect(previousTurnId([msg({ role: "user", content: "x" })])).toBeUndefined());
});

describe("scanPlatforms", () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "ctx-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      try {
        chmodSync(join(d, "locked"), 0o755);
      } catch {}
      rmSync(d, { recursive: true, force: true });
    }
  });
  const touch = (root: string, rel: string) => {
    const p = join(root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, "");
  };

  test("Dockerfile and workflows", () => {
    const d = tmp();
    touch(d, "Dockerfile");
    mkdirSync(join(d, ".github/workflows"), { recursive: true });
    expect(scanPlatforms(d)).toEqual(["Docker", "GitHub Actions"]);
  });
  test("one level down counts", () => {
    const d = tmp();
    touch(d, "web/vercel.json");
    expect(scanPlatforms(d)).toEqual(["Vercel"]);
  });
  test("two levels down does not", () => {
    const d = tmp();
    touch(d, "apps/web/vercel.json");
    expect(scanPlatforms(d)).toEqual(["none found"]);
  });
  test("skipped directories", () => {
    const d = tmp();
    touch(d, "node_modules/fly.toml");
    expect(scanPlatforms(d)).toEqual(["none found"]);
  });
  test("path markers one level down", () => {
    const d = tmp();
    touch(d, "svc/supabase/config.toml");
    expect(scanPlatforms(d)).toEqual(["Supabase"]);
  });
  test("symlinked directory not followed", () => {
    const d = tmp();
    const other = tmp();
    touch(other, "fly.toml");
    symlinkSync(other, join(d, "link"));
    expect(scanPlatforms(d)).toEqual(["none found"]);
  });
  test.skipIf(process.getuid?.() === 0)("unreadable subdirectory does not throw", () => {
    const d = tmp();
    mkdirSync(join(d, "locked"));
    touch(d, "fly.toml");
    chmodSync(join(d, "locked"), 0);
    expect(scanPlatforms(d)).toEqual(["Fly.io"]);
  });
  test("missing cwd does not throw", () => {
    expect(scanPlatforms("/nonexistent-dir-xyz")).toEqual(["none found"]);
  });
});
