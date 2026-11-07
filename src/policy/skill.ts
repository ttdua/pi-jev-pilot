import { cutCodePoints } from "../shared/text.ts";

/** One catalog skill; `body` is already without frontmatter. */
export type SkillEntry = { name: string; description?: string; body?: string };

/** Option meaning "no skill fits". */
export const NONE_OPTION = "(none)";

/** Most options one request may carry. */
export const MAX_BATCH = 254;

const EXCERPT_LENGTH = 300;
const SEPARATOR = " — ";

/** Option text: trimmed description, then the body's first 300 code points. */
export function skillCriterion(entry: SkillEntry): string {
  const description = entry.description?.trim() ?? "";
  const excerpt = cutCodePoints(entry.body?.trim() ?? "", EXCERPT_LENGTH);
  const parts = [description, excerpt].filter((part) => part !== "");
  return parts.length === 0 ? `A skill named ${entry.name}.` : parts.join(SEPARATOR);
}

/** Catalog split into near-equal batches of at most `MAX_BATCH`, in order. */
export function skillBatches(entries: readonly SkillEntry[]): SkillEntry[][] {
  const seen = new Set<string>([NONE_OPTION]);
  const unique = entries.filter((entry) => {
    if (seen.has(entry.name)) return false;
    seen.add(entry.name);
    return true;
  });
  if (unique.length === 0) return [];
  const count = Math.ceil(unique.length / MAX_BATCH);
  const size = Math.ceil(unique.length / count);
  return Array.from({ length: count }, (_, i) => unique.slice(i * size, (i + 1) * size));
}
