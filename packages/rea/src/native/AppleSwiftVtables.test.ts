import { describe, expect, it } from "vitest";

import { objcSwiftMetadataSchema } from "../domain/native/objcSwiftMetadata.js";
import { pushDispatchCoverage } from "./AppleDispatchCoverage.js";
import { createSwiftClassVtableDecoder } from "./AppleSwiftVtables.js";
import {
  decodeSwiftNominalTypes,
  createSwiftContextReader,
  type SwiftNominalReaders,
} from "./AppleSwiftNominalTypes.js";
import { decodeSwiftDispatchFacets } from "./AppleSwiftDispatchFacets.js";
import type { DispatchRecordBudget } from "./AppleSwiftDispatchFacets.js";
import { issue } from "./AppleDispatchDecodeFacts.js";

it("preserves unsupported type-metadata tag reasons instead of reporting null", () => {
  const result = objcSwiftMetadataSchema.parse({ db_save_result: null });
  const vtables = createSwiftClassVtableDecoder({
    result,
    readers: {
      u32: () => 0,
      relative: () => ({ kind: "null" }),
      location: (address) => ({
        address: `0x${address.toString(16)}`,
        file_offset: Number(address),
      }),
      evidence: () => [],
      executable: () => false,
      admit: () => true,
    },
  });
  const nominalReaders: SwiftNominalReaders = {
    u32: () => 0,
    relative: () => ({
      kind: "unknown",
      reason: "Unsupported Swift type metadata record tag 2",
    }),
    string: () => "unused",
    location: (address) => ({
      address: `0x${address.toString(16)}`,
      file_offset: Number(address),
    }),
    evidence: () => [],
    executable: () => false,
    admit: () => true,
  };
  const nominal = decodeSwiftNominalTypes({
    entries: [0x100n],
    result,
    visitor: vtables.visitor,
    readers: nominalReaders,
    contextReader: createSwiftContextReader(nominalReaders),
  });
  const facts = vtables.facts();

  expect(nominal.issues).toMatchObject([
    {
      code: "type_decode_failed",
      message: "Unsupported Swift type metadata record tag 2",
    },
  ]);
  expect(facts.issues).toMatchObject([
    {
      code: "vtable_decode_failed",
      message: "Unsupported Swift type metadata record tag 2",
      location: "0x100",
    },
  ]);
  expect(facts.issues[0]?.message).not.toContain("Null Swift");
});

it("preserves a required conformance pointer's unknown reason", () => {
  const result = objcSwiftMetadataSchema.parse({ db_save_result: null });
  const facts = decodeSwiftDispatchFacets({
    sections: [{ name: "__swift5_proto", address: 0x100n, size: 4 }],
    segments: [],
    readers: {
      u32: () => 0,
      pointer: () => 0n,
      resolvePointer: () => ({ kind: "raw", target: 0n }),
      string: () => "unused",
      location: (address) => ({
        address: `0x${address.toString(16)}`,
        file_offset: Number(address),
      }),
      targetLocation: (address) => ({
        address: `0x${address.toString(16)}`,
        file_offset: Number(address),
      }),
      evidence: () => [],
      offset: (address) => Number(address),
    },
    relative: () => ({
      kind: "unknown",
      reason: "Unsupported Swift conformance record tag 3",
    }),
    budget: {
      truncated: false,
      isFull: () => false,
      markTruncated: () => {},
      admit: () => true,
    },
    result,
  });

  expect(facts.issues).toMatchObject([
    {
      code: "conformance_decode_failed",
      message: "Unsupported Swift conformance record tag 3",
    },
  ]);
});

it("counts examined slots and reports an unresolved async slot", () => {
  const result = objcSwiftMetadataSchema.parse({ db_save_result: null });
  const values = new Map<bigint, number>([
    [0x200n, 0x80000010], // class descriptor with a vtable
    [0x22cn, 0], // table offset
    [0x230n, 2], // slot count
    [0x21cn, 2], // descriptor positive words
    [0x234n, 0x40], // async method flag
  ]);
  const vtables = createSwiftClassVtableDecoder({
    result,
    readers: {
      u32: (address) => values.get(address) ?? 0,
      relative: () => ({ kind: "target", target: 0x400n }),
      location: (address) => ({
        address: `0x${address.toString(16)}`,
        file_offset: Number(address),
      }),
      evidence: (address, description) => [
        {
          kind: "binary_metadata",
          description,
          location: {
            address: `0x${address.toString(16)}`,
            file_offset: Number(address),
          },
          artifact_path: "/fixture",
          artifact_sha256: "a".repeat(64),
        },
      ],
      executable: (address) => address === 0x400n,
      admit: () => true,
    },
  });
  vtables.visitor.descriptor({
    record: 0x100n,
    descriptor: 0x200n,
    flags: 0x80000010,
    name: "Widget",
    context: {
      module: "Test",
      path: "Widget",
      depth: 2,
      anonymous: false,
      reason: null,
      walkLimited: false,
    },
  });
  const facts = vtables.facts();

  expect(result.swift_dispatch_slots[0]?.decode.status).toBe("partial");
  expect(result.swift_dispatch_slots[1]?.decode.status).toBe("decoded");
  expect(facts).toMatchObject({
    facet: "swift_class_vtable_descriptors",
    examined: 2,
    decoded: 1,
    exhaustive: false,
    issues: [{ code: "vtable_implementation_unresolved", location: "0x234" }],
  });

  pushDispatchCoverage({
    result,
    failures: [],
    categoryIssues: [],
    examined: 0,
    categoriesExamined: 0,
    truncated: false,
    objcListScanTruncated: false,
    objcClassListScanTruncated: false,
    fixups: {
      kind: "none",
      formats: [],
      failures: [],
      issues: [],
      decode: (_address, raw) => ({ kind: "rebase", target: raw }),
      examined: 0,
      decoded: 0,
      legacyRebaseStreams: 0,
      legacyBindStreams: 0,
      unreadRebaseBytes: 0,
      hasUnresolvedLegacyBytes: () => false,
    },
    declarations: {
      facet: "swift_declarations",
      examined: 0,
      decoded: 0,
      exhaustive: true,
      issues: [],
    },
    swift: {
      facet: "swift_conformances_static_witness_slots",
      examined: 0,
      decoded: 0,
      exhaustive: true,
      issues: [],
    },
    vtables: facts,
  });

  expect(
    result.coverage.find(
      ({ facet }) => facet === "swift_class_vtable_descriptors",
    ),
  ).toMatchObject({
    status: "partial",
    examined: 2,
    decoded: 1,
    reason: expect.stringContaining("0x234"),
  });
});

it("returns a located issue for an emitted unresolved witness slot", () => {
  const result = objcSwiftMetadataSchema.parse({ db_save_result: null });
  const values = new Map<bigint, number>([
    [0x20cn, 0], // simple, unconditional conformance
    [0x500n, 3], // protocol descriptor kind
    [0x800n, 0], // module context
    [0x50cn, 0], // signature count
    [0x510n, 1], // witness requirement count
    [0x2b0n, 16], // nominal type descriptor kind
    [0x518n, 1], // function witness requirement
  ]);
  const budget: DispatchRecordBudget = {
    truncated: false,
    isFull: () => false,
    markTruncated: () => {
      budget.truncated = true;
    },
    admit: () => true,
  };
  const facts = decodeSwiftDispatchFacets({
    sections: [{ name: "__swift5_proto", address: 0x100n, size: 4 }],
    segments: [],
    readers: {
      u32: (address) => values.get(address) ?? 0,
      pointer: (address) => (address === 0x380n ? 0x200n : 0x900n),
      resolvePointer: (address) => ({
        kind: "raw",
        target: address === 0x380n ? 0x200n : 0x900n,
      }),
      string: (address) => (address === 0x600n ? "Proto" : "Widget"),
      location: (address) => ({
        address: `0x${address.toString(16)}`,
        file_offset: Number(address),
      }),
      targetLocation: (address) => ({
        address: `0x${address.toString(16)}`,
        file_offset: Number(address),
      }),
      evidence: (address, description) => [
        {
          kind: "binary_metadata",
          description,
          location: {
            address: `0x${address.toString(16)}`,
            file_offset: Number(address),
          },
          artifact_path: "/fixture",
          artifact_sha256: "a".repeat(64),
        },
      ],
      offset: (address) => Number(address),
    },
    relative: (field) => ({
      kind: "target",
      target:
        new Map<bigint, bigint>([
          [0x100n, 0x200n],
          [0x200n, 0x500n],
          [0x508n, 0x600n],
          [0x504n, 0x800n],
          [0x808n, 0x820n],
          [0x204n, 0x2b0n],
          [0x2b8n, 0x700n],
          [0x208n, 0x380n],
        ]).get(field) ?? 0n,
    }),
    budget,
    result,
  });

  expect(result.swift_dispatch_slots[0]?.decode.status).toBe("partial");
  expect(facts).toMatchObject({
    facet: "swift_conformances_static_witness_slots",
    exhaustive: false,
    issues: [{ code: "witness_slot_unresolved", location: "0x388" }],
  });
});

describe("Swift vtable coverage facts: unsupported pointer fixup coverage", () => {
  it("marks pointer fixup coverage partial for an unsupported format with no decoded pointers", () => {
    const result = objcSwiftMetadataSchema.parse({ db_save_result: null });
    pushDispatchCoverage({
      result,
      failures: [],
      categoryIssues: [],
      examined: 0,
      categoriesExamined: 0,
      truncated: false,
      objcListScanTruncated: false,
      objcClassListScanTruncated: false,
      fixups: {
        kind: "chained",
        formats: ["format-99"],
        failures: ["Unsupported chained pointer format 99"],
        issues: [
          issue(
            "pointer_fixups",
            "unsupported_pointer_format",
            "Unsupported chained pointer format 99",
            "0x1000",
          ),
        ],
        decode: () => ({
          kind: "unsupported",
          reason: "Unsupported chained pointer format 99",
        }),
        examined: 0,
        decoded: 0,
        legacyRebaseStreams: 0,
        legacyBindStreams: 0,
        unreadRebaseBytes: 0,
        hasUnresolvedLegacyBytes: () => false,
      },
      declarations: {
        facet: "swift_declarations",
        examined: 0,
        decoded: 0,
        exhaustive: true,
        issues: [],
      },
      swift: {
        facet: "swift_conformances_static_witness_slots",
        examined: 0,
        decoded: 0,
        exhaustive: true,
        issues: [],
      },
      vtables: {
        facet: "swift_class_vtable_descriptors",
        examined: 0,
        decoded: 0,
        exhaustive: true,
        issues: [],
      },
    });

    expect(
      result.coverage.find(({ facet }) => facet === "pointer_fixups"),
    ).toMatchObject({
      status: "partial",
      examined: 0,
      decoded: 0,
      reason: expect.stringContaining("0x1000"),
    });
  });
});
