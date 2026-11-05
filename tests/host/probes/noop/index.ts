import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { probeReport } from "../report";

export default function (pi: ExtensionAPI): void {
  const report = probeReport("noop");
  pi.on("session_start", async () => {
    report("session_start");
  });
}
