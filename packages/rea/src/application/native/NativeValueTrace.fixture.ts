import {
  createAnalysisExecution,
  type AnalysisOperationPort,
} from "../AnalysisProvider.js";
import { ghidraFunctionDossier } from "../../domain/ghidraValues.fixture.js";
import { functionDossierSchema } from "../../domain/native/functionDossier.js";
import { jsonValueSchema } from "../../domain/jsonValue.js";
import { ok } from "../../domain/result.js";

/** Simulated provider seam for value traces; not a real decompiler observation. */
export const valueTraceSubject = {
  path: "/fixture",
  sha256: "a".repeat(64),
  format: "mach-o" as const,
  architecture: "arm64" as const,
};
export const valueTraceProvider = {
  id: "fixture",
  name: "Fixture",
  version: "1",
};
export const pcodeScalar = {
  kind: "constant",
  size_bytes: 4,
  location: null,
  constant_hex: "3",
};

/** A live one-input, one-output operation; a CALL passes one argument. */
export const pcodeOperation = (
  id: string,
  address: string,
  opcode: string,
) => ({
  id,
  address,
  sequence: 0,
  opcode,
  is_dead: true,
  block_membership: "member",
  inputs: [pcodeScalar, pcodeScalar],
  output: pcodeScalar,
});

export const nativeFlowDossier = (
  base: ReturnType<typeof functionDossierSchema.parse>,
  facts: {
    address: string;
    name: string;
    operations: ReturnType<typeof pcodeOperation>[];
    parameters: { ordinal: number; name: string; data_type: string }[];
  },
) => {
  const { address, name, operations, parameters } = facts;
  return jsonValueSchema.parse({
    ...base,
    procedure: {
      address,
      name,
      classification: null,
      body: {
        available: false,
        reason: "The provider did not report complete function body ranges.",
      },
      signature: null,
      locals: [],
    },
    native_value_flow: {
      available: true,
      provenance: "ghidra-high-pcode",
      operations,
      def_use: [],
      effects: [],
      parameters,
      parameter_uses: [],
      truncated: false,
      omitted_operations_lower_bound: 0,
      known_omitted_inputs: 0,
      known_omitted_edges: 0,
      limitations: [],
    },
  });
};

interface StaticProcedure {
  readonly operations: ReturnType<typeof pcodeOperation>[];
  readonly parameters?: { ordinal: number; name: string; data_type: string }[];
  readonly def_use?: { definition: string; use: string; input_index: number }[];
  readonly pcodeTruncated?: boolean;
}

interface GraphOptions {
  readonly sessionSubject?: boolean;
}

/** A static call graph whose call sites resolve to the listed destinations. */
export const staticValueGraph = (
  procedures: Readonly<Record<string, StaticProcedure>>,
  calls: Readonly<
    Record<
      string,
      readonly { destination: string; status: "direct" | "candidate" }[]
    >
  >,
  options: GraphOptions = {},
) => {
  // A production session binds an omitted subject to its opened target.
  const subject =
    options.sessionSubject === true ? {} : { subject: valueTraceSubject };
  const base = functionDossierSchema.parse(ghidraFunctionDossier());
  const analyzed: string[] = [];
  const resolved: string[] = [];
  const port: AnalysisOperationPort = {
    execute: async (operation, parameters) => {
      if (operation === "resolve_native_call_targets") {
        const address = String(parameters.address);
        resolved.push(address);
        const targets = calls[address] ?? [];
        const ambiguous = targets.some(({ status }) => status === "candidate");
        return ok(
          createAnalysisExecution(
            {
              call_site: address,
              procedure: ambiguous ? null : (targets[0]?.destination ?? null),
              status: ambiguous
                ? "ambiguous"
                : targets.length === 0
                  ? "unresolved"
                  : "direct",
              mechanism: ambiguous ? "computed" : "direct",
              targets: targets.map(({ destination, status }) => ({
                address: destination,
                procedure: destination,
                status,
                basis: "provider-reference",
                references: [],
              })),
              limitations: [],
            },
            valueTraceProvider,
            subject,
          ),
        );
      }
      if (operation !== "analyze_function")
        throw new Error(`Unexpected native trace operation: ${operation}`);
      const address = String(parameters.procedure);
      analyzed.push(address);
      const facts = procedures[address];
      if (facts === undefined) throw new Error(`Unexpected ${address}`);
      const dossier = functionDossierSchema.parse(
        nativeFlowDossier(base, {
          address,
          name: address,
          operations: facts.operations,
          parameters: facts.parameters ?? [],
        }),
      );
      if (!dossier.native_value_flow?.available)
        throw new Error("Invalid fixture");
      dossier.native_value_flow.def_use = facts.def_use ?? [];
      if (facts.pcodeTruncated === true) {
        dossier.native_value_flow.truncated = true;
        dossier.native_value_flow.omitted_operations_lower_bound = 1;
      }
      return ok(createAnalysisExecution(dossier, valueTraceProvider, subject));
    },
  };
  return { port, analyzed, resolved };
};

const copies = (address: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    ...pcodeOperation(`op-${String(index)}`, address, "COPY"),
    sequence: index,
  }));
const parameter = [{ ordinal: 0, name: "value", data_type: "/int" }];

/**
 * 0x1000 calls 0x2000 and 0x3000, and 0x2000 also calls 0x3000. With
 * max_depth 1, each one-argument call binds to its callee's single parameter:
 * 11 nodes and 9 edges, reached in breadth-first order.
 */
export const valueTraceDiamond = (options: GraphOptions = {}) =>
  staticValueGraph(
    {
      "0x1000": {
        operations: [
          pcodeOperation("call-b", "0x1004", "CALL"),
          pcodeOperation("call-c", "0x1008", "CALL"),
          ...copies("0x1000", 2),
        ],
        def_use: [{ definition: "op-0", use: "op-1", input_index: 0 }],
      },
      "0x2000": {
        operations: [
          pcodeOperation("call-c", "0x2004", "CALL"),
          pcodeOperation("x", "0x2000", "COPY"),
        ],
        parameters: parameter,
      },
      "0x3000": {
        operations: copies("0x3000", 3),
        parameters: parameter,
        def_use: [
          { definition: "op-0", use: "op-1", input_index: 0 },
          { definition: "op-1", use: "op-2", input_index: 0 },
        ],
      },
    },
    {
      "0x1004": [{ destination: "0x2000", status: "direct" }],
      "0x1008": [{ destination: "0x3000", status: "direct" }],
      "0x2004": [{ destination: "0x3000", status: "direct" }],
    },
    options,
  );
