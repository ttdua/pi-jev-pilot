import { createHash } from "node:crypto";

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
