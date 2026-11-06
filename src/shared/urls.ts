// Shared URL rules. Leaf module: imports nothing.

function isLoopbackHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const m = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.exec(hostname);
  return m !== null;
}

export function isAllowedJevUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username !== "" || parsed.password !== "") return false;
  if (parsed.protocol === "https:") return true;
  return parsed.protocol === "http:" && isLoopbackHost(parsed.hostname);
}
