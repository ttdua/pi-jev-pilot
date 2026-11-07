import { describe, expect, test } from "bun:test";
import { explicitSkill, fingerprint, skillBlock } from "../../src/host/skills.ts";

const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("explicitSkill", () => {
  test("Operator loads a skill", () => {
    const block = skillBlock({
      name: "debug",
      path: "/s/debug/SKILL.md",
      baseDir: "/s/debug",
      body: "Step.",
    });
    expect(explicitSkill(`${block}\n\nfix the test`)).toBe("debug");
  });

  test("Skill block later in the prompt", () => {
    expect(
      explicitSkill('see <skill name="debug" location="/x">\nReferences are relative to /x.'),
    ).toBeUndefined();
  });

  test("Unexpanded skill command", () => {
    expect(explicitSkill("/skill:unknown do it")).toBeUndefined();
  });

  test("Not Pi's block", () => {
    expect(explicitSkill('<skill name="debug" location="/x">\nbody')).toBeUndefined();
  });
});

describe("fingerprint", () => {
  test("same body gives the same 64-hex value", () => {
    expect(fingerprint("abc")).toBe(fingerprint("abc"));
    expect(fingerprint("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  test("one-character change differs", () => {
    expect(fingerprint("abc")).not.toBe(fingerprint("abd"));
  });

  test("empty string is the SHA-256 of nothing", () => {
    expect(fingerprint("")).toBe(EMPTY_SHA);
  });
});

describe("skillBlock", () => {
  test("matches the Pi 1.5.0 format", () => {
    const out = skillBlock({
      name: "debug",
      path: "/s/debug/SKILL.md",
      baseDir: "/s/debug",
      body: "Step.",
    });
    expect(out).toBe(
      '<skill name="debug" location="/s/debug/SKILL.md">\nReferences are relative to /s/debug.\n\nStep.\n</skill>',
    );
  });

  test("$& in the path survives", () => {
    const out = skillBlock({ name: "d", path: "/a$&b/SKILL.md", baseDir: "/a$&b", body: "x" });
    expect(out).toContain('location="/a$&b/SKILL.md"');
    expect(out).toContain("relative to /a$&b.");
  });
});
