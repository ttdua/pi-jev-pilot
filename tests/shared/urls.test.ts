import { expect, test } from "bun:test";
import { isAllowedJevUrl as fromJev } from "../../src/jev/client.ts";
import { isAllowedJevUrl } from "../../src/shared/urls.ts";

test("accepts https and loopback", () => {
  for (const url of [
    "http://127.0.0.1:1/",
    "http://127.5.6.7/",
    "http://127.1/",
    "http://[::1]:1/",
    "http://localhost:1/",
    "https://api.typesafe.ai/v1/systemone",
  ]) {
    expect(isAllowedJevUrl(url)).toBe(true);
  }
});

test("rejects other URLs", () => {
  for (const url of [
    "ftp://127.0.0.1/",
    "http://10.0.0.1/",
    "http://user:pw@127.0.0.1/",
    "https://user:pw@api.typesafe.ai/",
    "not a url",
    "http://example.com/v1",
  ]) {
    expect(isAllowedJevUrl(url)).toBe(false);
  }
});

test("jev re-exports the shared rule", () => {
  expect(fromJev).toBe(isAllowedJevUrl);
});
