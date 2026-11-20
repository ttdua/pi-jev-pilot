export type ReleaseFiles = {
  pkg: string;
  changelog: string;
  docs: Record<string, string>;
};

const REPO_INSTALL = /pi install git:github\.com\/ttdua\/pi-jev-pilot(\S*)/g;
const EXECUTOR_INSTALL = /pi install git:github\.com\/ttdua\/pi-subagents(\S*)/g;
const INSTALL_FILES = ["README.md", "docs/usage-guide.md"];
const USER_DOCS = ["README.md", "docs/scenarios.md"];
const OFF_SWITCHES = [
  "/jev effort off",
  "/jev subagents off",
  "/jev skills off",
  "/jev strategy off",
  "/jev frontier off",
];
const BANNERS = [
  "design phase",
  "no code yet",
  "Nothing is installable",
  "describes the planned behavior",
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function checkChangelog(changelog: string, version: string): string[] {
  const heading = new RegExp(`^## \\[${escapeRegExp(version)}\\]`, "m").exec(changelog);
  if (!heading) return [`CHANGELOG.md has no entry for ${version}`];
  const rest = changelog.slice(heading.index + heading[0].length);
  const next = rest.indexOf("\n## [");
  const section = next === -1 ? rest : rest.slice(0, next);
  return section.includes(`v${version}`)
    ? []
    : [`CHANGELOG.md entry for ${version} does not name v${version}`];
}

function checkInstalls(docs: Record<string, string>, version: string): string[] {
  const problems: string[] = [];
  for (const file of INSTALL_FILES) {
    const suffixes = [...(docs[file] ?? "").matchAll(REPO_INSTALL)].map((m) => m[1]);
    if (suffixes.length === 0) problems.push(`${file}: no install command`);
    if (suffixes.some((s) => s !== `@v${version}`)) {
      problems.push(`${file}: install command not pinned to @v${version}`);
    }
  }
  return problems;
}

function executorTag(pkg: string): string {
  const spec = JSON.parse(pkg).devDependencies?.["@ttdua/pi-subagents"];
  return String(spec ?? "").split("#")[1] ?? "";
}

function checkExecutorInstalls(docs: Record<string, string>, tag: string): string[] {
  const problems: string[] = [];
  for (const file of INSTALL_FILES) {
    const text = docs[file] ?? "";
    const installs = [...text.matchAll(EXECUTOR_INSTALL)];
    if (installs.length === 0) problems.push(`${file}: no executor install command`);
    if (installs.some((m) => m[1] !== `@${tag}`)) {
      problems.push(`${file}: executor install not pinned to @${tag}`);
    }
    const jev = text.search(/pi install git:github\.com\/ttdua\/pi-jev-pilot/);
    if (installs.length > 0 && jev !== -1 && installs[0].index > jev) {
      problems.push(`${file}: executor install must come before jev-pilot install`);
    }
  }
  return problems;
}

function checkBanners(docs: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const [file, text] of Object.entries(docs)) {
    const lower = text.toLowerCase();
    for (const phrase of BANNERS) {
      if (lower.includes(phrase.toLowerCase())) problems.push(`${file}: banner "${phrase}"`);
    }
  }
  return problems;
}

function checkNoFigures(docs: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const file of USER_DOCS) {
    const text = docs[file] ?? "";
    if (text.includes("%")) problems.push(`${file}: contains a % figure`);
    if (text.includes("evidence/")) problems.push(`${file}: links into evidence/`);
  }
  return problems;
}

function checkOffSwitches(docs: Record<string, string>): string[] {
  const readme = docs["README.md"] ?? "";
  return OFF_SWITCHES.filter((cmd) => !readme.includes(cmd)).map(
    (cmd) => `README.md: missing off switch ${cmd}`,
  );
}

function checkNoToolAssessment(docs: Record<string, string>): string[] {
  const readme = docs["README.md"] ?? "";
  const lower = readme.toLowerCase();
  const problems: string[] = [];
  if (readme.includes("/jev tools")) problems.push("README.md: mentions /jev tools");
  if (lower.includes("tool assessment")) problems.push("README.md: mentions tool assessment");
  return problems;
}

/** Returns release problems, empty when package, changelog and docs agree. */
export function checkRelease(files: ReleaseFiles): string[] {
  const version = String(JSON.parse(files.pkg).version);
  return [
    ...checkChangelog(files.changelog, version),
    ...checkInstalls(files.docs, version),
    ...checkExecutorInstalls(files.docs, executorTag(files.pkg)),
    ...checkBanners(files.docs),
    ...checkNoFigures(files.docs),
    ...checkOffSwitches(files.docs),
    ...checkNoToolAssessment(files.docs),
  ];
}
