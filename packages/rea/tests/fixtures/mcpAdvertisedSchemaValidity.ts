import { Ajv2020 } from "ajv/dist/2020.js";

import {
  arrayItemSchemaError,
  unsupportedInputLiteralSchemaError,
} from "./mcpClientSchemaConstraints.js";

/** Advertised schema pair as a client receives it from `tools/list`. */
export interface AdvertisedToolSchemas {
  readonly name: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown> | undefined;
}

/**
 * Validate advertised schemas as clients receive them: Ajv's declared-dialect
 * meta-schema and reference resolution, then the constraints a real client
 * enforces. Compiling catches a compact projection that drops a referenced
 * definition or leaves a local `$ref` without its target, which a byte-budget
 * assertion alone would not.
 */
export function advertisedSchemaErrors(
  tools: readonly AdvertisedToolSchemas[],
): string[] {
  // Reuse Ajv's meta-schema validators, then clear each root's reference
  // namespace, including nested IDs, before validating the next schema.
  const ajv = new Ajv2020({
    strict: false,
    validateFormats: false,
    addUsedSchema: false,
    // This check compiles schemas to detect invalid references but never runs
    // their validators. Generated-code optimization adds substantial work here
    // without checking another contract; actual SDK validators keep defaults.
    code: { optimize: false },
  });
  return tools.flatMap((tool) =>
    ["inputSchema", "outputSchema"].flatMap((kind) => {
      const schema =
        kind === "inputSchema" ? tool.inputSchema : tool.outputSchema;
      if (schema === undefined) return [];
      try {
        if (!ajv.validateSchema(schema))
          return [`${tool.name}.${kind}: ${ajv.errorsText(ajv.errors)}`];
        ajv.compile(schema);
        const clientError = arrayItemSchemaError(
          schema,
          `${tool.name}.${kind}`,
        );
        if (clientError !== undefined) return [clientError];
        if (kind === "inputSchema") {
          const literalError = unsupportedInputLiteralSchemaError(
            schema,
            `${tool.name}.${kind}`,
          );
          if (literalError !== undefined) return [literalError];
        }
        return [];
      } catch (cause: unknown) {
        return [
          `${tool.name}.${kind}: ${cause instanceof Error ? cause.message : String(cause)}`,
        ];
      } finally {
        ajv.removeSchema();
      }
    }),
  );
}
