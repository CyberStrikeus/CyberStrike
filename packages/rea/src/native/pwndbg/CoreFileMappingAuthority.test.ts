import { describe, expect, it } from "vitest";
import { validateCoreFileMappingAuthority } from "./CoreFileMappingAuthority.js";
import {
  recordedCrashFixture,
  recordedCrashFileMappingFixture,
} from "../../../tests/fixtures/binaryDiagnostics/recordedCrash.js";

function mapping(paths: readonly Buffer[]) {
  const report = recordedCrashFileMappingFixture(paths);
  const note = report.notes[0];
  if (note === undefined) throw new Error("Expected a mapping note");
  const bytes = Buffer.from(note.descriptor_bytes_base64, "base64");
  note.descriptor_location.offset = "0x0";
  return { report, bytes };
}

describe("core-only NT_FILE authority", () => {
  it("keeps GNU-owned colliding note numbers outside CORE mapping authority", () => {
    const { report, bytes } = mapping([Buffer.from("../unsafe")]);
    expect(validateCoreFileMappingAuthority(report, bytes).ok).toBe(false);
    report.notes[0]!.owner_bytes_base64 =
      Buffer.from("GNU\0\0").toString("base64");
    report.notes[0]!.owner_display = "GNU";
    report.notes[0]!.type = 0x46494c45;
    expect(validateCoreFileMappingAuthority(report, bytes).ok).toBe(true);
  });
  it.each([
    "/usr/bin/app",
    "//usr/lib/libc.so",
    "/a/.../b",
    "/a/../b",
    "../../app",
    "relative/app",
    "/a/./b",
    "",
    "target:/app",
  ])(
    "retains original pathname bytes and admits only confined Unix paths: %s",
    (path) => {
      const { report, bytes } = mapping([Buffer.from(path)]);
      const original = Buffer.from(bytes);
      const result = validateCoreFileMappingAuthority(report, bytes);
      expect(result.ok).toBe(
        ["/usr/bin/app", "//usr/lib/libc.so", "/a/.../b"].includes(path),
      );
      expect(Buffer.compare(bytes, original)).toBe(0);
      if (!result.ok)
        expect(result.error).toMatchObject({
          _tag: "AnalysisCapabilityUnavailableError",
          capturedOutput: report.decoder_diagnostics,
        });
    },
  );

  it("does not decode invalid UTF-8 to decide pathname authority", () => {
    const { report, bytes } = mapping([Buffer.from([47, 255, 47, 46, 46, 46])]);
    expect(validateCoreFileMappingAuthority(report, bytes).ok).toBe(true);
  });

  it.each([
    "short-header",
    "huge-count",
    "unterminated",
    "extra-path",
    "unsafe-second",
  ])("refuses unresolved or unsafe mapping coverage: %s", (scenario) => {
    const { report, bytes } = mapping([
      Buffer.from("/safe"),
      Buffer.from(scenario === "unsafe-second" ? "../unsafe" : "/also-safe"),
    ]);
    let snapshot = bytes;
    if (scenario === "short-header") snapshot = bytes.subarray(0, 8);
    if (scenario === "huge-count") bytes.writeBigUInt64LE(0xffffffffffffffffn);
    if (scenario === "unterminated")
      snapshot = bytes.subarray(0, bytes.length - 1);
    if (scenario === "extra-path")
      snapshot = Buffer.concat([bytes, Buffer.from("extra\0")]);
    const note = report.notes[0];
    if (note === undefined) throw new Error("Expected a mapping note");
    note.descriptor_location.bytes = `0x${snapshot.length.toString(16)}`;
    expect(validateCoreFileMappingAuthority(report, snapshot).ok).toBe(false);
  });

  it("permits cores without file mappings and empty mapping tables", () => {
    const report = recordedCrashFixture();
    expect(validateCoreFileMappingAuthority(report, Buffer.alloc(0)).ok).toBe(
      true,
    );
    const empty = mapping([]);
    expect(validateCoreFileMappingAuthority(empty.report, empty.bytes).ok).toBe(
      true,
    );
  });
});
