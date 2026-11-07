import { expect, it } from "vitest";
import { createMcpSchemaValidation } from "../../fixtures/mcpSchemaValidation.js";

it("reuses equal schemas and recompiles changed schemas sharing an id", () => {
  const validation = createMcpSchemaValidation();
  try {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://fixture.test/result",
      type: "string" as "string" | "integer",
    };
    const first = validation.getValidator(schema);
    expect(validation.getValidator(structuredClone(schema))).toBe(first);
    expect(first("recorded").valid).toBe(true);
    expect(first(42).valid).toBe(false);
    expect(validation.assertions.validate(schema, "recorded")).toBe(true);
    expect(validation.assertions.validate(schema, 42)).toBe(false);

    schema.type = "integer";
    const changed = validation.getValidator(schema);
    expect(changed).not.toBe(first);
    expect(changed(42).valid).toBe(true);
    expect(changed("recorded").valid).toBe(false);
    expect(validation.assertions.validate(schema, 42)).toBe(true);
    expect(validation.assertions.validate(schema, "recorded")).toBe(false);

    validation.clear();
    expect(validation.getValidator(schema)).not.toBe(changed);
  } finally {
    validation.clear();
  }
});

it("preserves SDK format validation and declared dialect dispatch", () => {
  const validation = createMcpSchemaValidation();
  try {
    const schema = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "string",
      format: "email",
    } as const;
    const validator = validation.getValidator(schema);
    expect(validator("analyst@example.test").valid).toBe(true);
    expect(validator("invalid email").valid).toBe(false);
    // Explicit schema assertions retain their separate format-off policy.
    expect(
      validation.assertions.validate(
        { type: "string", format: "email" },
        "invalid email",
      ),
    ).toBe(true);
    expect(
      validation.assertions.validateSchema({ type: "string", minLength: -1 }),
    ).toBe(false);
  } finally {
    validation.clear();
  }
});

it("owns nested schema values independently of later caller mutation", () => {
  const validation = createMcpSchemaValidation();
  try {
    const schema = { enum: [{ state: "recorded" }, { state: "other" }] };
    const originalSchema = structuredClone(schema);
    const original = validation.getValidator(schema);
    expect(validation.assertions.validate(schema, { state: "recorded" })).toBe(
      true,
    );
    schema.enum[0]!.state = "changed";
    const changed = validation.getValidator(schema);
    expect(original({ state: "recorded" }).valid).toBe(true);
    expect(original({ state: "changed" }).valid).toBe(false);
    expect(changed({ state: "changed" }).valid).toBe(true);
    expect(changed({ state: "recorded" }).valid).toBe(false);
    expect(
      validation.assertions.validate(originalSchema, { state: "recorded" }),
    ).toBe(true);
    expect(validation.assertions.validate(schema, { state: "recorded" })).toBe(
      false,
    );
    expect(validation.assertions.validate(schema, { state: "changed" })).toBe(
      true,
    );
  } finally {
    validation.clear();
  }
});
