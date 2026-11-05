export type RecordedRequest = {
  seq: number;
  model: string;
  reasoningEffort: string | undefined;
  toolNames: string[];
  body: Record<string, unknown>;
  matched: string | null;
};

export type FixtureReply =
  | { text: string }
  | { toolCalls: { name: string; arguments: Record<string, unknown> }[] };

export type ScriptEntry = {
  name: string;
  match: (req: RecordedRequest) => boolean;
  reply: FixtureReply;
  times?: number;
};

export type Fixture = {
  baseUrl: string;
  port: number;
  requests: RecordedRequest[];
  unmatched: RecordedRequest[];
  stop(): Promise<void>;
};

export async function startFixture(script: ScriptEntry[]): Promise<Fixture> {
  const requests: RecordedRequest[] = [];
  const unmatched: RecordedRequest[] = [];
  const used = new Map<string, number>();
  const encoder = new TextEncoder();

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
        return new Response("not found", { status: 404 });
      }
      const body = (await req.json()) as Record<string, unknown>;
      const tools = Array.isArray(body.tools)
        ? (body.tools as { function?: { name?: unknown } }[])
        : [];
      const recorded: RecordedRequest = {
        seq: requests.length,
        model: typeof body.model === "string" ? body.model : "",
        reasoningEffort:
          typeof body.reasoning_effort === "string" ? body.reasoning_effort : undefined,
        toolNames: tools.flatMap((t) =>
          typeof t.function?.name === "string" ? [t.function.name] : [],
        ),
        body,
        matched: null,
      };
      requests.push(recorded);

      const entry = script.find(
        (e) => (e.times === undefined || (used.get(e.name) ?? 0) < e.times) && e.match(recorded),
      );
      if (!entry) {
        unmatched.push(recorded);
        return Response.json({ error: { message: "no scripted reply matched" } }, { status: 400 });
      }
      recorded.matched = entry.name;
      used.set(entry.name, (used.get(entry.name) ?? 0) + 1);

      const id = `chatcmpl-fixture-${recorded.seq}`;
      const chunk = (choice: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created: 0,
          model: recorded.model,
          choices: [{ index: 0, ...choice }],
          ...extra,
        })}\n\n`;
      const parts: string[] = [
        chunk({ delta: { role: "assistant", content: "" }, finish_reason: null }),
      ];
      let finish: "stop" | "tool_calls";
      if ("text" in entry.reply) {
        parts.push(chunk({ delta: { content: entry.reply.text }, finish_reason: null }));
        finish = "stop";
      } else {
        entry.reply.toolCalls.forEach((call, i) => {
          parts.push(
            chunk({
              delta: {
                tool_calls: [
                  {
                    index: i,
                    id: `call_${recorded.seq}_${i}`,
                    type: "function",
                    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                  },
                ],
              },
              finish_reason: null,
            }),
          );
        });
        finish = "tool_calls";
      }
      parts.push(chunk({ delta: {}, finish_reason: finish }));
      parts.push(
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created: 0,
          model: recorded.model,
          choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })}\n\n`,
      );
      parts.push("data: [DONE]\n\n");
      return new Response(encoder.encode(parts.join("")), {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      });
    },
  });

  return {
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    port: server.port as number,
    requests,
    unmatched,
    stop: async () => {
      await server.stop(true);
    },
  };
}

export function fixtureModelsJson(baseUrl: string): object {
  return {
    providers: {
      fixture: {
        baseUrl,
        api: "openai-completions",
        apiKey: "fixture",
        compat: { thinkingFormat: "openai", supportsReasoningEffort: true },
        models: [
          { id: "fixture-main", reasoning: true },
          { id: "fixture-balanced", reasoning: true },
          { id: "fixture-fast", reasoning: true },
        ],
      },
    },
  };
}
