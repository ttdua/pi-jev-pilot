/** First `max` Unicode code points of `text`; never splits a surrogate pair. */
export function cutCodePoints(text: string, max: number): string {
  return Array.from(text).slice(0, max).join("");
}

/** Last `max` Unicode code points of `text`; never splits a surrogate pair. */
export function cutLastCodePoints(text: string, max: number): string {
  if (max <= 0) return "";
  return Array.from(text).slice(-max).join("");
}
