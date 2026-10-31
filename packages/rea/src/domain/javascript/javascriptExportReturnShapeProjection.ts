import { jsonObjectSchema, jsonValueSchema } from "../jsonValue.js";
import {
  partialApplicationCoverage,
  truncatedApplicationCoverage,
  type ApplicationCoverage,
} from "./javascriptApplicationEvidenceSchemas.js";
import type {
  JavaScriptSemanticCallable,
  JavaScriptSemanticModuleLink,
  JavaScriptSemanticIr,
} from "./javascriptSemanticIr.js";
import { flattenSemanticReturnValue } from "./javascriptSemanticReturns.js";
import type { JavaScriptSourceRange } from "./javascriptStaticAnalysisTypes.js";

/** Return-shape facts and coverage inferred for one exported callable. */
export interface JavaScriptReturnShapeProjection {
  readonly properties: ReturnType<typeof jsonObjectSchema.parse>;
  readonly range: JavaScriptSourceRange;
  readonly coverage: ApplicationCoverage;
  readonly limitations: readonly string[];
}

/** Project one exact export/callable link into inert return-shape observations. */
export const projectJavaScriptExportReturnShapes = (input: {
  readonly ir: Pick<JavaScriptSemanticIr, "callables" | "limitations">;
  readonly link: JavaScriptSemanticModuleLink;
  readonly modulePath: string;
  readonly baseCoverage: ApplicationCoverage;
}): JavaScriptReturnShapeProjection | null => {
  if (input.link.callableId === null || input.link.exportedName === null)
    return null;
  const callable = input.ir.callables.find(
    ({ callableId }) => callableId === input.link.callableId,
  );
  if (callable === undefined) return null;
  const projection = projectReturnSites(callable);
  const projectionOmitted =
    projection.omittedSites +
    projection.omittedFields +
    projection.omittedCoverage;
  const semanticOmitted = callable.returnCoverage.omittedCount;
  const complete =
    input.baseCoverage.status === "complete" &&
    callable.returnCoverage.status === "complete" &&
    projectionOmitted === 0;
  const limits = input.baseCoverage.limits;
  const omitted =
    semanticOmitted === null ? null : semanticOmitted + projectionOmitted;
  const coverage = complete
    ? input.baseCoverage
    : projectionOmitted > 0
      ? truncatedApplicationCoverage(limits, omitted)
      : partialApplicationCoverage(limits, omitted);
  const limitations = [
    ...input.ir.limitations,
    "Return shapes are inferred from inert syntax and do not prove runtime behavior.",
    ...(callable.returnSites.length === 0
      ? [
          "No direct return value was retained; runtime return behavior remains unknown.",
        ]
      : []),
  ];
  return {
    properties: jsonObjectSchema.parse({
      semantic_role: "export-return-shapes",
      module_path: input.modulePath,
      exported_name: input.link.exportedName,
      callable_id: callable.callableId,
      callable_kind: callable.kind,
      static_return_shapes: projection.shapes,
      return_shape_coverage: {
        status: callable.returnCoverage.status,
        retained_return_sites: projection.shapes.length,
        omitted_return_sites:
          semanticOmitted === null
            ? null
            : semanticOmitted + projection.omittedSites,
        omitted_fields: projection.omittedFields,
        omitted_property_coverage: projection.omittedCoverage,
        projection_complete: projectionOmitted === 0,
      },
    }),
    range: callable.location,
    coverage,
    limitations,
  };
};

const projectReturnSites = (callable: JavaScriptSemanticCallable) => {
  const retainedSites = callable.returnSites;
  const shapes = retainedSites.map((site) => {
    const flattened = flattenSemanticReturnValue(site.value);
    const fields = flattened.fields.map((field) => ({
      ...field,
      value: jsonValueSchema.parse(field.value),
    }));
    const propertyCoverage = flattened.propertyCoverage;
    return {
      source_range: site.location,
      value_status: site.value.status,
      fields,
      property_coverage: propertyCoverage,
    };
  });
  return {
    shapes,
    omittedSites: 0,
    omittedFields: 0,
    omittedCoverage: 0,
  };
};
