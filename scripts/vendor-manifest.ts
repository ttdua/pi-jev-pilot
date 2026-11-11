/**
 * Writes packages/pi-subagents/.upstream-manifest: one `path sha` line per blob in the given
 * upstream split commit. Usage: bun scripts/vendor-manifest.ts <upstream-tree-commit>
 */
import { join } from "node:path";

const commit = process.argv[2];
if (commit === undefined) {
  console.error("usage: bun scripts/vendor-manifest.ts <upstream-tree-commit>");
  process.exit(2);
}

const root = join(import.meta.dir, "..");
const listing = Bun.spawnSync(["git", "ls-tree", "-r", commit], { cwd: root });
if (listing.exitCode !== 0) {
  console.error(listing.stderr.toString());
  process.exit(1);
}

const lines = listing.stdout
  .toString()
  .split("\n")
  .filter((line) => line !== "")
  .map((line) => {
    const [meta, path] = line.split("\t");
    return `${path} ${meta?.split(" ")[2]}`;
  });

await Bun.write(
  join(root, "packages", "pi-subagents", ".upstream-manifest"),
  `${lines.join("\n")}\n`,
);
console.log(`wrote ${lines.length} entries`);
