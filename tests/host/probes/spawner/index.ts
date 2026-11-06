import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { probeReport } from "../report";

// Launches a long-lived descendant so tests can prove close() kills the whole process group.
export default function (pi: ExtensionAPI): void {
  const report = probeReport("spawner");
  pi.on("session_start", async () => {
    const child = spawn("sleep", ["300"], { stdio: "ignore" });
    report("child", { data: { pid: child.pid ?? -1 } });
  });
}
