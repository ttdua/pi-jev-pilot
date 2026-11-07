// Operator CLI: replays real prompts through Jev. Parsing, config and orchestration only.
import { homedir } from "node:os";
import { join } from "node:path";
import { isAllowedJevUrl } from "../../src/shared/urls.ts";
import { compare, diffCases } from "./compare.ts";
import {
  type Args,
  parseArgs,
  readConfig,
  type ReplayConfig,
  USAGE,
  UsageError,
  workersFor,
} from "./config.ts";
import { mainSamples, mainStratum, sample, workerKind, workerSamples } from "./corpus.ts";
import {
  agentFacts,
  readSnapshot,
  rebuildMain,
  type ReplayContext,
  SnapshotError,
  type Snapshot,
} from "./inputs.ts";
import { writeOutputs } from "./outputs.ts";
import { planReport } from "./report.ts";
import { compareReport, reportCases } from "./report-compare.ts";
import { estimate, runPlan } from "./run.ts";
import { readLedgerLines } from "./sessions.ts";
import { type Plan, type PlanInput, planPass, variantIds } from "./variants.ts";

type Env = Record<string, string | undefined>;

const runIdOf = (suffix: "pass1" | "report"): string =>
  `${new Date().toISOString().replace(/[:.]/g, "-")}-${suffix}`;

function printDryRun(
  plan: Plan,
  counts: { main: number; workers: number },
  dest: { url: string; model: string },
): void {
  const e = estimate(plan);
  console.log(`url: ${dest.url}`);
  console.log(`model: ${dest.model}`);
  console.log(`samples: main ${counts.main}, workers ${counts.workers}`);
  console.log(`variants: ${[...new Set(plan.requests.map((r) => r.variant))].join(", ")}`);
  console.log(`skipped: ${plan.skipped.length > 0 ? plan.skipped.join(", ") : "none"}`);
  for (const [key, n] of Object.entries(plan.excluded)) console.log(`excluded ${key}: ${n}`);
  console.log(`requests: ${e.requests}`);
  console.log(`cost: $${e.usd.toFixed(2)} (exact $${e.usd.toFixed(4)})`);
  console.log("note: retries are not in the estimate");
}

type Setup = {
  config: ReplayConfig;
  jevDir: string;
  sessionsDir: string;
  url: string;
  apiKey: string;
  snapshot: Snapshot | undefined;
  ctx: ReplayContext;
};

/** Config, destination, key and capabilities shared by both passes; a number is an exit code. */
function setupOf(args: Args, env: Env): Setup | number {
  const agentDir = env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const jevDir = join(agentDir, "jev");
  const config = readConfig(jevDir);
  const url = args.url ?? config.url;
  if (!isAllowedJevUrl(url)) throw new UsageError("the Jev url must be https or loopback http");
  const apiKey = env[config.apiKeyEnv] ?? "";
  if (args.send && apiKey === "") {
    console.error(`--send needs the API key in the environment variable ${config.apiKeyEnv}`);
    return 2;
  }
  const snapshot = args.capabilities === undefined ? undefined : readSnapshot(args.capabilities);
  const ctx: ReplayContext = {
    ledger: readLedgerLines(jevDir),
    ...(snapshot === undefined ? {} : { capabilities: snapshot }),
  };
  return {
    config,
    jevDir,
    sessionsDir: args.sessions ?? join(agentDir, "sessions"),
    url,
    apiKey,
    snapshot,
    ctx,
  };
}

function sampleInputs(args: Args, setup: Setup, workerCount: number) {
  const main = sample(mainSamples(setup.sessionsDir), args.main, args.seed, mainStratum).map((s) =>
    rebuildMain(s, setup.ctx),
  );
  const workers = sample(workerSamples(setup.sessionsDir), workerCount, args.seed, workerKind).map(
    (w) => {
      const agent = agentFacts(setup.snapshot, w.agent);
      return { sample: w, ...(agent === undefined ? {} : { agent }) };
    },
  );
  return { main, workers };
}

function sendOptions(setup: Setup) {
  return { url: setup.url, apiKey: setup.apiKey, model: setup.config.model, send: true };
}

async function replayPass1(args: Args, setup: Setup): Promise<number> {
  const { config } = setup;
  const { main, workers } = sampleInputs(args, setup, workersFor(args));
  const input: PlanInput = {
    main,
    workers,
    config: config.plain,
    hasSnapshot: setup.snapshot !== undefined,
    ...(args.only === undefined ? {} : { only: args.only }),
  };
  const known = variantIds(input);
  const unknown = (args.only ?? []).filter((id) => !known.includes(id));
  if (unknown.length > 0) throw new UsageError(`unknown variant in --only: ${unknown.join(", ")}`);
  const plan = planPass(input);
  const counts = { main: main.length, workers: workers.length };
  if (!args.send) {
    printDryRun(plan, counts, { url: setup.url, model: config.model });
    return 0;
  }

  const results = await runPlan(plan, sendOptions(setup));
  const runId = runIdOf("pass1");
  const aggregates = compare(plan, results, {
    runId,
    pass: 1,
    samples: counts,
    config: config.plain,
  });
  const cases = diffCases(plan, results, config.plain, (kind, i) =>
    kind === "main" ? (main[i]?.sample.prompt ?? "") : (workers[i]?.sample.brief ?? ""),
  );
  const outDir = join(setup.jevDir, "replay", runId);
  writeOutputs(outDir, aggregates, cases);
  console.log(`output: ${outDir}`);
  console.log(`requests: ${results.length}, differing pairs: ${cases.length}`);
  for (const [key, v] of Object.entries(aggregates.variants)) {
    console.log(`${key}: requests ${v.requests}, misses ${v.misses}, excluded ${v.excluded}`);
  }
  return 0;
}

async function replayReport(args: Args, setup: Setup): Promise<number> {
  const { config } = setup;
  const { main, workers } = sampleInputs(args, setup, workersFor(args));
  const plan = planReport({
    main,
    workers,
    config: config.plain,
    hasSnapshot: setup.snapshot !== undefined,
  });
  const counts = { main: main.length, workers: workers.length };
  if (!args.send) {
    printDryRun(plan, counts, { url: setup.url, model: config.model });
    return 0;
  }

  const results = await runPlan(plan, sendOptions(setup));
  const runId = runIdOf("report");
  const aggregates = compareReport(plan, results, {
    runId,
    samples: counts,
    config: config.plain,
    startEffort: main.map((m) => m.sample.startEffort),
    workerKind: workers.map((w) => workerKind(w.sample)),
  });
  const cases = reportCases(plan, results, config.plain, (kind, i) =>
    kind === "main" ? (main[i]?.sample.prompt ?? "") : (workers[i]?.sample.brief ?? ""),
  );
  const outDir = join(setup.jevDir, "replay", runId);
  writeOutputs(outDir, aggregates, cases);
  console.log(`output: ${outDir}`);
  console.log(`requests: ${results.length}, differing pairs: ${cases.length}`);
  const missed = Object.values(aggregates.misses).reduce((a, b) => a + b, 0);
  console.log(`misses: ${missed}`);
  return 0;
}

async function replay(args: Args, env: Env): Promise<number> {
  const setup = setupOf(args, env);
  if (typeof setup === "number") return setup;
  return args.pass === "report" ? replayReport(args, setup) : replayPass1(args, setup);
}

/** Returns the exit code. 2 covers bad usage and unusable inputs. */
export async function main(argv: readonly string[], env: Env): Promise<number> {
  try {
    return await replay(parseArgs(argv), env);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n${USAGE}`);
      return 2;
    }
    if (error instanceof SnapshotError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
