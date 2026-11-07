/** First `max` Unicode code points of `text`; never splits a surrogate pair. */
export function cutCodePoints(text: string, max: number): string {
  return Array.from(text).slice(0, max).join("");
}

/** Last `max` Unicode code points of `text`; never splits a surrogate pair. */
export function cutLastCodePoints(text: string, max: number): string {
  if (max <= 0) return "";
  return Array.from(text).slice(-max).join("");
}

/** Levenshtein distance over Unicode code points. */
export function editDistance(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  let previous = Array.from({ length: right.length + 1 }, (_, j) => j);
  for (let i = 1; i <= left.length; i++) {
    const row = [i];
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      row.push(
        Math.min((previous[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost),
      );
    }
    previous = row;
  }
  return previous[right.length] ?? 0;
}
