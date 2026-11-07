export type ReleaseFiles = {
  pkg: string;
  changelog: string;
  docs: Record<string, string>;
};

const REPO_INSTALL = /pi install git:github\.com\/ttdua\/pi-jev-pilot(\S*)/g;
const INSTALL_FILES = ["README.md", "docs/usage-guide.md"];
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

/** Returns release problems, empty when package, changelog and docs agree. */
export function checkRelease(files: ReleaseFiles): string[] {
  const version = String(JSON.parse(files.pkg).version);
  return [
    ...checkChangelog(files.changelog, version),
    ...checkInstalls(files.docs, version),
    ...checkBanners(files.docs),
  ];
}
