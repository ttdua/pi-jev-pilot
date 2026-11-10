import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runJev } from "../commands/index.ts";
import { jevDir, loadSnapshot } from "../platform/index.ts";
import { syncReviewTool } from "../review/index.ts";
import { runTune } from "../tuning/index.ts";
import type { Parts } from "./parts.ts";

/** Registers `/jev`; the jev dir is resolved each time the command runs. */
export function registerJevCommand(pi: ExtensionAPI, parts: Parts): void {
  const { main, log, window, routing } = parts;
  pi.registerCommand("jev", {
    description: "Show or change jev-pilot features",
    handler: (args, ctx) => {
      routing.clearWarnings();
      return runJev(args, ctx, {
        dir: jevDir(),
        load: (cwd) => loadSnapshot(pi, cwd),
        decision: main.decision,
        tally: log.tally,
        window: () => window.entries(),
        overlay: main.overlay,
        exec: (c, a, o) => pi.exec(c, a, o),
        tune: (sub, c) => runTune(parts.tuningDeps(), sub, c),
        sync: (s) => syncReviewTool(pi, s.settings.review.enabled),
      });
    },
  });
}
