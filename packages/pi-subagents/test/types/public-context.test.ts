import { expectTypeOf, it } from "vitest";
import type { ContextMode, LaunchRequest, SpawnOptions } from "#src/service/service";
import type { AgentInvocation } from "#src/types";

it("exposes ContextMode from the public entry", () => {
  expectTypeOf<ContextMode>().toEqualTypeOf<"fresh" | "fork">();
  expectTypeOf<LaunchRequest["context"]>().toEqualTypeOf<ContextMode>();
  expectTypeOf<SpawnOptions["context"]>().toEqualTypeOf<ContextMode | undefined>();
});

it("lets an invocation carry the fork fallback", () => {
  expectTypeOf<AgentInvocation["contextFallback"]>().toEqualTypeOf<"no-parent-session" | undefined>();
});
