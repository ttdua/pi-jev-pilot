import { setup } from "./host/setup.ts";

/** Entry point. Wires host adapters together; no logic (docs/architecture.md). */
export default function jevPilot(pi: Parameters<typeof setup>[0]): void {
  setup(pi);
}
