import { describe, expect, test } from "bun:test";
import { parseFrontmatter, stripFrontmatter } from "@earendil-works/pi-coding-agent";
import {
  explicitSkill,
  fingerprint,
  readCatalog,
  skillBlock,
  type SkillCommand,
} from "../../src/host/skills.ts";

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

describe("readCatalog", () => {
  const reader = (files: Record<string, string>) => (path: string) => {
    const text = files[path];
    if (text === undefined) throw new Error(`ENOENT ${path}`);
    return text;
  };
  const cmd = (name: string, path?: string, extra: Partial<SkillCommand> = {}): SkillCommand => ({
    name: `skill:${name}`,
    description: `${name} desc`,
    source: "skill",
    ...(path ? { sourceInfo: { path, baseDir: "/a" } } : {}),
    ...extra,
  });
  const files = {
    "/a/skills/debug/SKILL.md": "---\nname: debug\n---\n\n  Debug body.\n\n",
    "/a/skills/plan/SKILL.md": "---\nname: plan\n---\nPlan body.",
  };
  const two = [cmd("debug", "/a/skills/debug/SKILL.md"), cmd("plan", "/a/skills/plan/SKILL.md")];

  test("Skills listed by Pi", () => {
    const out = readCatalog(two, reader(files));
    expect(out.map((s) => s.name)).toEqual(["debug", "plan"]);
    const body = "Debug body.";
    expect(out[0]).toEqual({
      name: "debug",
      description: "debug desc",
      body,
      path: "/a/skills/debug/SKILL.md",
      baseDir: "/a/skills/debug",
      fingerprint: fingerprint(body),
    });
  });

  test("Package base directory", () => {
    const withBase = readCatalog([two[0]!], reader(files));
    expect(withBase[0]?.baseDir).toBe("/a/skills/debug");
    const noBase = readCatalog(
      [cmd("debug", undefined, { sourceInfo: { path: "/a/skills/debug/SKILL.md" } })],
      reader(files),
    );
    expect(noBase[0]?.baseDir).toBe("/a/skills/debug");
  });

  test("Model invocation disabled", () => {
    const f = {
      ...files,
      "/a/skills/plan/SKILL.md": "---\ndisable-model-invocation: true\n---\nPlan body.",
    };
    expect(readCatalog(two, reader(f)).map((s) => s.name)).toEqual(["debug"]);
  });

  test("Unreadable file", () => {
    const { "/a/skills/plan/SKILL.md": _gone, ...rest } = files;
    expect(readCatalog(two, reader(rest)).map((s) => s.name)).toEqual(["debug"]);
  });

  test("Malformed frontmatter", () => {
    const bad = "---\na: [\n---\nbody";
    expect(() => parseFrontmatter(bad)).toThrow();
    const f = { ...files, "/a/skills/plan/SKILL.md": bad };
    expect(readCatalog(two, reader(f)).map((s) => s.name)).toEqual(["debug"]);
  });

  test("Name the ledger cannot record", () => {
    const long = "a".repeat(65);
    const f = { ...files, "/x/A/SKILL.md": "body", "/x/L/SKILL.md": "body" };
    const out = readCatalog(
      [cmd("My_Skill", "/x/A/SKILL.md"), cmd(long, "/x/L/SKILL.md"), two[0]!],
      reader(f),
    );
    expect(out.map((s) => s.name)).toEqual(["debug"]);
  });

  test("Other commands", () => {
    const out = readCatalog(
      [
        cmd("debug", "/a/skills/debug/SKILL.md", { source: "extension" }),
        cmd("debug", "/a/skills/debug/SKILL.md", { source: "prompt" }),
        cmd("debug"),
        two[1]!,
      ],
      reader(files),
    );
    expect(out.map((s) => s.name)).toEqual(["plan"]);
  });

  test("Same body as Pi", () => {
    const raw = "---\nname: debug\n---\n\n  Step one.\n\n";
    const out = readCatalog([cmd("debug", "/d/SKILL.md")], reader({ "/d/SKILL.md": raw }));
    expect(out[0]?.body).toBe(stripFrontmatter(raw).trim());
  });
});
