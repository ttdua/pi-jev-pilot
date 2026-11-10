import { expect, test } from "bun:test";
import { applyCommand } from "../../../src/host/commands/apply.ts";

const where = { cwd: "/nonexistent", dir: "/nonexistent/jev" };

// Checked by `bun run typecheck`: an unused @ts-expect-error is itself an error.
test("applyCommand rejects the sub-commands it cannot apply at compile time", () => {
  const never = () => {
    // @ts-expect-error slot is answered by the dispatcher, not applied
    applyCommand({ kind: "slot", args: { kind: "show", name: "r" } }, where, undefined);
    // @ts-expect-error tune is answered by the dispatcher, not applied
    applyCommand({ kind: "tune", sub: "report" }, where, undefined);
    // @ts-expect-error usage is answered by the dispatcher, not applied
    applyCommand({ kind: "usage" }, where, undefined);
  };
  expect(typeof never).toBe("function");
});
