import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** Directory holding the package's files; follows PI_CODING_AGENT_DIR. */
export function jevDir(): string {
  return join(getAgentDir(), "jev");
}
