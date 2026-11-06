import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendLedger } from "../../../src/store/ledger.ts";

const [dir, idArg, countArg] = process.argv.slice(2);
if (dir === undefined || idArg === undefined || countArg === undefined) {
  process.stderr.write("usage: writer <dir> <writerId> <count>\n");
  process.exit(2);
}
const id = Number(idArg);
const count = Number(countArg);

writeFileSync(join(dir, `ready-${id}`), "");
const go = join(dir, "go");
const deadline = Date.now() + 10000;
while (!existsSync(go)) {
  if (Date.now() > deadline) {
    process.stderr.write("barrier timeout\n");
    process.exit(3);
  }
  await Bun.sleep(1);
}

let failed = 0;
for (let seq = 0; seq < count; seq++) {
  const r = appendLedger(dir, {
    v: 1,
    at: Date.now(),
    kind: "main",
    session: `w${id}`,
    mode: "standard",
    answered: false,
    turnId: `${id}-${seq}`,
    outcome: "ok",
  });
  if (!r.ok) failed++;
}
if (failed > 0) {
  process.stderr.write(`writer ${id}: ${failed}/${count} appends failed\n`);
  process.exit(1);
}
