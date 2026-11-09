import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { parseFrontmatter, stripFrontmatter } from "@earendil-works/pi-coding-agent";
import { SKILL_NAME } from "../store/ledger-schema.ts";

export const SKILL_MESSAGE_TYPE = "jev-skill";

const EXPLICIT = /^<skill name="([^"]*)" location="[^"]*">\nReferences are relative to /;

/** Lowercase hex SHA-256 of the UTF-8 body. */
export function fingerprint(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/** Pi 1.5.0's `_expandSkillCommand` block, built by join so `$&` in paths survives. */
export function skillBlock(s: {
  name: string;
  path: string;
  baseDir: string;
  body: string;
}): string {
  return [
    `<skill name="${s.name}" location="${s.path}">`,
    `References are relative to ${s.baseDir}.`,
    "",
    s.body,
    "</skill>",
  ].join("\n");
}

/** Skill name when the prompt starts with a Pi-expanded skill block. */
export function explicitSkill(prompt: string): string | undefined {
  return EXPLICIT.exec(prompt)?.[1];
}

export type SkillCommand = {
  name: string;
  description?: string;
  source: string;
  sourceInfo?: { path?: string; baseDir?: string };
};

export type CatalogSkill = {
  name: string;
  description?: string;
  body: string;
  path: string;
  baseDir: string;
  fingerprint: string;
};

const PREFIX = "skill:";

function toCatalogSkill(
  command: SkillCommand,
  read: (path: string) => string,
): CatalogSkill | undefined {
  if (command.source !== "skill" || !command.name.startsWith(PREFIX)) return undefined;
  const name = command.name.slice(PREFIX.length);
  const path = command.sourceInfo?.path;
  if (!path || !SKILL_NAME.test(name)) return undefined;
  try {
    const raw = read(path);
    if (parseFrontmatter(raw).frontmatter["disable-model-invocation"] === true) return undefined;
    const body = stripFrontmatter(raw).trim();
    return {
      name,
      ...(command.description === undefined ? {} : { description: command.description }),
      body,
      path,
      baseDir: dirname(path),
      fingerprint: fingerprint(body),
    };
  } catch {
    return undefined;
  }
}

/** Skills Pi lists that the host may offer; unreadable or unrecordable ones are dropped. */
export function readCatalog(
  commands: readonly SkillCommand[],
  read: (path: string) => string,
): CatalogSkill[] {
  const out: CatalogSkill[] = [];
  for (const command of commands) {
    const skill = toCatalogSkill(command, read);
    if (skill) out.push(skill);
  }
  return out;
}

type ProjectionEntry = { sourceEntry: unknown; messages: readonly unknown[] };
type Loaded = { name: string; fingerprint: string };

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function sameContent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false; // circular or BigInt content cannot be compared
  }
}

/** Fingerprint reported for an explicit skill block whose body no longer matches the catalog. */
const STALE_FINGERPRINT = "stale";

/** A `jev-skill` message that reached the model with its body, unchanged by any context edit. */
function deliveredSkill(entry: ProjectionEntry): Loaded | undefined {
  const source = record(entry.sourceEntry);
  if (source?.type !== "custom_message" || source.customType !== SKILL_MESSAGE_TYPE)
    return undefined;
  const details = record(source.details);
  if (details?.form !== "content") return undefined;
  const { name, fingerprint: print } = details;
  if (typeof name !== "string" || typeof print !== "string") return undefined;
  if (entry.messages.length !== 1) return undefined;
  if (!sameContent(record(entry.messages[0])?.content, source.content)) return undefined;
  return { name, fingerprint: print };
}

/** A user prompt that starts with a Pi-expanded skill block; an outdated body is `STALE_FINGERPRINT`. */
function explicitLoaded(
  entry: ProjectionEntry,
  catalog: readonly CatalogSkill[],
): Loaded | undefined {
  if (entry.messages.length !== 1) return undefined;
  const message = record(entry.messages[0]);
  if (message?.role !== "user") return undefined;
  const content = message.content;
  let text: unknown = content;
  if (Array.isArray(content)) {
    text = content.map(record).find((part) => part?.type === "text")?.text;
  }
  if (typeof text !== "string") return undefined;
  const name = explicitSkill(text);
  const skill = catalog.find((s) => s.name === name);
  if (!skill) return undefined;
  return {
    name: skill.name,
    fingerprint: text.startsWith(skillBlock(skill)) ? skill.fingerprint : STALE_FINGERPRINT,
  };
}

/** Skills whose body is in the model's context, from `buildSessionProjection().entries`. */
export function loadedSkills(
  entries: readonly ProjectionEntry[],
  catalog: readonly CatalogSkill[],
): Loaded[] {
  const out: Loaded[] = [];
  for (const entry of entries) {
    const loaded = deliveredSkill(entry) ?? explicitLoaded(entry, catalog);
    if (loaded) out.push(loaded);
  }
  return out;
}
