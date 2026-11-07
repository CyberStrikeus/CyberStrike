import { z } from "zod";

import { webBundleAnalysisSchema } from "./webBundleAnalysis.js";
import { javaScriptRouteSourceFactsSchema } from "./javascript/javascriptRouteFacts.js";

const observationsSchema = z.strictObject({
  edges: webBundleAnalysisSchema.shape.observations.shape.chunks.shape.edges,
  routes: webBundleAnalysisSchema.shape.observations.shape.routes,
  endpoints: webBundleAnalysisSchema.shape.observations.shape.endpoints,
  webmcp_declarations:
    webBundleAnalysisSchema.shape.observations.shape.webmcp_declarations,
});

/** Serializable result for one captured script, suitable for worker transport. */
export const webBundleScriptAnalysisSchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("analyzed"),
      script_key: z.string(),
      parse_status: z.enum(["parsed", "recovered", "failed"]),
      visited_ast_nodes: z.number().int().min(0),
      widened_return_references: z.boolean(),
      route_facts: javaScriptRouteSourceFactsSchema.nullable().optional(),
      observations: observationsSchema,
      inferences: webBundleAnalysisSchema.shape.inferences,
    }),
    z.strictObject({
      status: z.literal("unavailable"),
      script_key: z.string(),
      reason: z.enum([
        "worker_failure",
        "deadline",
        "resource_constraint",
        "cancelled",
        "not_started",
      ]),
      detail: z.string().optional(),
    }),
  ])
  .superRefine((result, context) => {
    if (result.status !== "analyzed") return;

    const checkScriptKey = (
      scriptKey: string,
      path: (string | number)[],
    ): void => {
      if (scriptKey !== result.script_key)
        context.addIssue({
          code: "custom",
          path,
          message: "Per-script analysis evidence must name its owning script",
        });
    };

    result.observations.edges.forEach((edge, index) => {
      checkScriptKey(edge.from_script_key, [
        "observations",
        "edges",
        index,
        "from_script_key",
      ]);
      checkScriptKey(edge.location.script_key, [
        "observations",
        "edges",
        index,
        "location",
        "script_key",
      ]);
    });
    for (const collection of ["routes", "endpoints"] as const)
      result.observations[collection].forEach((finding, index) =>
        checkScriptKey(finding.location.script_key, [
          "observations",
          collection,
          index,
          "location",
          "script_key",
        ]),
      );
    result.observations.webmcp_declarations.forEach((declaration, index) =>
      checkScriptKey(declaration.location.script_key, [
        "observations",
        "webmcp_declarations",
        index,
        "location",
        "script_key",
      ]),
    );
    result.inferences.forEach((inference, inferenceIndex) =>
      inference.basis.forEach((basis, basisIndex) =>
        checkScriptKey(basis.script_key, [
          "inferences",
          inferenceIndex,
          "basis",
          basisIndex,
          "script_key",
        ]),
      ),
    );

    if (result.parse_status === "failed") {
      const hasFindings =
        result.observations.edges.length > 0 ||
        result.observations.routes.length > 0 ||
        result.observations.endpoints.length > 0 ||
        result.observations.webmcp_declarations.length > 0 ||
        result.inferences.length > 0;
      if (
        result.visited_ast_nodes !== 0 ||
        result.widened_return_references ||
        hasFindings
      )
        context.addIssue({
          code: "custom",
          path: ["parse_status"],
          message:
            "A failed script parse cannot carry visited nodes or derived findings",
        });
    }
  });

export type WebBundleScriptAnalysis = z.infer<
  typeof webBundleScriptAnalysisSchema
>;
