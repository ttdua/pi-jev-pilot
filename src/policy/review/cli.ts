// Pure builders for the CLI review. Imports nothing from Pi.

export type ExecResult = {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
  truncated: boolean;
};

export type Exec = (
  command: string,
  args: string[],
  options: {
    cwd?: string;
    timeout?: number;
    signal?: AbortSignal;
    maxBuffer?: number;
  },
) => Promise<ExecResult>;

export type ReviewChoice = {
  cli: "codex" | "opencode";
  model?: string;
  effort?: string;
};

export type ReviewDetails = {
  cli: "codex" | "opencode";
  model?: string;
  effort?: string;
  exitCode?: number;
  attempts: 1 | 2;
  outcome: "ok" | "timeout" | "cancelled" | "not-found" | "exit-error" | "truncated" | "exec-error";
};

export type CodexModel = { slug: string; name: string; efforts: string[] };

export type CheckResult =
  | { ok: true; model?: string; effort?: string }
  | { ok: false; message: string; suggestions: string[] };

export const REVIEW_INSTRUCTIONS: string = [
  "Review a code change in this repository, read-only: don't edit anything.",
  "Read the changed files and `git diff` (or `git diff HEAD~1` when the change is already committed).",
  "Check that it does what the brief says, and look for wrong behavior, input that is not checked, broken edge cases and missing tests.",
  "Report each finding as P1 (wrong behavior or lost data), P2 (a likely bug or a missing check) or P3 (minor), with file:line and a one-line fix.",
  "End with one verdict: PASS, PASS-WITH-FOLLOWUP or NEEDS FIXES. Keep it tight.",
].join("\n");

/** Instructions come first so the prompt can never be read as a flag. */
export function buildPrompt(brief: string): string {
  return `${REVIEW_INSTRUCTIONS}\n\nThe change:\n${brief}`;
}

export function codexArgs(c: {
  model?: string;
  effort?: string;
  cwd: string;
  out: string;
  prompt: string;
}): string[] {
  return [
    "exec",
    ...(c.model ? ["-m", c.model] : []),
    ...(c.effort ? ["-c", `model_reasoning_effort="${c.effort}"`] : []),
    "-s",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "-C",
    c.cwd,
    "-o",
    c.out,
    c.prompt,
  ];
}

export function opencodeArgs(c: { model?: string; effort?: string; prompt: string }): string[] {
  const model = c.model ? (c.effort ? `${c.model}#${c.effort}` : c.model) : undefined;
  return ["run", ...(model ? ["-m", model] : []), "--agent", "plan", c.prompt];
}

const MAX_SUGGESTIONS = 5;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Visible models from `codex debug models`; anything unreadable gives `[]`. */
export function parseCodexCatalog(stdout: string): CodexModel[] {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!isRecord(data) || !Array.isArray(data.models)) return [];
  const out: CodexModel[] = [];
  for (const raw of data.models as unknown[]) {
    if (!isRecord(raw) || typeof raw.slug !== "string" || raw.slug === "") continue;
    if (raw.visibility !== undefined && raw.visibility !== "list") continue;
    const levels = Array.isArray(raw.supported_reasoning_levels)
      ? raw.supported_reasoning_levels
      : [];
    const efforts: string[] = [];
    for (const l of levels as unknown[]) {
      if (isRecord(l) && typeof l.effort === "string" && l.effort !== "") efforts.push(l.effort);
    }
    const name =
      typeof raw.display_name === "string" && raw.display_name !== "" ? raw.display_name : raw.slug;
    out.push({ slug: raw.slug, name, efforts });
  }
  return out;
}

/** `provider/model` lines of `opencode models`. */
export function parseOpencodeModels(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && l.includes("/"));
}

/** A tier is a model made only of letters, such as `luna`. */
export function isTier(model: string): boolean {
  return /^[A-Za-z]+$/.test(model);
}

function tierOf(slug: string): string {
  return slug.slice(slug.lastIndexOf("-") + 1).toLowerCase();
}

function compareVersions(a: string, b: string): number {
  const x = (a.match(/\d+/g) ?? []).map(Number);
  const y = (b.match(/\d+/g) ?? []).map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The newest slug of a tier, or `undefined` when the catalog has none. */
export function resolveTier(tier: string, catalog: CodexModel[]): string | undefined {
  const t = tier.toLowerCase();
  let best: string | undefined;
  for (const m of catalog) {
    if (tierOf(m.slug) !== t) continue;
    if (best === undefined || compareVersions(m.slug, best) > 0) best = m.slug;
  }
  return best;
}

function fail(message: string, suggestions: string[]): CheckResult {
  return {
    ok: false,
    message,
    suggestions: suggestions.slice(0, MAX_SUGGESTIONS),
  };
}

export function checkCodexChoice(
  model: string | undefined,
  effort: string | undefined,
  catalog: CodexModel[],
): CheckResult {
  if (model === undefined) return effort === undefined ? { ok: true } : { ok: true, effort };
  let slug: string | undefined;
  let stored = model;
  if (isTier(model)) {
    slug = resolveTier(model, catalog);
  } else {
    const lower = model.toLowerCase();
    slug = catalog.find(
      (m) => m.slug.toLowerCase() === lower || m.name.toLowerCase() === lower,
    )?.slug;
    if (slug !== undefined) stored = slug;
  }
  const entry = slug === undefined ? undefined : catalog.find((m) => m.slug === slug);
  if (slug === undefined || entry === undefined) {
    const tiers: string[] = [];
    for (const m of catalog) {
      const t = tierOf(m.slug);
      if (isTier(t) && !tiers.includes(t)) tiers.push(t);
    }
    return fail(
      `Unknown Codex model "${model}".`,
      tiers.map((t) => `${t} (now ${resolveTier(t, catalog)})`),
    );
  }
  if (effort === undefined) return { ok: true, model: stored };
  if (!entry.efforts.includes(effort)) {
    return fail(
      `Codex model ${entry.slug} does not support the effort "${effort}".`,
      entry.efforts,
    );
  }
  return { ok: true, model: stored, effort };
}

export function checkOpencodeChoice(
  model: string | undefined,
  effort: string | undefined,
  ids: string[],
): CheckResult {
  if (model === undefined) {
    if (effort !== undefined) return fail("An OpenCode effort needs a model.", []);
    return { ok: true };
  }
  const withEffort = (m: string): CheckResult =>
    effort === undefined ? { ok: true, model: m } : { ok: true, model: m, effort };
  if (ids.includes(model)) return withEffort(model);
  const named = ids.filter((id) => id.slice(id.indexOf("/") + 1) === model);
  if (named.length === 1) return withEffort(named[0]!);
  if (named.length > 1) {
    return fail(`More than one provider lists "${model}"; name the provider.`, named);
  }
  const lower = model.toLowerCase();
  return fail(
    `Unknown OpenCode model "${model}".`,
    ids.filter((id) => id.toLowerCase().includes(lower)),
  );
}

/** Per-call fields win; a new reviewer drops the default's model and effort. */
export function effectiveChoice(
  defaults: ReviewChoice,
  call: { reviewer?: "codex" | "opencode"; model?: string; effort?: string },
): ReviewChoice {
  const cli = call.reviewer ?? defaults.cli;
  const base: ReviewChoice = cli === defaults.cli ? defaults : { cli };
  const model = call.model ?? base.model;
  // A per-call model replaces the default's effort too, since efforts are model-specific.
  const effort = call.effort ?? (call.model === undefined ? base.effort : undefined);
  return {
    cli,
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
  };
}

export function classifyAttempt(r: ExecResult, aborted: boolean): ReviewDetails["outcome"] {
  if (aborted) return "cancelled";
  if (r.truncated) return "truncated";
  if (r.killed) return "timeout";
  if (r.code === 0) return "ok";
  if (r.stdout === "" && r.stderr.includes("ENOENT")) return "not-found";
  return "exit-error";
}

const DISPLAY = { codex: "Codex", opencode: "OpenCode" } as const;

export function formatSuccess(choice: ReviewChoice, output: string): string {
  const parts = [
    ...(choice.model ? [`model ${choice.model}`] : []),
    ...(choice.effort ? [`effort ${choice.effort}`] : []),
  ];
  const what = parts.length > 0 ? parts.join(", ") : "the CLI's default model and effort";
  return `${DISPLAY[choice.cli]} review (${what}):\n${output.trim()}`;
}

const TAIL_LINES = 20;
const TAIL_CHARS = 4000;

export function stderrTail(stderr: string): string {
  const lines = stderr.trimEnd().split(/\r?\n/);
  const tail = lines.slice(-TAIL_LINES).join("\n");
  return tail.length > TAIL_CHARS ? tail.slice(-TAIL_CHARS) : tail;
}

export function formatFailure(
  cli: "codex" | "opencode",
  outcome: ReviewDetails["outcome"],
  r?: ExecResult,
  errorName?: string,
): string {
  const reason: Record<ReviewDetails["outcome"], string> = {
    ok: "no error",
    "not-found": `${cli} not found`,
    "exit-error": "exited with an error",
    timeout: "timed out twice after 10 minutes",
    cancelled: "cancelled",
    truncated: "output exceeded 8 MiB",
    "exec-error": `could not start (${errorName ?? "Error"})`,
  };
  let text = `The ${DISPLAY[cli]} review did not run: ${reason[outcome]}.`;
  if (outcome === "exit-error" && r) text += ` Exit code ${r.code}.`;
  const tail = r ? stderrTail(r.stderr) : "";
  if (tail !== "") text += `\n\n${tail}`;
  return text;
}
