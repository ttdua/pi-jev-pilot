// DEPRECATED(remove next minor): moves the pre-rename tier names and retired CLI review keys off disk at the first main start.
import { join } from "node:path";
import { migrateConfigFile } from "../../store/config.ts";
import { migrateLegacySwitch, migrateRetiredStateFields } from "../../store/state-file.ts";

type Changes = {
  renamed: readonly [string, string][];
  removed: readonly string[];
};

function noticeLine(dir: string, c: Changes): string {
  const parts = [
    ...(c.renamed.length > 0
      ? [`renamed ${c.renamed.map(([a, b]) => `${a} → ${b}`).join(", ")}`]
      : []),
    ...(c.removed.length > 0 ? [`removed ${c.removed.join(", ")}`] : []),
  ];
  return `Jev: ${parts.join("; ")} in ${join(dir, "config.json")}.`;
}

/**
 * Rewrites a valid config.json and state.json that still use the old tier names or hold the
 * retired CLI review keys. Every failure is swallowed (the read aliases keep working and the next
 * start retries); a config rewrite shows one notice.
 */
export function migrateLegacyNames(dir: string, notify: (message: string) => void): void {
  try {
    const config = migrateConfigFile(dir);
    if (config !== undefined && "renamed" in config) notify(noticeLine(dir, config));
  } catch {
    /* swallow: the aliases keep working */
  }
  try {
    migrateLegacySwitch(dir);
  } catch {
    /* swallow: the alias keeps working */
  }
  try {
    migrateRetiredStateFields(dir);
  } catch {
    /* swallow: the retired fields are ignored on read */
  }
}
