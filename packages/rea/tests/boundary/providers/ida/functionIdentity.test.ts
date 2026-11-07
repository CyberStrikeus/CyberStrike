import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { functionDossierSchema } from "../../../../src/domain/native/functionDossier.js";
import {
  jsonValueSchema,
  type JsonValue,
} from "../../../../src/domain/jsonValue.js";
import { IdaSessionClient } from "../../../../src/ida/IdaSessionClient.js";
import { createIdaTarget, RecordingIdaMcp } from "../../../fixtures/idaMcp.js";

type IdentityCase = {
  label: string;
  fields: Readonly<Record<string, JsonValue>>;
};

const observationsSchema = z.object({
  observations: z.array(
    z.object({ tool: z.string(), result: jsonValueSchema }),
  ),
});
const observation = (raw: unknown, tool: string) =>
  observationsSchema.parse(raw).observations.find((item) => item.tool === tool)
    ?.result;

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

const session = async (
  mode: "attached" | "headless",
  fields: Readonly<Record<string, JsonValue>>,
) => {
  const { root, target } = await createIdaTarget();
  roots.push(root);
  const producer = new RecordingIdaMcp(target, mode);
  const fn = {
    [mode === "attached" ? "address" : "addr"]: "0x1000",
    name: "main",
    ...fields,
  };
  const page = { data: [fn], next_offset: null };
  const lookup = [{ query: "main", fn, error: null }];
  producer.overrideCall = (name) => {
    switch (name) {
      case "list_functions":
        return page;
      case "list_funcs":
        return [page];
      case "get_function_by_name":
        return fn;
      case "lookup_funcs":
        return lookup;
      case "get_callers":
      case "get_callees":
        return [];
      case "callees":
        return [{ callees: [], more: false }];
      default:
        return undefined;
    }
  };
  const client = new IdaSessionClient(
    {
      command: "fixture",
      args: [],
      env: {},
      mode,
      timeoutMs: 1000,
      workspaceRoot: root,
    },
    target,
    producer,
  );
  return {
    client,
    inventoryObservation: mode === "attached" ? page : [page],
    lookupObservation: mode === "attached" ? fn : lookup,
    lookupTool: mode === "attached" ? "get_function_by_name" : "lookup_funcs",
  };
};

describe.each(["attached", "headless"] as const)(
  "%s IDA function identity boundary",
  (mode) => {
    it.each<IdentityCase>([
      { label: "omitted", fields: {} },
      { label: "null", fields: { size: null } },
      { label: "malformed text", fields: { size: "unknown extent" } },
      { label: "malformed object", fields: { size: { unavailable: true } } },
    ])(
      "retains usable inventory and dossier identity with $label size and preserves exact observations",
      async ({ fields }) => {
        const fixture = await session(mode, fields);
        try {
          const inventory = await fixture.client.execute("list_procedures", {});
          if (!inventory.ok) throw inventory.error;
          expect(inventory.value.result).toEqual([
            { address: "0x1000", value: "main" },
          ]);
          expect(
            observation(
              inventory.value.rawResult,
              mode === "attached" ? "list_functions" : "list_funcs",
            ),
          ).toEqual(fixture.inventoryObservation);

          const analyzed = await fixture.client.execute("analyze_function", {
            procedure: "main",
          });
          if (!analyzed.ok) throw analyzed.error;
          const dossier = functionDossierSchema.parse(analyzed.value.result);
          expect(dossier.procedure).toMatchObject({
            address: "0x1000",
            name: "main",
            body: { available: false, reason: expect.any(String) },
          });
          expect(
            observation(analyzed.value.rawResult, fixture.lookupTool),
          ).toEqual(fixture.lookupObservation);
        } finally {
          expect((await fixture.client.close()).ok).toBe(true);
        }
      },
    );

    it.each<IdentityCase>([
      { label: "address", fields: { address: "invalid", addr: "invalid" } },
      { label: "name", fields: { name: null } },
    ])("rejects malformed $label despite unused size", async ({ fields }) => {
      const fixture = await session(mode, {
        ...fields,
        size: "unknown extent",
      });
      try {
        for (const operation of [
          "list_procedures",
          "procedure_address",
        ] as const) {
          const result = await fixture.client.execute(
            operation,
            operation === "procedure_address" ? { procedure: "main" } : {},
          );
          if (result.ok) throw new Error("Expected malformed identity to fail");
          expect(result.error._tag).toBe("AnalysisOutputError");
          const partial = result.error.partialObservation;
          if (partial === undefined || !("raw_result" in partial))
            throw new Error("Expected retained IDA Evidence");
          expect(
            observation(
              partial.raw_result,
              operation === "list_procedures"
                ? mode === "attached"
                  ? "list_functions"
                  : "list_funcs"
                : fixture.lookupTool,
            ),
          ).toEqual(
            operation === "list_procedures"
              ? fixture.inventoryObservation
              : fixture.lookupObservation,
          );
        }
      } finally {
        expect((await fixture.client.close()).ok).toBe(true);
      }
    });
  },
);
