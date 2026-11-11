// Loopback HTTP fixture for the Jev client contract tests. No network beyond 127.0.0.1.

export type FixtureRoute =
  | { json: unknown; status?: number }
  | { status: number; location?: string }
  | { raw: string | Uint8Array; headers?: Record<string, string> }
  | { hang: true }
  | { stallAfterHeaders: true }
  | { streamBytes: number }
  // Streams the given chunks as-is, one per read, so a test can split a multi-byte character.
  | { chunks: Uint8Array[] }
  // The request is recorded at once; the response waits for the promise, then answers with the route it resolves to.
  | { held: Promise<FixtureRoute> }
  // A route chosen per request from its body, so each request can be held or answered on its own.
  | { each: (body: string) => FixtureRoute };

export type RecordedJevRequest = {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
};

export type JevFixture = {
  url(path: string): string;
  requests: RecordedJevRequest[];
  stop(): Promise<void>;
};

const CHUNK_BYTES = 16 * 1024;

function respond(route: FixtureRoute, body = ""): Response | Promise<Response> {
  if ("held" in route) return route.held.then((r) => respond(r, body));
  if ("each" in route) return respond(route.each(body), body);
  if ("hang" in route) return new Promise<Response>(() => {});
  if ("stallAfterHeaders" in route) {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("{"));
      },
    });
    return new Response(body, { status: 200 });
  }
  if ("streamBytes" in route) {
    let sent = 0;
    const total = route.streamBytes;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= total) {
          controller.close();
          return;
        }
        const size = Math.min(CHUNK_BYTES, total - sent);
        controller.enqueue(new Uint8Array(size).fill(0x20));
        sent += size;
      },
    });
    return new Response(body, { status: 200 });
  }
  if ("chunks" in route) {
    const parts = route.chunks;
    let index = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const part = parts[index++];
        if (part === undefined) controller.close();
        else controller.enqueue(part);
      },
    });
    return new Response(body, { status: 200 });
  }
  if ("raw" in route) {
    const raw = typeof route.raw === "string" ? route.raw : (route.raw as Uint8Array<ArrayBuffer>);
    return new Response(raw, { status: 200, headers: route.headers });
  }
  if ("json" in route) return Response.json(route.json, { status: route.status ?? 200 });
  const headers: Record<string, string> = {};
  if (route.location !== undefined) headers.location = route.location;
  return new Response(null, { status: route.status, headers });
}

export async function startJevFixture(routes: Record<string, FixtureRoute>): Promise<JevFixture> {
  const requests: RecordedJevRequest[] = [];

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const headers: Record<string, string> = {};
      req.headers.forEach((value, key) => {
        headers[key] = value;
      });
      const body = await req.text();
      requests.push({ method: req.method, path, headers, body });
      const route = Object.hasOwn(routes, path) ? routes[path] : undefined;
      if (route === undefined) return new Response("not found", { status: 404 });
      return respond(route, body);
    },
  });

  return {
    url: (path) => `http://127.0.0.1:${server.port}${path}`,
    requests,
    stop: async () => {
      await server.stop(true);
    },
  };
}
