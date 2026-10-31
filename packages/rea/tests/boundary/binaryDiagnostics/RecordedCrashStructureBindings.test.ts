import { expect, it } from "vitest";
import {
  recordedCrashFixture,
  recordedCrashFixtureBytes,
  recordedCrashFileMappingFixture,
} from "../../fixtures/binaryDiagnostics/recordedCrash.js";
import { validateRecordedCrashStructure } from "../../../src/native/pwntools/RecordedCrashStructureBindings.js";
import { validateCoreFileMappingAuthority } from "../../../src/native/pwndbg/CoreFileMappingAuthority.js";
import { validateRecordedCrashSources } from "../../../src/native/pwntools/RecordedCrashSourceBindings.js";
import {
  recordedCrashSchema,
  RECORDED_LINUX_CORE_PROFILES,
  type RecordedCrashArchitecture,
} from "../../../src/domain/native/recordedCrash.js";

/** Header-only metadata carrier; no thread, unwind, or MTE payload is decoded. */
const auxiliaryHeader = (
  architecture: RecordedCrashArchitecture,
  rawType: number,
  reportedType: string | number,
) => {
  const report = recordedCrashFixture(undefined, architecture);
  report.segments = report.segments.map((segment) => ({
    ...segment,
    type: reportedType,
    type_id: rawType,
    file_size: "0x4",
    memory_size: "0x4",
  }));
  report.notes = [];
  report.threads = [];
  const snapshot = recordedCrashFixtureBytes(report);
  snapshot.writeUInt32LE(rawType, 64);
  return { report: recordedCrashSchema.parse(report), snapshot };
};

it.each([
  ["aarch64-little-endian", 0x70000000, "PT_AARCH64_ARCHEXT"],
  ["aarch64-little-endian", 0x70000001, "PT_AARCH64_UNWIND"],
  // The ABI names MTE, but pinned pyelftools still reports its numeric type.
  ["aarch64-little-endian", 0x70000002, 0x70000002],
  ["aarch64-little-endian", 0x70000003, 0x70000003],
  ["x86_64-little-endian", 0x70000000, 0x70000000],
  ["x86_64-little-endian", 0x70000001, 0x70000001],
  ["aarch64-little-endian", 0x6474e551, "PT_GNU_STACK"],
  ["x86_64-little-endian", 0x6474e551, "PT_GNU_STACK"],
] as const)(
  "binds %s program type %s to its exact parser projection %s",
  (architecture, rawType, reportedType) => {
    const { report, snapshot } = auxiliaryHeader(
      architecture,
      rawType,
      reportedType,
    );
    const original = Buffer.from(snapshot);
    expect(() =>
      validateRecordedCrashStructure(
        report,
        snapshot,
        report.decoder_diagnostics,
      ),
    ).not.toThrow();
    expect(Buffer.compare(snapshot, original)).toBe(0);
    expect(report.note_interpretation_completeness).toBe("unknown");
    expect(report.live_process_identity).toBe("unknown");
  },
);

it.each([
  ["aarch64-little-endian", 0x70000000, "PT_AARCH64_UNWIND"],
  ["aarch64-little-endian", 0x70000001, "PT_AARCH64_ARCHEXT"],
  ["x86_64-little-endian", 0x70000000, "PT_AARCH64_ARCHEXT"],
  ["x86_64-little-endian", 0x70000001, "PT_AARCH64_UNWIND"],
  ["aarch64-little-endian", 0x70000001, 0x70000001],
  ["aarch64-little-endian", 0x70000002, "PT_AARCH64_MEMTAG_MTE"],
] as const)(
  "rejects %s program type %s reported as %s outside its pinned projection",
  (architecture, rawType, reportedType) => {
    const { report, snapshot } = auxiliaryHeader(
      architecture,
      rawType,
      reportedType,
    );
    expect(() =>
      validateRecordedCrashStructure(
        report,
        snapshot,
        report.decoder_diagnostics,
      ),
    ).toThrow(/Reported core structure differs/);
  },
);

it("still binds the remaining AArch64 auxiliary header fields to their source", () => {
  const { report, snapshot } = auxiliaryHeader(
    "aarch64-little-endian",
    0x70000001,
    "PT_AARCH64_UNWIND",
  );
  snapshot.writeUInt32LE(4, 64 + 4);
  expect(() =>
    validateRecordedCrashStructure(
      report,
      snapshot,
      report.decoder_diagnostics,
    ),
  ).toThrow(/Reported core structure differs/);
});

it.each(["x86_64-little-endian", "aarch64-little-endian"] as const)(
  "admits a %s core whose header carries that profile's e_machine",
  (architecture) => {
    const report = recordedCrashFixture(undefined, architecture);
    expect(() =>
      validateRecordedCrashStructure(
        report,
        recordedCrashFixtureBytes(report),
        report.decoder_diagnostics,
      ),
    ).not.toThrow();
  },
);

it.each([
  ["x86_64-little-endian", "aarch64-little-endian"],
  ["aarch64-little-endian", "x86_64-little-endian"],
] as const)(
  "rejects a %s report whose header carries the other profile's e_machine",
  (reported, embedded) => {
    const report = recordedCrashFixture(undefined, reported);
    const snapshot = recordedCrashFixtureBytes(report);
    snapshot.writeUInt16LE(RECORDED_LINUX_CORE_PROFILES[embedded].machine, 18);
    expect(() =>
      validateRecordedCrashStructure(
        report,
        snapshot,
        report.decoder_diagnostics,
      ),
    ).toThrow(/Reported core structure differs/);
  },
);

it.each([
  [6, 0],
  [6, 2],
  [20, 0],
  [20, 2],
] as const)(
  "rejects non-current ELF version at byte %i: %i",
  (offset, version) => {
    const report = recordedCrashFixture();
    const snapshot = recordedCrashFixtureBytes(report);
    if (offset === 6) snapshot[offset] = version;
    else snapshot.writeUInt32LE(version, offset);
    expect(() =>
      validateRecordedCrashStructure(
        report,
        snapshot,
        report.decoder_diagnostics,
      ),
    ).toThrow(/Reported core structure differs/);
  },
);

it.each(["/usr/bin/fixture", "../../fixture", "/a/../fixture"])(
  "separates valid source evidence from debugger mapping authority: %s",
  (path) => {
    const report = recordedCrashFileMappingFixture([Buffer.from(path)]);
    const snapshot = recordedCrashFixtureBytes(report);
    expect(() => recordedCrashSchema.parse(report)).not.toThrow();
    validateRecordedCrashStructure(
      report,
      snapshot,
      report.decoder_diagnostics,
    );
    validateRecordedCrashSources(report, snapshot, report.decoder_diagnostics);
    const original = Buffer.from(snapshot);
    expect(validateCoreFileMappingAuthority(report, snapshot).ok).toBe(
      path === "/usr/bin/fixture",
    );
    expect(Buffer.compare(snapshot, original)).toBe(0);
  },
);
