import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { packetFieldsSchema } from "../domain/captures/packetCapture.js";
import { swiftStringLiteralSchema } from "../domain/native/swiftStringLiteral.js";
import { applicationVersionComparisonResultSchema } from "../domain/javascript/javascriptApplicationVersionComparisonSchemas.js";
import { kernelModuleSchema } from "../domain/native/kernelModule.js";
import { pinvokeVerificationSchema } from "../domain/managed/managedNativeVerificationSchemas.js";
import { relationshipCoverageSchema } from "../domain/relationshipCoverage.js";
import { compactAdvertisedInputSchema } from "./compactInputSchema.js";

const directions = [
  [],
  ["callers"],
  ["callees"],
  ["callers", "callees"],
  ["callees", "callers"],
  ["callers", "callers"],
  ["callees", "callees"],
  ["callers", "callees", "callers"],
  ["incoming"],
  [null],
  null,
];
const literal = {
  representation: "small",
  source_address: "0x1000",
  address: null,
  value: "hello",
  registers: ["x0", "x1"],
  words: ["0x6f6c6c6568", "0xe500000000000000"],
};
const ambiguousItem = {
  item_id: `javc_item_${"a".repeat(64)}`,
  node_kind: "javascript-module",
  status: "unknown",
  left_node_id: `jag_node_${"b".repeat(64)}`,
  right_node_id: null,
  match: {
    status: "ambiguous",
    basis: "none",
    confidence: "unknown",
    candidate_left_node_ids: [],
    candidate_right_node_ids: [`jag_node_${"c".repeat(64)}`],
  },
  dimensions: [],
  evidence_links: [`ev_${"d".repeat(64)}`, `ev_${"e".repeat(64)}`],
  limitations: [],
};
const verifiedCandidates = pinvokeVerificationSchema.options.find(
  (option) => option.shape.status.value === "verified",
)?.shape.candidates;
if (verifiedCandidates === undefined)
  throw new Error("Missing verified native candidate contract");
const nativeSymbol = {
  evidence_id: `ev_${"f".repeat(64)}`,
  operation: "analyze_function",
  name: "NativeEntry",
  address: "0x1000",
  module_name: null,
  module_path: null,
  source: "function-dossier",
};

const signatureInfo = {
  location: { offset: 16, bytes: 12 },
  algo: 0,
  hash: 0,
  id_type: 2,
  signer_len: 0,
  key_id_len: 0,
  pad: [0, 0, 0],
  sig_len: 16,
};

const cases: readonly {
  readonly name: string;
  readonly schema: z.ZodType;
  readonly samples: readonly {
    readonly value: unknown;
    readonly valid: boolean;
  }[];
}[] = [
  ...(["partial", "unknown"] as const).map((status) => ({
    name: `${status} relationship directions`,
    schema: relationshipCoverageSchema,
    samples: directions.map((limited_directions) => ({
      value: {
        status,
        ...(status === "partial"
          ? { limitations: ["Read limit reached."] }
          : { reason: "Coverage unavailable." }),
        limited_directions,
      },
      valid:
        Array.isArray(limited_directions) &&
        ['["callers"]', '["callees"]', '["callers","callees"]'].includes(
          JSON.stringify(limited_directions),
        ),
    })),
  })),
  {
    name: "nonempty managed native candidates",
    schema: verifiedCandidates,
    samples: [
      { value: [nativeSymbol], valid: true },
      { value: [nativeSymbol, nativeSymbol], valid: true },
      { value: [], valid: false },
      { value: [null], valid: false },
    ],
  },
  {
    name: "Swift register and word pairs",
    schema: swiftStringLiteralSchema,
    samples: [
      { value: literal, valid: true },
      ...["registers", "words"].flatMap((field) =>
        [[], ["x0"], ["x0", "x1", "x2"], ["x0", null], null].map((value) => ({
          value: { ...literal, [field]: value },
          valid: false,
        })),
      ),
    ],
  },
  {
    name: "kernel module signature pad bytes",
    schema: kernelModuleSchema.shape.signature.unwrap().shape.info.unwrap(),
    samples: [
      { value: signatureInfo, valid: true },
      ...[[], [0], [0, 0, 0, 0], [0, null, 0], [0, 256, 0], null].map(
        (pad) => ({ value: { ...signatureInfo, pad }, valid: false }),
      ),
    ],
  },
  {
    name: "packet frame numbers",
    schema: packetFieldsSchema,
    samples: [
      { value: { "frame.number": ["1"], "ip.addr": ["a", "b"] }, valid: true },
      ...[[], ["1", "2"], ["0"], [1], null].map((value) => ({
        value: { "frame.number": value },
        valid: false,
      })),
    ],
  },
  {
    name: "nonempty ambiguous application candidates",
    schema: applicationVersionComparisonResultSchema.shape.items,
    samples: [
      { value: [ambiguousItem], valid: true },
      {
        value: [
          {
            ...ambiguousItem,
            match: { ...ambiguousItem.match, candidate_right_node_ids: [] },
          },
        ],
        valid: false,
      },
    ],
  },
];

describe.each(["draft-2020-12", "draft-07"] as const)(
  "tuple JSON Schema parity in %s",
  (target) => {
    describe.each(["input", "output"] as const)("%s projection", (io) => {
      it.each(cases)("preserves $name", ({ schema, samples }) => {
        const projected = z.toJSONSchema(schema, { io, target });
        const ajv =
          target === "draft-2020-12"
            ? new Ajv2020({ strict: false, validateFormats: false })
            : new Ajv({ strict: false, validateFormats: false });
        expect(ajv.validateSchema(projected)).toBe(true);
        const validate = ajv.compile(projected);
        for (const { value, valid } of samples) {
          expect(schema.safeParse(value).success, JSON.stringify(value)).toBe(
            valid,
          );
          expect(validate(value), JSON.stringify(value)).toBe(valid);
        }
      });
    });
  },
);

describe("fixed tuple element guidance in advertised projections", () => {
  it.each(["draft-2020-12", "draft-07"] as const)(
    "keeps literal item guidance in full and compact %s projections",
    (target) => {
      const full = z.toJSONSchema(relationshipCoverageSchema, {
        io: "output",
        target,
      });
      for (const schema of [
        full,
        compactAdvertisedInputSchema(full, 64 * 1024).schema,
      ]) {
        const tupleSchemas: Record<string, unknown>[] = [];
        const visit = (value: unknown): void => {
          if (Array.isArray(value)) {
            value.forEach(visit);
          } else if (typeof value === "object" && value !== null) {
            const candidate = value as Record<string, unknown>;
            if (
              Array.isArray(candidate.prefixItems) ||
              (Array.isArray(candidate.items) && "additionalItems" in candidate)
            )
              tupleSchemas.push(candidate);
            Object.values(candidate).forEach(visit);
          }
        };
        visit(schema);

        expect(tupleSchemas).toHaveLength(6);
        for (const tuple of tupleSchemas) {
          expect(tuple).toMatchObject({
            type: "array",
            minItems: expect.any(Number),
            maxItems: expect.any(Number),
          });
          const positional = z
            .array(z.object({ const: z.string() }))
            .parse(tuple.prefixItems ?? tuple.items);
          const rest = tuple.prefixItems ? tuple.items : tuple.additionalItems;
          const ajv =
            target === "draft-2020-12"
              ? new Ajv2020({ strict: false })
              : new Ajv({ strict: false });
          const validateItem = ajv.compile(
            z.record(z.string(), z.unknown()).parse(rest),
          );
          for (const value of ["callers", "callees", "incoming", null])
            expect(validateItem(value), JSON.stringify(tuple)).toBe(
              positional.some((position) => position.const === value),
            );
        }
      }
    },
  );
});
