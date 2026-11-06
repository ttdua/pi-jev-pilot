import { PI_BIN } from "../helpers";

export type RpcResponse = {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
};

export type RpcEvent = { type: string; [key: string]: unknown };

export type RpcProcess = {
  pid: number;
  send(cmd: Record<string, unknown>): Promise<RpcResponse>;
  prompt(text: string): Promise<void>;
  waitFor(pred: () => boolean, label: string): Promise<void>;
  events: RpcEvent[];
  close(): Promise<void>;
};

const BASE_ENV_KEYS = ["PATH", "TMPDIR"] as const;

/**
 * Allow-listed child environment: nothing from the operator's shell (HOME, XDG_*, PI_*,
 * provider credentials) leaks in. HOME points at a throwaway dir.
 */
export function isolatedEnv(
  agentDir: string,
  home: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of BASE_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, HOME: home, PI_CODING_AGENT_DIR: agentDir, ...extra };
}

const POLL_MS = 25;
const KILL_AFTER_MS = 2000;

export function spawnRpc(opts: {
  agentDir: string;
  home: string;
  cwd: string;
  args: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}): RpcProcess {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const proc = Bun.spawn([PI_BIN, "--mode", "rpc", ...opts.args], {
    cwd: opts.cwd,
    env: isolatedEnv(opts.agentDir, opts.home, opts.env),
    detached: true,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const events: RpcEvent[] = [];
  const pending = new Map<string, (r: RpcResponse) => void>();
  let nextId = 0;
  let stderrText = "";
  let exited = false;
  void proc.exited.then(() => {
    exited = true;
  });

  const lastEventType = (): string => events[events.length - 1]?.type ?? "none";
  const failure = (what: string): Error =>
    new Error(
      `${what}: timed out after ${timeoutMs}ms, last event: ${lastEventType()}` +
        (exited ? ` (pi exited; stderr: ${stderrText.slice(-500)})` : ""),
    );

  const handleLine = (line: string): void => {
    const text = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (text.trim() === "") return;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    if (record.type === "response") {
      const id = typeof record.id === "string" ? record.id : undefined;
      const resolve = id === undefined ? undefined : pending.get(id);
      if (id !== undefined && resolve) {
        pending.delete(id);
        resolve(record as unknown as RpcResponse);
      }
      return;
    }
    events.push(record as RpcEvent);
  };

  // Split on LF only (never readline: U+2028/U+2029 are legal inside JSON strings).
  void (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of proc.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      let idx = buffer.indexOf("\n");
      while (idx >= 0) {
        handleLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
        idx = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer) handleLine(buffer);
  })();

  void (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stderr) stderrText += decoder.decode(chunk, { stream: true });
  })();

  const waitFor = async (pred: () => boolean, label: string): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!pred()) {
      if (Date.now() >= deadline) throw failure(label);
      await Bun.sleep(POLL_MS);
    }
  };

  const send = (cmd: Record<string, unknown>): Promise<RpcResponse> => {
    const id = `req-${++nextId}`;
    return new Promise<RpcResponse>((resolve, reject) => {
      if (exited) {
        reject(failure(`send ${String(cmd.type)} (process already exited)`));
        return;
      }
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(failure(`response to ${String(cmd.type)}`));
      }, timeoutMs);
      pending.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      proc.stdin.write(`${JSON.stringify({ ...cmd, id })}\n`);
      void proc.stdin.flush();
    });
  };

  const settledCount = (): number => events.filter((e) => e.type === "agent_settled").length;

  const prompt = async (text: string): Promise<void> => {
    const before = settledCount();
    const response = await send({ type: "prompt", message: text });
    if (!response.success) throw new Error(`prompt rejected: ${response.error ?? "unknown"}`);
    if (response.data?.disposition === "handled") return;
    await waitFor(() => settledCount() > before, "agent_settled");
  };

  const killGroup = (): void => {
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      // group already gone
    }
  };

  const close = async (): Promise<void> => {
    if (!exited) {
      try {
        void proc.stdin.end();
      } catch {
        // stdin already closed
      }
      const killer = setTimeout(killGroup, KILL_AFTER_MS);
      await proc.exited;
      clearTimeout(killer);
    }
    // Detached => pid is the process-group id; reap executor children and grandchildren too.
    killGroup();
  };

  return { pid: proc.pid, send, prompt, waitFor, events, close };
}
