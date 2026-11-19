// DEPRECATED(remove next minor): moves the pre-rename tier names on disk at the first main start.
import { join } from "node:path";
import { migrateConfigFile } from "../../store/config.ts";
import { migrateLegacySwitch } from "../../store/state-file.ts";

function renameLine(dir: string, renamed: readonly [string, string][]): string {
  const names = renamed.map(([from, to]) => `${from} → ${to}`).join(", ");
  return `Jev: renamed ${names} in ${join(dir, "config.json")}.`;
}

/**
 * Rewrites a valid config.json and state.json that still use the old tier names. Every failure is
 * swallowed (the read aliases keep working and the next start retries); a rewrite shows one notice.
 */
export function migrateLegacyNames(dir: string, notify: (message: string) => void): void {
  try {
    const config = migrateConfigFile(dir);
    if (config !== undefined && "renamed" in config) notify(renameLine(dir, config.renamed));
  } catch {
    /* swallow: the aliases keep working */
  }
  try {
    migrateLegacySwitch(dir);
  } catch {
    /* swallow: the alias keeps working */
  }
}
