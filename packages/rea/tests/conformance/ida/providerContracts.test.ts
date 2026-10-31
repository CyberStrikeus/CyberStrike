import { IDA_COMPATIBILITY_PROFILES } from "../../../src/ida/IdaConfiguration.js";
import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from "@modelcontextprotocol/server";
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createIdaTarget, RecordingIdaMcp } from "../../fixtures/idaMcp.js";
import { IdaSessionClient } from "../../../src/ida/IdaSessionClient.js";
import {
  IDA_OPERATIONS,
  idaCapabilities,
} from "../../../src/ida/IdaProviderCapabilities.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import type { JsonValue } from "../../../src/domain/jsonValue.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";

const delivery = createToolResultDelivery(STDIO_DEFAULT_MAX_BUFFER_SIZE);

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
/** Pinned upstream tools that navigate an active IDA GUI as a side effect. */
const GUI_NAVIGATING_TOOLS: ReadonlySet<string> = new Set([
  "disassemble_function",
  "decompile_function",
]);

const parametersFor = (
  operation: string,
): Readonly<Record<string, JsonValue>> => {
  if (operation.startsWith("search_")) return { pattern: "a.b" };
  if (operation === "xrefs" || operation === "resolve_containing_procedure")
    return { address: "0x1000" };
  if (operation.startsWith("list_")) return {};
  return { procedure: "main" };
};

/** Operations only the headless profile declares. */
const HEADLESS_ONLY: ReadonlySet<string> = new Set([
  "resolve_containing_procedure",
  "list_documents",
]);

describe.each(["attached", "headless"] as const)(
  "IDA %s caller-visible contracts",
  (mode) => {
    const operations = IDA_OPERATIONS.filter(
      (operation) => mode === "headless" || !HEADLESS_ONLY.has(operation),
    );
    it("includes the baseline operations needed by this contract matrix", () => {
      expect(operations).toContain("list_procedures");
      if (mode === "headless")
        expect(operations).toContain("resolve_containing_procedure");
    });
    it.each(operations)(
      "declares %s UI effects matching the upstream tools it reaches",
      async (operation) => {
        const { root, target } = await createIdaTarget();
        roots.push(root);
        const producer = new RecordingIdaMcp(target, mode);
        const client = new IdaSessionClient(
          {
            command: "fixture",
            args: [],
            env: {},
            mode,
            workspaceRoot: root,
            timeoutMs: 1000,
          },
          target,
          producer,
        );
        try {
          const execution = await client.execute(
            operation,
            parametersFor(operation),
          );
          if (mode === "headless" && operation === "procedure_callers")
            expect(execution).toMatchObject({
              ok: false,
              error: { _tag: "AnalysisCapabilityUnavailableError" },
            });
          else if (!execution.ok) throw execution.error;
        } finally {
          expect((await client.close()).ok).toBe(true);
        }
        const descriptor = idaCapabilities(
          IDA_COMPATIBILITY_PROFILES[mode === "attached" ? "legacy" : "modern"],
          true,
        ).find((capability) => capability.operation === operation);
        expect(descriptor?.effects.mayShowUi).toBe(
          producer.calls.some(({ name }) => GUI_NAVIGATING_TOOLS.has(name)),
        );
      },
    );

    it.each(operations)(
      "serializes %s against its named advertised output contract",
      async (operation) => {
        const { root, target } = await createIdaTarget();
        roots.push(root);
        const client = new IdaSessionClient(
          {
            command: "fixture",
            args: [],
            env: {},
            mode,
            workspaceRoot: root,
            timeoutMs: 1000,
          },
          target,
          new RecordingIdaMcp(target, mode),
        );
        try {
          const parameters = parametersFor(operation);
          const execution = await client.execute(operation, parameters);
          if (mode === "headless" && operation === "procedure_callers") {
            expect(execution.ok).toBe(false);
            if (!execution.ok)
              expect(execution.error._tag).toBe(
                "AnalysisCapabilityUnavailableError",
              );
            return;
          }
          if (!execution.ok) throw execution.error;
          const evidence = createEvidence(target, execution.value.provider, {
            operation,
            parameters,
            result: execution.value.result,
            rawResult: execution.value.rawResult,
            locations: execution.value.locations,
            limitations: execution.value.limitations,
          });
          const contract = toolContract(operation);
          const serialized = delivery.toEvidenceToolResult(
            evidence,
            contract,
            undefined,
          );
          expect(
            contract.outputSchema.safeParse(serialized.structuredContent)
              .success,
          ).toBe(true);
          expect(serialized.content[0]).toEqual({
            type: "text",
            text: JSON.stringify(serialized.structuredContent),
          });
        } finally {
          expect((await client.close()).ok).toBe(true);
        }
      },
    );
  },
);
