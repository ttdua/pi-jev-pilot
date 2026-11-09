import type { BeforeAgentStartEventResult } from "@earendil-works/pi-coding-agent";
import type { askJev, JevOutcome } from "../jev/client.ts";
import { skillBatchQuestions } from "../jev/questions.ts";
import { readAnswers, type QuestionSpec, type ReadResult } from "../policy/answers.ts";
import {
  deliveryForm,
  deliveryText,
  pickSkill,
  skillBatches,
  type SkillPick,
} from "../policy/skill.ts";
import {
  SKILL_MESSAGE_TYPE,
  explicitSkill,
  loadedSkills,
  readCatalog,
  type CatalogSkill,
  type SkillCommand,
} from "./skills.ts";

type Ask = typeof askJev;
/** Request fields shared by the main request and every later batch. */
export type CommonRequest = Omit<Parameters<Ask>[0], "questions">;
type SpecMap = Readonly<Record<string, QuestionSpec>>;
type AgentStartResult = BeforeAgentStartEventResult | undefined;

/** Where the skill catalog comes from. */
export type CatalogSource = {
  commands: () => readonly SkillCommand[];
  readFile: (path: string) => string;
};

/** Skill batches for this prompt; undefined when skills do not apply. A read failure means they do not. */
export function planSkills(
  prompt: string,
  enabled: boolean,
  source: CatalogSource,
): CatalogSkill[][] | undefined {
  if (!enabled || explicitSkill(prompt) !== undefined) return undefined;
  try {
    const catalog = readCatalog(source.commands(), source.readFile);
    const byName = new Map(catalog.map((skill) => [skill.name, skill]));
    const batches = skillBatches(catalog).map((batch) =>
      batch.flatMap((entry) => {
        const skill = byName.get(entry.name);
        return skill === undefined ? [] : [skill];
      }),
    );
    return batches.length === 0 ? undefined : batches;
  } catch {
    return undefined; // fail open: no catalog means no skill question
  }
}

const REQUEST_FAILED: JevOutcome = { kind: "miss", miss: "error", reason: "request failed", ms: 0 };

/**
 * One request per later batch, all started now; a rejection counts as a miss.
 * Undefined when building them threw, so the main request still proceeds.
 */
export function askLaterBatches(
  ask: Ask,
  batches: readonly CatalogSkill[][],
  common: CommonRequest,
): Promise<JevOutcome>[] | undefined {
  try {
    return batches.map((batch) =>
      ask({ ...common, questions: skillBatchQuestions(batch).wire }).catch(
        (): JevOutcome => REQUEST_FAILED,
      ),
    );
  } catch {
    return undefined; // the skill pick reads this as a failed batch
  }
}

function whichOptions(specs: SpecMap): readonly string[] {
  const which = specs["which"];
  return which?.type === "choice" ? which.options : [];
}

/** Pick one skill over the main reply and the later batches' replies; a cancel or miss reads as undefined. */
async function pickOverBatches(
  batches: readonly CatalogSkill[][],
  specs: SpecMap,
  mainRead: ReadResult | undefined,
  later: readonly Promise<JevOutcome>[] | undefined,
): Promise<SkillPick> {
  if (batches.length === 0) return pickSkill([]);
  // Later batches that could not be built mean a failed batch, hence no skill.
  if (later === undefined) return { kind: "none", reason: "failed" };
  const outcomes = await Promise.all(later);
  const rest = batches.slice(1).map((batch, i) => {
    const batchSpecs = skillBatchQuestions(batch).specs;
    const outcome = outcomes[i];
    return {
      options: whichOptions(batchSpecs),
      read: outcome?.kind === "ok" ? readAnswers(batchSpecs, outcome.body) : undefined,
    };
  });
  return pickSkill([{ options: whichOptions(specs), read: mainRead }, ...rest]);
}

/** A throw while picking means no pick; the effort decision still goes ahead. */
export async function pickSkillSafely(
  batches: readonly CatalogSkill[][],
  specs: SpecMap,
  mainRead: ReadResult | undefined,
  later: readonly Promise<JevOutcome>[] | undefined,
): Promise<SkillPick> {
  try {
    return await pickOverBatches(batches, specs, mainRead, later);
  } catch {
    return { kind: "none", reason: "failed" };
  }
}

/** What delivering a picked skill needs from the session. */
export type DeliveryContext = {
  inject: "content" | "suggest";
  /** Session projection entries, read only when a skill was picked. */
  entries: () => Parameters<typeof loadedSkills>[0];
};

/** The hidden `jev-skill` message for a picked skill; any failure means no message. */
export function skillMessage(
  pick: SkillPick,
  batches: readonly CatalogSkill[][],
  delivery: DeliveryContext,
): AgentStartResult {
  if (pick.kind !== "picked") return undefined;
  try {
    const catalog = batches.flat();
    const skill = catalog.find((s) => s.name === pick.name);
    if (skill === undefined) return undefined;
    const form = deliveryForm({
      name: skill.name,
      fingerprint: skill.fingerprint,
      inject: delivery.inject,
      loaded: loadedSkills(delivery.entries(), catalog),
    });
    return {
      message: {
        customType: SKILL_MESSAGE_TYPE,
        display: false,
        content: deliveryText(form, skill),
        details: { name: skill.name, fingerprint: skill.fingerprint, form },
      },
    };
  } catch {
    return undefined; // fail open: the turn goes ahead without the skill
  }
}

/** One hidden message per turn: the skill text first, then the advice. */
export function joinMessages(skill: AgentStartResult, advice: AgentStartResult): AgentStartResult {
  if (skill?.message === undefined) return advice;
  if (advice?.message === undefined) return skill;
  const skillText = skill.message.content;
  const adviceText = advice.message.content;
  // Both are built here as plain text; anything else keeps the skill alone rather than corrupt it.
  if (typeof skillText !== "string" || typeof adviceText !== "string") return skill;
  return { message: { ...skill.message, content: `${skillText}\n\n${adviceText}` } };
}
