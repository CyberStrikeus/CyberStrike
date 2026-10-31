import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import { z } from "zod";

import { canonicalBase64Schema } from "../domain/stringPatterns.js";
import { digestCanonicalValue } from "../domain/canonicalDigest.js";
import { toolContract } from "./toolContracts.js";
import {
  toolInputSchemaWithMetadata,
  toolOutputSchemaWithMetadata,
} from "./toolSchemaMetadata.js";

it.each(["draft-2020-12", "draft-07"] as const)(
  "retains native base64 metadata and intersections in both MCP directions: %s",
  (target) => {
    const literal = { pattern: "^(?!literal)annotation$" };
    const canonical = z.strictObject({
      encoded: z.intersection(canonicalBase64Schema, z.string().max(4)),
      literal: z
        .strictObject({ pattern: z.literal(literal.pattern) })
        .meta({ default: literal, examples: [literal] }),
    });
    const contract = {
      ...toolContract("open_binary"),
      inputSchema: canonical,
      outputSchema: canonical,
    };
    const input = toolInputSchemaWithMetadata(contract);
    const output = toolOutputSchemaWithMetadata(contract);
    const projectedInput = input["~standard"].jsonSchema.input({ target });
    const projectedOutput = output["~standard"].jsonSchema.output({ target });
    const { $id, ...withoutId } = projectedOutput;
    expect($id).toBe(
      `urn:rea:tool-output:sha256:${digestCanonicalValue({ target, schema: withoutId }, "Tool output schema")}`,
    );
    for (const projected of [projectedInput, projectedOutput]) {
      const properties = projected.properties as Record<string, unknown>;
      const literalProperty = properties.literal as Record<string, unknown>;
      const literalSchema =
        typeof literalProperty.$ref === "string"
          ? literalProperty.$ref
              .slice(2)
              .split("/")
              .reduce<unknown>(
                (value, key) => (value as Record<string, unknown>)[key],
                projected,
              )
          : literalProperty;
      expect(literalSchema).toMatchObject({
        default: literal,
        examples: [literal],
      });
      const Validator = target === "draft-2020-12" ? Ajv2020 : Ajv;
      const validate = new Validator({ strict: false }).compile(projected);
      for (const [encoded, valid] of [
        ["AA==", true],
        ["AB==", false],
        ["AAAAAA==", false],
      ] as const) {
        const value = { encoded, literal };
        expect(validate(value), encoded).toBe(valid);
        expect(input.safeParse(value).success, encoded).toBe(valid);
        expect(output.safeParse(value).success, encoded).toBe(valid);
      }
    }
  },
);
