import { Ajv2020 } from "ajv/dist/2020.js";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { toolContract } from "./toolContracts.js";
import { toolInputSchemaWithMetadata } from "./toolSchemaMetadata.js";

const view = { kind: "javascript-routes", collection: "routes" };
const cases = [
  ["analyze_javascript_application", { input_path: "/tmp/application" }],
  [
    "analyze_web_bundle",
    {
      cdp_endpoint: "http://127.0.0.1:9222",
      target_id: "page",
      allowed_origins: ["https://example.test"],
    },
  ],
] as const;

describe.each(cases)("%s delivery contract", (name, base) => {
  it.each(["draft-2020-12", "draft-07"] as const)(
    "advertises the canonical combinations in %s",
    (target) => {
      const contract = toolContract(name);
      const projected = toolInputSchemaWithMetadata(contract)[
        "~standard"
      ].jsonSchema.input({ target });
      const ajv =
        target === "draft-2020-12"
          ? new Ajv2020({ strict: false, validateFormats: false })
          : new Ajv({ strict: false, validateFormats: false });
      expect(ajv.validateSchema(projected)).toBe(true);
      const validate = ajv.compile(projected);
      expect(projected).toMatchObject({ type: "object" });
      expect(projected).not.toHaveProperty("anyOf");
      expect(projected).not.toHaveProperty("oneOf");
      expect(projected).not.toHaveProperty("allOf");
      expect(projected).not.toHaveProperty("x-rea-root-discriminator");
      const inputs = [
        [{}, true],
        [{ detail: "complete" }, true],
        [{ detail: "summary", view }, true],
        [{ detail: "summary" }, name === "analyze_javascript_application"],
        [{ view }, false],
        [{ detail: "complete", view }, false],
        [{ detail: "summary", view: { ...view, kind: "other" } }, false],
        [{ detail: "summary", view, unexpected: true }, false],
      ] as const;
      for (const [delivery, valid] of inputs) {
        const input = { ...base, ...delivery };
        expect(
          contract.inputSchema.safeParse(input).success,
          JSON.stringify(input),
        ).toBe(valid);
        expect(
          validate(input),
          JSON.stringify({ input, errors: validate.errors }),
        ).toBe(valid);
      }
    },
  );
});

it.each([{ detail: "complete" }, { detail: "summary", view }])(
  "preserves web deadline validation through $detail delivery",
  (delivery) => {
    const contract = toolContract("analyze_web_bundle");
    const base = cases[1][1];
    const invalid = contract.inputSchema.safeParse({
      ...base,
      ...delivery,
      analysis_timeout_ms: 40_000,
      total_analysis_timeout_ms: 30_000,
    });
    expect(invalid.success).toBe(false);
    if (!invalid.success)
      expect(invalid.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["analysis_timeout_ms"] }),
        ]),
      );
    const deadlines = {
      command_timeout_ms: 2_000,
      analysis_timeout_ms: 10_000,
      total_analysis_timeout_ms: 20_000,
      source_map_fetch_timeout_ms: 3_000,
    };
    expect(
      contract.inputSchema.parse({ ...base, ...delivery, ...deadlines }),
    ).toMatchObject({ ...delivery, ...deadlines });
  },
);
