import { compareUnicodeCodePoints as compare } from "../unicodeCodePointOrder.js";

/** Records and JSON-like records seen at one origin. */
export interface OriginStats {
  records: number;
  jsonLike: number;
}

/** The origin with the most JSON-like records, then most records, then lowest code points: the application a capture records. */
export const primaryOrigin = (
  origins: ReadonlyMap<string, Readonly<OriginStats>>,
): string | null => {
  let best: ({ origin: string } & OriginStats) | null = null;
  for (const [origin, stats] of origins) {
    if (
      best === null ||
      stats.jsonLike > best.jsonLike ||
      (stats.jsonLike === best.jsonLike &&
        (stats.records > best.records ||
          (stats.records === best.records && compare(origin, best.origin) < 0)))
    )
      best = { origin, ...stats };
  }
  return best?.origin ?? null;
};
