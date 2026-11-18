import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createForkSessionManager } from "#src/session/fork-session-manager";

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const user = (text: string) => ({ role: "user" as const, content: text, timestamp: 1 });
const assistant = (text: string) =>
  ({ role: "assistant" as const, content: [{ type: "text", text }], api: "openai-completions", provider: "p", model: "m", usage, stopReason: "stop", timestamp: 2 }) as never;

describe("createForkSessionManager", () => {
  let root: string;
  let parent: SessionManager;
  let keptId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "fork-sm-"));
    mkdirSync(join(root, "parent"), { recursive: true });
    parent = SessionManager.create(root, join(root, "parent"));
    parent.appendMessage(user("OLD-1"));
    parent.appendMessage(assistant("OLD-A"));
    keptId = parent.appendMessage(user("KEPT-1"));
    parent.appendMessage(assistant("KEPT-A"));
    parent.appendCompaction("SUMMARY-MARKER", keptId, 100);
    parent.appendMessage(user("AFTER"));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const fork = () => createForkSessionManager(root, join(root, "forks"), parent.getSessionId(), parent.getBranch());

  it("two forks from one branch get their own ids and files, and never the parent's", () => {
    const [a, b] = [fork(), fork()];
    const ids = [a.getSessionId(), b.getSessionId(), parent.getSessionId()];
    expect(new Set(ids).size).toBe(3);
    expect(new Set([a.getSessionFile(), b.getSessionFile(), parent.getSessionFile()]).size).toBe(3);
    for (const child of [a, b]) {
      const header = JSON.parse(readFileSync(child.getSessionFile()!, "utf8").split("\n")[0]!);
      expect(header.id).toBe(child.getSessionId());
      expect(header.parentSession).toBe(parent.getSessionId());
      expect(child.getBranch().map((entry) => entry.id)).toEqual(parent.getBranch().map((entry) => entry.id));
    }
    expect(existsSync(parent.getSessionFile()!)).toBe(true);
  });

  it("replays compaction after open: the summary, the kept entries and what follows, not the dropped ones", () => {
    const messages = JSON.stringify(fork().buildSessionContext().messages);
    expect(messages).toContain("SUMMARY-MARKER");
    expect(messages).toContain("KEPT-1");
    expect(messages).toContain("AFTER");
    expect(messages).not.toContain("OLD-1");
    expect(JSON.stringify(fork().buildSessionContext().messages)).toBe(JSON.stringify(parent.buildSessionContext().messages));
  });
});
