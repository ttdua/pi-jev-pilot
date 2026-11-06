// Subprocess probe: any timer left behind by askJev would keep this process alive past its work.
import { askJev } from "../../src/jev/client.ts";
import { startJevFixture } from "./fixture.ts";

const f = await startJevFixture({ "/ok": { json: { answers: {} } } });
const out = await askJev({
  url: f.url("/ok"),
  apiKey: "test-key-123",
  model: "jev-latest",
  timeoutMs: 60_000,
  state: {},
  questions: {},
});
await f.stop();
if (out.kind !== "ok") process.exit(1);
