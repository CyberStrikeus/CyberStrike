import { z } from "zod";
import { javaScriptSemanticResourceLimitSchema } from "./javascriptSemanticValueTypes.js";

/** Independent observations from one inert static pass; no runtime completeness claim. */
export const javaScriptStaticCoverageSchema = z.strictObject({
  syntax: z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("complete"),
      error_count: z.literal(0),
    }),
    z.strictObject({
      status: z.literal("recovered"),
      error_count: z.int().positive(),
    }),
    z.strictObject({ status: z.literal("failed"), error_count: z.null() }),
    z.strictObject({
      status: z.literal("not-examined"),
      error_count: z.null(),
    }),
  ]),
  semantics: z.strictObject({
    unknown_findings: z.int().nonnegative().nullable(),
    uncertainty: z.array(
      z.enum([
        "dynamic-findings",
        "returned-reference-widening",
        "type-only-module-side-effect",
      ]),
    ),
  }),
  examination: z.strictObject({
    status: z.enum(["complete", "limited", "not-examined"]),
    semantic_resource_limits: z.array(javaScriptSemanticResourceLimitSchema),
    electron_call_paths_limited: z.boolean(),
  }),
  applicability: z.strictObject({ electron: z.enum(["observed", "unknown"]) }),
  unexamined_reason: z.string().min(1).exactOptional(),
});

export type JavaScriptStaticCoverage = z.infer<
  typeof javaScriptStaticCoverageSchema
>;

/** Preserve the established conservative summary, independently of finer facts. */
export const javaScriptStaticParseStatus = (
  coverage: JavaScriptStaticCoverage,
): "complete" | "partial" | "failed" =>
  coverage.syntax.status === "failed" ||
  coverage.syntax.status === "not-examined"
    ? "failed"
    : coverage.syntax.status === "recovered" ||
        (coverage.semantics.unknown_findings ?? 0) > 0 ||
        coverage.examination.semantic_resource_limits.includes(
          "alias-selections",
        )
      ? "partial"
      : "complete";

/** Unperformed work has no measured syntax, finding count or framework applicability. */
export const unexaminedJavaScriptStaticCoverage = (
  reason: string,
): JavaScriptStaticCoverage => ({
  syntax: { status: "not-examined", error_count: null },
  semantics: { unknown_findings: null, uncertainty: [] },
  examination: {
    status: "not-examined",
    semantic_resource_limits: [],
    electron_call_paths_limited: false,
  },
  applicability: { electron: "unknown" },
  unexamined_reason: reason,
});
