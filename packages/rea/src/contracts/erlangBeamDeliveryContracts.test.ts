import { Ajv2020 } from "ajv/dist/2020.js";
import { Ajv } from "ajv";
import { expect, it } from "vitest";
import { toolContract } from "./toolContracts.js";
import { toolInputSchemaWithMetadata } from "./toolSchemaMetadata.js";

const view = {
  kind: "beam",
  collection: "exports",
  fields: ["function"],
};

it.each(["draft-2020-12", "draft-07"] as const)(
  "advertises BEAM delivery combinations in %s",
  (target) => {
    const contract = toolContract("inspect_erlang_beam");
    const projected = toolInputSchemaWithMetadata(contract)[
      "~standard"
    ].jsonSchema.input({ target });
    const ajv =
      target === "draft-2020-12"
        ? new Ajv2020({ strict: false, validateFormats: false })
        : new Ajv({ strict: false, validateFormats: false });
    expect(ajv.validateSchema(projected)).toBe(true);
    expect(projected).toMatchObject({ type: "object" });
    for (const key of ["anyOf", "oneOf", "allOf", "x-rea-root-discriminator"])
      expect(projected).not.toHaveProperty(key);
    const validate = ajv.compile(projected);
    for (const [delivery, valid] of [
      [{}, true],
      [{ detail: "complete" }, true],
      [{ detail: "summary" }, true],
      [{ detail: "summary", view }, true],
      [
        {
          detail: "summary",
          view: { ...view, names: [], fields: [], indices: [] },
        },
        true,
      ],
      [{ view }, false],
      [{ detail: "complete", view }, false],
      [{ detail: "summary", view: { ...view, fields: ["missing"] } }, false],
      [{ detail: "summary", view: { ...view, kind: "native-exports" } }, false],
      [{ detail: "summary", view, unexpected: true }, false],
      [{ detail: "summary", view: { ...view, fields: ["name"] } }, false],
      [{ detail: "summary", view: { ...view, modules: ["erlang"] } }, false],
      [
        {
          detail: "summary",
          view: { ...view, collection: "imports", modules: ["erlang"] },
        },
        true,
      ],
      [
        {
          detail: "summary",
          view: { ...view, collection: "chunks", fields: ["payload"] },
        },
        true,
      ],
      [
        {
          detail: "summary",
          view: { ...view, collection: "atoms", fields: ["index", "name"] },
        },
        true,
      ],
      [
        {
          detail: "summary",
          view: { ...view, collection: "lambdas", fields: ["free_vars"] },
        },
        true,
      ],
    ] as const) {
      const input = { path: "/tmp/module.beam", ...delivery };
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
