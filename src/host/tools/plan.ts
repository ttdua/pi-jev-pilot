import type { LaunchRequest } from "@ttdua/pi-subagents";
import { toolPlan, type ToolPlan } from "../../policy/tools/index.ts";
import type { Settings } from "../../store/settings.ts";

/**
 * The candidates a launch scores: none with the `tools` switch off or an empty prompt, else the
 * block and grant candidates from the launch request's tool set.
 */
export function planTools(
  request: Pick<LaunchRequest, "prompt" | "toolSet">,
  settings: Pick<Settings, "switches">,
): ToolPlan {
  if (!settings.switches.tools || request.prompt === "") return { block: [], grant: [] };
  return toolPlan(request.toolSet);
}

/** Whether a plan has anything to score. */
export function hasCandidates(plan: ToolPlan): boolean {
  return plan.block.length + plan.grant.length > 0;
}
