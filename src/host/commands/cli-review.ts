// The `/jev cli-review <cli> [model] [effort]` check against the CLI's own model list.
import { validateCliReview } from "../../store/state-file.ts";
import {
  checkCodexChoice,
  checkOpencodeChoice,
  parseCodexCatalog,
  parseOpencodeModels,
  type CheckResult,
  type Exec,
} from "../../policy/review/index.ts";
import type { JevArgs } from "./args.ts";

type CliReviewArgs = Extract<JevArgs, { kind: "cli-review" }>;

/** The model and effort to store; what the user typed unless the CLI list resolved them. */
export type CliReviewChoice = { model?: string; effort?: string };

export type CliReviewCheck =
  /** `warning` is set when the list could not be read; the choice is then stored as typed. */
  { ok: true; choice: CliReviewChoice; warning?: string } | { ok: false; message: string };

/** The check, or a `reason` when the model list cannot be read. */
async function checkAgainstCli(
  a: CliReviewArgs,
  exec: Exec,
): Promise<{ check: CheckResult } | { reason: string }> {
  const [cmd, args] = a.cli === "codex" ? ["codex", ["debug", "models"]] : ["opencode", ["models"]];
  let r: Awaited<ReturnType<Exec>> | undefined;
  try {
    r = await exec(cmd!, args!, { timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  } catch {
    /* a missing or failing CLI reads as an unreadable list below */
    r = undefined;
  }
  const unreadable = (): { reason: string } => ({
    reason:
      r !== undefined && r.stdout === "" && r.stderr.includes("ENOENT")
        ? `${a.cli} not found`
        : "could not read the model list",
  });
  if (r === undefined || r.code !== 0 || r.killed) return unreadable();
  if (a.cli === "codex") {
    const catalog = parseCodexCatalog(r.stdout);
    if (catalog.length === 0) return unreadable();
    return { check: checkCodexChoice(a.model, a.effort, catalog) };
  }
  const ids = parseOpencodeModels(r.stdout);
  if (ids.length === 0) return unreadable();
  return { check: checkOpencodeChoice(a.model, a.effort, ids) };
}

/** A list is read only when a model is given, or to refuse an OpenCode effort with no model. */
const needsList = (a: CliReviewArgs): boolean =>
  a.model !== undefined || (a.cli === "opencode" && a.effort !== undefined);

function refusalText(check: Extract<CheckResult, { ok: false }>): string {
  const { message, suggestions } = check;
  return suggestions.length > 0 ? `${message}\nTry: ${suggestions.join(", ")}` : message;
}

/** The checks on a model and effort; `exec` runs only when a CLI list is needed. */
export async function checkCliReview(a: CliReviewArgs, exec: Exec): Promise<CliReviewCheck> {
  const stateIssues = validateCliReview({
    cli: a.cli,
    ...(a.model === undefined ? {} : { model: a.model }),
    ...(a.effort === undefined ? {} : { effort: a.effort }),
  });
  if (stateIssues.length > 0) {
    return { ok: false, message: stateIssues.map((i) => `${i.path}: ${i.message}`).join("\n") };
  }
  const typed: CliReviewChoice = { model: a.model, effort: a.effort };
  if (!needsList(a)) return { ok: true, choice: typed };
  const outcome =
    a.model === undefined
      ? { check: checkOpencodeChoice(undefined, a.effort, []) }
      : await checkAgainstCli(a, exec);
  if ("reason" in outcome) {
    return {
      ok: true,
      choice: typed,
      warning: `CLI review model not checked: ${outcome.reason}.`,
    };
  }
  if (!outcome.check.ok) return { ok: false, message: refusalText(outcome.check) };
  return { ok: true, choice: { model: outcome.check.model, effort: outcome.check.effort } };
}
