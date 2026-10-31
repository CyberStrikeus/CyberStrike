import { z } from "zod";

import { javascriptSourceRangeSchema } from "./javascriptSourceCoordinates.js";

export const javaScriptRouteMechanismSchema = z.enum([
  "router-call",
  "nested-route-object",
  "typed-route-tree",
  "next-app-chunk",
  "navigation-target",
  "route-string-constant",
]);
export const javaScriptRouteSegmentSchema = z.strictObject({
  value: z.string(),
  location: javascriptSourceRangeSchema,
  origin: z.enum(["literal", "property-name", "next-app-path"]),
});
export const javaScriptRouteCandidateSchema = z.strictObject({
  path: z.string().regex(/^\//u),
  mechanism: javaScriptRouteMechanismSchema,
  confidence: z.enum(["low", "medium", "high"]),
  derivation: z.enum(["literal", "joined", "inferred"]),
  location: javascriptSourceRangeSchema,
  segments: z.array(javaScriptRouteSegmentSchema),
});
export const javaScriptRouteWorkCapacitySchema = z.strictObject({
  kind: z.literal("route-work-or-facts"),
  limit_bytes: z.int().nonnegative(),
  accounted_fact_bytes: z.int().nonnegative(),
  accounted_work_bytes: z.int().nonnegative(),
});
export const javaScriptRouteSourceFactsSchema = z.strictObject({
  candidates: z.array(javaScriptRouteCandidateSchema),
  unresolved: z.array(
    z.strictObject({
      mechanism: javaScriptRouteMechanismSchema,
      location: javascriptSourceRangeSchema,
      reason: z.string(),
    }),
  ),
  capacity: z
    .discriminatedUnion("kind", [
      javaScriptRouteWorkCapacitySchema,
      z.strictObject({
        kind: z.literal("result-bytes"),
        limit_bytes: z.int().nonnegative(),
        preceding_work_capacity: javaScriptRouteWorkCapacitySchema.nullable(),
      }),
    ])
    .nullable(),
});
export type JavaScriptRouteCandidate = z.infer<
  typeof javaScriptRouteCandidateSchema
>;
export type JavaScriptRouteSegment = z.infer<
  typeof javaScriptRouteSegmentSchema
>;
export type JavaScriptRouteSourceFacts = z.infer<
  typeof javaScriptRouteSourceFactsSchema
>;
