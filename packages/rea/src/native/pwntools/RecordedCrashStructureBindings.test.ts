import { expect, it } from "vitest";
import { recordedCrashSchema } from "../../domain/native/recordedCrash.js";
import {
  recordedCrashFixture,
  recordedCrashFixtureBytes,
} from "../../../tests/fixtures/binaryDiagnostics/recordedCrash.js";
import { validateRecordedCrashStructure } from "./RecordedCrashStructureBindings.js";

it.each([
  ["aarch64-little-endian", 0x70000000, "PT_AARCH64_ARCHEXT"],
  ["aarch64-little-endian", 0x70000001, "PT_AARCH64_UNWIND"],
  ["aarch64-little-endian", 0x70000003, 0x70000003],
  ["x86_64-little-endian", 0x70000001, 0x70000001],
] as const)(
  "binds %s header type %i independently of its decoder label %s",
  (architecture, typeId, label) => {
    const report = recordedCrashFixture(undefined, architecture);
    report.segments[0]!.type_id = typeId;
    report.segments[0]!.type = label;
    report.notes = [];
    report.threads = [];
    const bytes = recordedCrashFixtureBytes(report);
    const parsed = recordedCrashSchema.parse(report);
    expect(() =>
      validateRecordedCrashStructure(parsed, bytes, parsed.decoder_diagnostics),
    ).not.toThrow();
    bytes.writeUInt32LE(typeId + 1, 64);
    expect(() =>
      validateRecordedCrashStructure(parsed, bytes, parsed.decoder_diagnostics),
    ).toThrow(/original ELF\/note headers/);
  },
);

it.each([3, 0x46494c45])(
  "retains GNU-owned numeric note %i without CORE interpretation",
  (typeId) => {
    const report = recordedCrashFixture();
    report.notes[0]!.type_id = typeId;
    report.notes[0]!.type = typeId;
    report.notes[0]!.owner_bytes_base64 =
      Buffer.from("GNU\0\0").toString("base64");
    report.notes[0]!.owner_display = "GNU";
    report.threads = [];
    const bytes = recordedCrashFixtureBytes(report);
    const parsed = recordedCrashSchema.parse(report);
    expect(() =>
      validateRecordedCrashStructure(parsed, bytes, parsed.decoder_diagnostics),
    ).not.toThrow();
    report.notes[0]!.type = typeId === 3 ? "NT_PRPSINFO" : "NT_FILE";
    expect(recordedCrashSchema.safeParse(report).success).toBe(false);
  },
);

it("keeps snapshot rebinding independent of unused ELF section and header-size admission", () => {
  const report = recordedCrashSchema.parse(recordedCrashFixture());
  const bytes = recordedCrashFixtureBytes(report);
  bytes.writeUInt16LE(0, 52);
  bytes.writeBigUInt64LE(0xffffffffffffffffn, 40);
  bytes.writeUInt16LE(0xffff, 60);
  expect(() =>
    validateRecordedCrashStructure(report, bytes, report.decoder_diagnostics),
  ).not.toThrow();
});

it("binds PN_XNUM through raw section-zero info without full ELF numbering admission", () => {
  const report = recordedCrashSchema.parse(recordedCrashFixture());
  const original = recordedCrashFixtureBytes(report);
  const bytes = Buffer.concat([original, Buffer.alloc(64)]);
  bytes.writeUInt16LE(0xffff, 56);
  bytes.writeBigUInt64LE(BigInt(original.length), 40);
  bytes.writeUInt16LE(64, 58);
  // Rebinding only needs the reported count; full ELF admission separately requires SHT_NULL and reserved thresholds.
  bytes.writeUInt32LE(1, original.length + 4);
  bytes.writeUInt32LE(report.segments.length, original.length + 44);
  expect(() =>
    validateRecordedCrashStructure(report, bytes, report.decoder_diagnostics),
  ).not.toThrow();
  bytes.writeUInt32LE(report.segments.length + 1, original.length + 44);
  expect(() =>
    validateRecordedCrashStructure(report, bytes, report.decoder_diagnostics),
  ).toThrow(/original ELF\/note headers/);
});

it.each([
  ["magic", 0, 0],
  ["class", 4, 1],
  ["byte order", 5, 2],
  ["identification version", 6, 0],
  ["OS ABI", 7, 0xff],
  ["ABI version", 8, 1],
  ["object type", 16, 2],
  ["machine", 18, 0],
  ["header version", 20, 0],
] as const)(
  "rejects mismatched core %s while retaining decoder diagnostics",
  (_name, offset, value) => {
    const report = recordedCrashSchema.parse(recordedCrashFixture());
    const bytes = recordedCrashFixtureBytes(report);
    bytes[offset] = value;
    let failure: unknown;
    try {
      validateRecordedCrashStructure(report, bytes, report.decoder_diagnostics);
    } catch (cause: unknown) {
      failure = cause;
    }
    expect(failure).toMatchObject({
      _tag: "AnalysisOutputError",
      operation: "inspect_recorded_crash",
      capturedOutput: report.decoder_diagnostics,
    });
  },
);

it.each([0, 3])(
  "retains supported core OS ABI %i independently of declared header size",
  (osAbi) => {
    const report = recordedCrashSchema.parse(recordedCrashFixture());
    const bytes = recordedCrashFixtureBytes(report);
    bytes[7] = osAbi;
    bytes.writeUInt16LE(0xffff, 52);
    expect(() =>
      validateRecordedCrashStructure(report, bytes, report.decoder_diagnostics),
    ).not.toThrow();
  },
);
