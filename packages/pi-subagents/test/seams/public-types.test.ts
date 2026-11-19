import { expectTypeOf, it } from "vitest";
import type { LaunchMetadata, PublishedLaunchIdentity } from "#src/service/service";

it("exports PublishedLaunchIdentity by name with optional metadata", () => {
	expectTypeOf<PublishedLaunchIdentity>().toHaveProperty("metadata");
	expectTypeOf<PublishedLaunchIdentity["metadata"]>().toEqualTypeOf<
		LaunchMetadata | undefined
	>();
});
