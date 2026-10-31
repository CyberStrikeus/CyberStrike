import { z } from "zod";

/**
 * Canonical top-level comparison outcome shared by every comparison
 * pipeline. Pipeline-native detail enums keep their wire schemas, while
 * shared result contracts use this canonical triple.
 */
export const comparisonStatusSchema = z.enum([
  "unchanged",
  "changed",
  "unknown",
]);
