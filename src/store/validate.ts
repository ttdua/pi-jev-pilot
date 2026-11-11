export type Issue = { path: string; message: string };
export type WriteResult = { ok: true } | { ok: false; issues: Issue[] };
export type V<T> = (value: unknown, path: string, issues: Issue[]) => T | undefined;

export function joinPath(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`;
  return parent === "" ? key : `${parent}.${key}`;
}

function fail(issues: Issue[], path: string, message: string): undefined {
  issues.push({ path, message });
  return undefined;
}

export function string(opts: {
  pattern?: RegExp;
  min?: number;
  max?: number;
  trim?: boolean;
}): V<string> {
  return (value, path, issues) => {
    if (typeof value !== "string") return fail(issues, path, "expected a string");
    const s = opts.trim ? value.trim() : value;
    if (opts.min !== undefined && s.length < opts.min)
      return fail(issues, path, `expected a string of at least ${opts.min} characters`);
    if (opts.max !== undefined && s.length > opts.max)
      return fail(issues, path, `expected a string of at most ${opts.max} characters`);
    if (opts.pattern && !opts.pattern.test(s))
      return fail(issues, path, `expected a string matching ${opts.pattern.source}`);
    return s;
  };
}

export function integer(opts: { min: number; max: number }): V<number> {
  return (value, path, issues) => {
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < opts.min ||
      value > opts.max
    )
      return fail(issues, path, `expected an integer from ${opts.min} to ${opts.max}`);
    return value;
  };
}

/** A finite number from `min` to `max`, both inclusive. */
export function finiteNumber(opts: { min: number; max: number }): V<number> {
  return (value, path, issues) =>
    typeof value === "number" && Number.isFinite(value) && value >= opts.min && value <= opts.max
      ? value
      : fail(issues, path, `expected a number from ${opts.min} to ${opts.max}`);
}

export function oneOf<T extends string>(values: readonly T[]): V<T> {
  return (value, path, issues) => {
    if (typeof value === "string" && (values as readonly string[]).includes(value))
      return value as T;
    return fail(issues, path, `expected one of: ${values.join(", ")}`);
  };
}

export function boolean(): V<boolean> {
  return (value, path, issues) =>
    typeof value === "boolean" ? value : fail(issues, path, "expected true or false");
}

export function array<T>(
  item: V<T>,
  opts: { max?: number; uniqueBy?: (item: T) => string } = {},
): V<T[]> {
  return (value, path, issues) => {
    if (!Array.isArray(value)) return fail(issues, path, "expected an array");
    const before = issues.length;
    if (opts.max !== undefined && value.length > opts.max)
      fail(issues, path, `expected at most ${opts.max} items`);
    const out: T[] = [];
    const seen = new Set<string>();
    value.forEach((raw, i) => {
      const p = joinPath(path, i);
      const v = item(raw, p, issues);
      if (v === undefined) return;
      if (opts.uniqueBy) {
        const key = opts.uniqueBy(v);
        if (seen.has(key)) {
          fail(issues, p, "expected a unique entry");
          return;
        }
        seen.add(key);
      }
      out.push(v);
    });
    return issues.length === before ? out : undefined;
  };
}

type Shape = Record<string, V<unknown>>;
type Out<S extends Shape> = { [K in keyof S]?: Exclude<ReturnType<S[K]>, undefined> };

function reportUnknownKeys(
  shape: Shape,
  src: Record<string, unknown>,
  path: string,
  issues: Issue[],
) {
  for (const key of Object.keys(src)) {
    if (!Object.hasOwn(shape, key)) fail(issues, joinPath(path, key), "unknown key");
  }
}

export function object<S extends Shape>(
  shape: S,
  opts: { required?: readonly (keyof S & string)[] } = {},
): V<Out<S>> {
  return (value, path, issues) => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return fail(issues, path, "expected an object");
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    reportUnknownKeys(shape, src, path, issues);
    const before = issues.length;
    for (const key of Object.keys(shape)) {
      const p = joinPath(path, key);
      if (!Object.hasOwn(src, key)) {
        if (opts.required?.includes(key)) fail(issues, p, "required");
        continue;
      }
      const v = shape[key]?.(src[key], p, issues);
      if (v !== undefined) out[key] = v;
    }
    return issues.length === before ? (out as Out<S>) : undefined;
  };
}

/** Wraps a validator with an extra check on the value it accepted. */
export function refine<T>(inner: V<T>, ok: (value: T) => boolean, message: string): V<T> {
  return (value, path, issues) => {
    const before = issues.length;
    const v = inner(value, path, issues);
    if (v === undefined || issues.length !== before) return undefined;
    if (!ok(v)) return fail(issues, path, message);
    return v;
  };
}
