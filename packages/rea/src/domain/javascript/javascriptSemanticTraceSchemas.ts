import { z } from "zod";

import { evidenceSchema } from "../evidence.js";
import {
  javaScriptSemanticQueryInputSchema,
  javaScriptSemanticQueryResultSchema,
} from "./javascriptSemanticQuerySchemas.js";
import { prefixedDigestSchema } from "../digests.js";

const evidenceIdSchema = prefixedDigestSchema("ev");

/** Authenticated application Evidence plus one bounded semantic query. */
export const traceJavaScriptSemanticsInputSchema = z.strictObject({
  application: evidenceSchema,
  query: javaScriptSemanticQueryInputSchema,
});

/** Evidence-linked semantic query result shared by CLI and MCP. */
export const javaScriptSemanticTraceResultSchema =
  javaScriptSemanticQueryResultSchema.extend({
    source_evidence_id: evidenceIdSchema,
    evidence_links: z.array(evidenceIdSchema).length(1),
  });

/** Validated Evidence-linked semantic trace result. */
export type JavaScriptSemanticTraceResult = z.infer<
  typeof javaScriptSemanticTraceResultSchema
>;
