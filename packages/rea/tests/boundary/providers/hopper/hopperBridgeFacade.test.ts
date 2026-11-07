import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OFFICIAL_TOOL_CONTRACTS } from "../../../../src/contracts/officialToolContracts.js";
import { nativeSymbolMetadataSchema } from "../../../../src/domain/native/nativeSymbol.js";
import { functionDossierSchema } from "../../../../src/domain/native/functionDossier.js";

const execute = promisify(execFile);
const bridgePath = new URL(
  "../../../../bridge/hopper_bridge.py",
  import.meta.url,
);
const probePath = new URL(
  "../../../fixtures/hopperBridgeFacadeProbe.py",
  import.meta.url,
);

const probeResultSchema = z.strictObject({
  imported_without_hopper: z.strictObject({
    type: z.literal("CapabilityUnavailableError"),
    diagnostic_type: z.literal("capability_unavailable"),
  }),
  current_document: z.literal("fixture"),
  current_address: z.literal("0x401000"),
  containing_procedure: z.strictObject({
    query_address: z.literal("0x401000"),
    found: z.literal(true),
    procedure: z.strictObject({
      address: z.literal("0x401000"),
      name: z.literal("fixture-procedure"),
      symbol: nativeSymbolMetadataSchema.nullable(),
      classification: z.null(),
      body: z.strictObject({
        available: z.literal(false),
        reason: z.string(),
      }),
    }),
  }),
  procedure_info: z.strictObject({
    name: z.literal("fixture-procedure"),
    entrypoint: z.literal("0x401000"),
    basicblock_count: z.literal(1),
    length: z.number(),
    signature: z.literal("int fixture-procedure()"),
    locals: z.array(z.unknown()),
    symbol: nativeSymbolMetadataSchema.nullable(),
    classification: z.null(),
    body: z.strictObject({
      available: z.literal(false),
      reason: z.string(),
    }),
  }),
  analyze_function: z.unknown(),
  procedure_references: z.strictObject({
    procedure: z.strictObject({
      address: z.literal("0x401000"),
      name: z.literal("fixture-procedure"),
      symbol: nativeSymbolMetadataSchema.nullable(),
      classification: z.null(),
      body: z.strictObject({
        available: z.literal(false),
        reason: z.string(),
      }),
    }),
    direction: z.literal("outgoing"),
    reference_kinds_available: z.literal(false),
    unresolved_calls: z.array(z.unknown()),
    references: z.array(z.unknown()),
  }),
  provider_faults: z.array(
    z.strictObject({
      id: z.literal(1),
      error: z.strictObject({
        code: z.literal(-32000),
        message: z.string(),
        type: z.literal("bridge_exception"),
      }),
    }),
  ),
  malformed_requests: z.array(z.unknown()),
  session_document_reused: z.literal(true),
  shared_document_shutdown: z.strictObject({
    shutdown: z.literal(true),
    analysis_stopped: z.literal(false),
    document_closed: z.literal(false),
    document_retained: z.literal(true),
  }),
  analysis_guard: z.strictObject({
    type: z.literal("CapabilityUnavailableError"),
    diagnostic_type: z.literal("capability_unavailable"),
    message: z.string(),
  }),
  bridge_messages: z.tuple([
    z.strictObject({
      id: z.literal(7),
      event: z.strictObject({
        type: z.literal("progress"),
        phase: z.literal("hopper_bridge"),
        completed: z.literal(0),
        total: z.literal(1),
        message: z.literal("Hopper bridge started request"),
      }),
    }),
    z.strictObject({
      id: z.literal(7),
      event: z.strictObject({
        type: z.literal("diagnostic"),
        error: z.strictObject({
          code: z.literal(-32000),
          message: z.literal("RuntimeError: Hopper bridge operation failed"),
          type: z.literal("bridge_exception"),
        }),
      }),
    }),
    z.strictObject({
      id: z.literal(7),
      error: z.strictObject({
        code: z.literal(-32000),
        message: z.literal("RuntimeError: Hopper bridge operation failed"),
        type: z.literal("bridge_exception"),
      }),
    }),
  ]),
  invalid_id_response: z.strictObject({
    id: z.literal(0),
    error: z.strictObject({
      code: z.literal(-32000),
      message: z.literal("Invalid bridge request id"),
      type: z.literal("invalid_request"),
    }),
  }),
});

describe("Hopper API facade", () => {
  it("imports without Hopper globals and gates exhaustive work during analysis", async () => {
    const { stdout } = await execute(
      "python3",
      [fileURLToPath(probePath), fileURLToPath(bridgePath)],
      {
        encoding: "utf8",
        timeout: 3_000,
        maxBuffer: 1_024 * 1_024,
      },
    );
    const result = probeResultSchema.parse(JSON.parse(stdout));
    for (const [name, value] of [
      ["resolve_containing_procedure", result.containing_procedure],
      ["procedure_references", result.procedure_references],
      ["procedure_info", result.procedure_info],
    ] as const) {
      const contract = OFFICIAL_TOOL_CONTRACTS.find(
        (candidate) => candidate.name === name,
      );
      if (contract === undefined) throw new Error(`missing ${name} contract`);
      const parsed =
        contract.outputSchema.shape.normalized_result.safeParse(value);
      if (!parsed.success) throw new Error(`${name}: ${parsed.error.message}`);
      expect(parsed.success, name).toBe(true);
    }
    const dossier = functionDossierSchema.parse(result.analyze_function);
    expect(dossier).toMatchObject({
      procedure: {
        classification: null,
        body: {
          available: false,
          reason:
            "Hopper's public Python API does not expose complete function body ranges",
        },
      },
      native_api: null,
      native_value_flow: null,
      facet_availability: {
        pseudocode: {
          available: false,
          reason: "Hopper did not supply pseudocode.",
        },
        assembly: { available: true },
        comments: { available: true },
        callers: { available: true },
        callees: { available: true },
        references: { available: true },
        strings_names: { available: true },
        cfg: { available: true },
      },
    });
    expect(result.provider_faults.map((reply) => reply.error.message)).toEqual([
      "TypeError: Hopper bridge operation failed",
      "ValueError: Hopper bridge operation failed",
      "KeyError: Hopper bridge operation failed",
    ]);
    expect(result.malformed_requests).toEqual([
      ...[
        [0, "Invalid bridge request JSON"],
        [0, "Invalid bridge request JSON"],
        [0, "Invalid bridge request shape"],
        [0, "Invalid bridge request shape"],
        [0, "Invalid bridge request shape"],
        [2, "Invalid bridge method or parameters"],
        [3, "Invalid bridge method or parameters"],
        [0, "Invalid bridge request id"],
        [4, "Address must be a string"],
        [5, "Byte-read length must be an integer"],
        [6, "case_sensitive must be a boolean"],
        [7, "Unknown bridge method"],
      ].map(([id, message]) => ({
        id,
        error: {
          code: -32000,
          type: "invalid_request",
          message,
        },
      })),
      {
        id: 8,
        error: {
          code: -32000,
          type: "authorization",
          message: "Invalid bridge capability",
        },
      },
      { id: 9, result: "0x401000" },
    ]);
    expect(stdout).not.toContain("supersecret");
    expect(result.analysis_guard.message).toContain(
      "requires completed Hopper background analysis",
    );
  });
});
