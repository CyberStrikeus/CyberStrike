import type {
  JsonSchemaType,
  JsonSchemaValidator,
} from "@modelcontextprotocol/client";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";

/** Share immutable schema preparation within one test file, never its sessions. */
export const createMcpSchemaValidation = () => {
  const sdkValidators = new Map<string, JsonSchemaValidator<unknown>>();
  const assertionValidators = new Map<string, ValidateFunction>();
  const meta = new Ajv2020({ strict: false, validateFormats: false });
  let errors: unknown = null;
  return {
    getValidator<T>(
      schema: JsonSchemaType | Readonly<Record<string, unknown>>,
    ): JsonSchemaValidator<T> {
      const key = JSON.stringify(schema);
      let validator = sdkValidators.get(key);
      if (validator === undefined) {
        // Each full schema owns its default provider, including dialect dispatch.
        // Distinct schemas may legally reuse the same $id in separate servers.
        validator = new AjvJsonSchemaValidator().getValidator(JSON.parse(key));
        sdkValidators.set(key, validator);
      }
      return validator as JsonSchemaValidator<T>;
    },
    assertions: {
      get errors() {
        return errors;
      },
      validateSchema(schema: Record<string, unknown>) {
        const valid = meta.validateSchema(schema);
        errors = meta.errors;
        return valid;
      },
      validate(schema: Record<string, unknown>, value: unknown) {
        const key = JSON.stringify(schema);
        let validator = assertionValidators.get(key);
        if (validator === undefined) {
          // Preserve the explicit assertions' existing options, independently
          // of the SDK default provider's format/all-errors policy.
          validator = new Ajv2020({
            strict: false,
            validateFormats: false,
          }).compile(JSON.parse(key));
          assertionValidators.set(key, validator);
        }
        const valid = validator(value);
        errors = validator.errors;
        return valid;
      },
    },
    clear() {
      sdkValidators.clear();
      assertionValidators.clear();
      meta.removeSchema();
      errors = null;
    },
  };
};
