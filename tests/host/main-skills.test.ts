import { describe, expect, test } from "bun:test";
import type { JevOutcome } from "../../src/jev/client.ts";
import { skillBatchQuestions } from "../../src/jev/questions.ts";
import {
  askLaterBatches,
  joinMessages,
  pickSkillSafely,
  planSkills,
  skillMessage,
} from "../../src/host/main-skills.ts";
import { skillBlock, type CatalogSkill, type SkillCommand } from "../../src/host/skills.ts";

const command = (name: string): SkillCommand => ({
  name: `skill:${name}`,
  source: "skill",
  description: `Use for ${name}.`,
  sourceInfo: { path: `/s/${name}/SKILL.md`, baseDir: `/s/${name}` },
});
const readFile = (path: string): string => {
  const name = path.split("/")[2]!;
  return `---\nname: ${name}\n---\nDo ${name}.`;
};
const catalogSkill = (name: string): CatalogSkill => ({
  name,
  description: `Use for ${name}.`,
  body: `Do ${name}.`,
  path: `/s/${name}/SKILL.md`,
  baseDir: `/s/${name}`,
  fingerprint: `fp-${name}`,
});
const which = (choice: string, p: number): JevOutcome => ({
  kind: "ok",
  ms: 3,
  body: {
    answers: {
      which: { type: "choice", choice, probabilities: { [choice]: p, "(none)": 1 - p } },
    },
  },
});
const common = { url: "http://127.0.0.1:1", apiKey: "k", model: "m", timeoutMs: 100, state: {} };

describe("planSkills", () => {
  const source = { commands: () => [command("debug")], readFile };

  test("returns one batch with the catalog skill when skills are on", () => {
    const batches = planSkills("fix the bug", true, source);
    expect(batches?.map((batch) => batch.map((skill) => skill.name))).toEqual([["debug"]]);
  });

  test("returns undefined when skills are off", () => {
    expect(planSkills("fix the bug", false, source)).toBeUndefined();
  });

  test("returns undefined when the prompt starts with an expanded skill block", () => {
    const block = skillBlock({ ...catalogSkill("debug"), body: "x" });
    expect(planSkills(`${block}\n\nnow`, true, source)).toBeUndefined();
  });

  test("returns undefined when the catalog is empty", () => {
    expect(planSkills("fix", true, { commands: () => [], readFile })).toBeUndefined();
  });

  test("returns undefined when reading the catalog throws", () => {
    const failing = {
      commands: () => {
        throw new Error("no commands");
      },
      readFile,
    };
    expect(planSkills("fix", true, failing)).toBeUndefined();
  });
});

describe("askLaterBatches", () => {
  test("starts one request per batch with that batch's questions", async () => {
    const asked: unknown[] = [];
    const ask = async (req: { questions: unknown }): Promise<JevOutcome> => {
      asked.push(req.questions);
      return which("debug", 0.9);
    };
    const later = askLaterBatches(ask as never, [[catalogSkill("debug")]], common);
    expect(later).toHaveLength(1);
    await Promise.all(later!);
    expect(asked).toEqual([skillBatchQuestions([catalogSkill("debug")]).wire]);
  });

  test("turns a rejected request into a miss", async () => {
    const ask = async (): Promise<JevOutcome> => {
      throw new Error("network");
    };
    const later = askLaterBatches(ask as never, [[catalogSkill("debug")]], common);
    expect(await later![0]).toEqual({
      kind: "miss",
      miss: "error",
      reason: "request failed",
      ms: 0,
    });
  });

  test("returns undefined when building the requests throws", () => {
    const ask = (): Promise<JevOutcome> => {
      throw new Error("sync failure");
    };
    expect(askLaterBatches(ask as never, [[catalogSkill("debug")]], common)).toBeUndefined();
  });
});

describe("pickSkillSafely", () => {
  const batches = [[catalogSkill("debug")], [catalogSkill("deploy")]];
  const specs = skillBatchQuestions(batches[0]!).specs;
  const mainRead = { kind: "read", answers: {}, unanswered: {} } as const;

  test("returns no-batch without any batch", async () => {
    expect(await pickSkillSafely([], specs, undefined, [])).toEqual({
      kind: "none",
      reason: "no-batch",
    });
  });

  test("returns failed when the later requests could not be built", async () => {
    expect(await pickSkillSafely(batches, specs, mainRead, undefined)).toEqual({
      kind: "none",
      reason: "failed",
    });
  });

  test("picks a sure leader from a later batch", async () => {
    const read = {
      kind: "read",
      answers: (which("debug", 0.1) as { body: { answers: never } }).body.answers,
      unanswered: {},
    } as const;
    const pick = await pickSkillSafely(batches, specs, read, [
      Promise.resolve(which("deploy", 0.95)),
    ]);
    expect(pick).toMatchObject({ kind: "picked", name: "deploy" });
  });

  test("returns failed when a later request rejects", async () => {
    const pick = await pickSkillSafely(batches, specs, mainRead, [Promise.reject(new Error("x"))]);
    expect(pick).toEqual({ kind: "none", reason: "failed" });
  });
});

describe("skillMessage", () => {
  const batches = [[catalogSkill("debug")]];
  const picked = { kind: "picked", name: "debug", p: 0.95 } as const;

  test("returns a hidden content message for a picked skill", () => {
    const result = skillMessage(picked, batches, { inject: "content", entries: () => [] });
    expect(result?.message).toMatchObject({
      customType: "jev-skill",
      display: false,
      details: { name: "debug", fingerprint: "fp-debug", form: "content" },
    });
  });

  test("returns undefined when nothing was picked", () => {
    const none = { kind: "none", reason: "no-batch" } as const;
    expect(skillMessage(none, batches, { inject: "content", entries: () => [] })).toBeUndefined();
  });

  test("returns undefined when the picked name is not in the catalog", () => {
    const other = { ...picked, name: "deploy" };
    expect(skillMessage(other, batches, { inject: "content", entries: () => [] })).toBeUndefined();
  });

  test("returns undefined when reading the session entries throws", () => {
    const entries = () => {
      throw new Error("no projection");
    };
    expect(skillMessage(picked, batches, { inject: "content", entries })).toBeUndefined();
  });
});

describe("joinMessages", () => {
  type Result = Parameters<typeof joinMessages>[0];
  const message = (customType: string, content: unknown): Result =>
    ({ message: { customType, content, display: false } }) as Result;

  test("returns the advice alone without a skill message", () => {
    const advice = message("jev-advice", "advice");
    expect(joinMessages(undefined, advice)).toBe(advice);
  });

  test("returns the skill alone without advice", () => {
    const skill = message("jev-skill", "skill");
    expect(joinMessages(skill, undefined)).toBe(skill);
  });

  test("puts the skill text first, then the advice, in the skill message", () => {
    const joined = joinMessages(message("jev-skill", "skill"), message("jev-advice", "advice"));
    expect(joined?.message).toMatchObject({ customType: "jev-skill", content: "skill\n\nadvice" });
  });

  test("keeps the skill alone when either content is not plain text", () => {
    const skill = message("jev-skill", "skill");
    expect(joinMessages(skill, message("jev-advice", [{ type: "text" }]))).toBe(skill);
  });
});
