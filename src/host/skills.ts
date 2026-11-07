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
