// Operator CLI: replays real prompts through Jev. Parsing, config and orchestration only.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isAllowedJevUrl } from "../../src/shared/urls.ts";
import { compare, diffCases } from "./compare.ts";
import { type Args, parseArgs, readConfig, readGitMap, USAGE, UsageError } from "./config.ts";
import { mainSamples, mainStratum, sample, workerKind, workerSamples } from "./corpus.ts";
import {
  agentFacts,
  parseModels,
  readSnapshot,
  rebuildMain,
  type ReplayContext,
  SnapshotError,
} from "./inputs.ts";
import { writeOutputs } from "./outputs.ts";
import { estimate, runPlan } from "./run.ts";
import { readLedgerLines } from "./sessions.ts";
import { type Plan, planPass } from "./variants.ts";

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new UsageError(`cannot read ${path}`);
  }
}

type Env = Record<string, string | undefined>;

const runIdOf = (pass: number): string =>
  `${new Date().toISOString().replace(/[:.]/g, "-")}-pass${pass}`;

function printDryRun(plan: Plan, counts: { main: number; workers: number }): void {
  const e = estimate(plan);
  console.log(`samples: main ${counts.main}, workers ${counts.workers}`);
  console.log(`variants: ${[...new Set(plan.requests.map((r) => r.variant))].join(", ")}`);
  console.log(`skipped: ${plan.skipped.length > 0 ? plan.skipped.join(", ") : "none"}`);
  for (const [key, n] of Object.entries(plan.excluded)) console.log(`excluded ${key}: ${n}`);
  console.log(`requests: ${e.requests}`);
  console.log(`cost: $${e.usd.toFixed(2)} (exact $${e.usd.toFixed(4)})`);
  console.log("note: retries are not in the estimate");
}

async function replay(args: Args, env: Env): Promise<number> {
  const agentDir = env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const jevDir = join(agentDir, "jev");
  const sessionsDir = args.sessions ?? join(agentDir, "sessions");
  const config = readConfig(jevDir);
  const url = args.url ?? config.url;
  if (!isAllowedJevUrl(url)) throw new UsageError("the Jev url must be https or loopback http");
  const apiKey = env[config.apiKeyEnv];
  if (args.send && (apiKey === undefined || apiKey === "")) {
    console.error(`--send needs the API key in the environment variable ${config.apiKeyEnv}`);
    return 2;
  }

  const snapshot = args.capabilities === undefined ? undefined : readSnapshot(args.capabilities);
  const ctx: ReplayContext = {
    ledger: readLedgerLines(jevDir),
    models: parseModels(args.models === undefined ? "" : readText(args.models)),
    ...(snapshot === undefined ? {} : { capabilities: snapshot }),
    ...(args.pass === 2 ? { git: readGitMap(jevDir) } : {}),
  };
  const main = sample(mainSamples(sessionsDir), args.main, args.seed, mainStratum).map((s) =>
    rebuildMain(s, ctx),
  );
  const workers = sample(workerSamples(sessionsDir), args.workers, args.seed, workerKind).map(
    (w) => {
      const agent = agentFacts(snapshot, w.agent);
      return { sample: w, ...(agent === undefined ? {} : { agent }) };
    },
  );
  const plan = planPass(args.pass, {
    main,
    workers,
    config: config.plain,
    hasSnapshot: snapshot !== undefined,
    ...(args.kept === undefined ? {} : { kept: args.kept }),
  });
  const counts = { main: main.length, workers: workers.length };
  if (!args.send) {
    printDryRun(plan, counts);
    return 0;
  }

  const results = await runPlan(plan, { url, apiKey: apiKey!, model: config.model, send: true });
  const runId = runIdOf(args.pass);
  const meta = { runId, pass: args.pass, samples: counts, config: config.plain };
  const aggregates = compare(plan, results, meta);
  const cases = diffCases(plan, results, config.plain, (kind, i) =>
    kind === "main" ? (main[i]?.sample.prompt ?? "") : (workers[i]?.sample.brief ?? ""),
  );
  const outDir = join(jevDir, "replay", runId);
  writeOutputs(outDir, aggregates, cases);
  console.log(`output: ${outDir}`);
  console.log(`requests: ${results.length}, differing pairs: ${cases.length}`);
  for (const [key, v] of Object.entries(aggregates.variants)) {
    console.log(`${key}: requests ${v.requests}, misses ${v.misses}, excluded ${v.excluded}`);
  }
  return 0;
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
