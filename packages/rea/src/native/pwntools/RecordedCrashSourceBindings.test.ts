import { describe, expect, it } from "vitest";

import {
  RECORDED_LINUX_CORE_ARCHITECTURES,
  RECORDED_LINUX_CORE_PROFILES,
} from "../../domain/native/recordedCrash.js";
import {
  recordedCrashFixture,
  recordedCrashFixtureBytes,
} from "../../../tests/fixtures/binaryDiagnostics/recordedCrash.js";
import { validateRecordedCrashSources } from "./RecordedCrashSourceBindings.js";

const diagnostics = { stdout: "", stderr: "", truncated: false } as const;

const bind = (
  architecture?: "x86_64-little-endian" | "aarch64-little-endian",
) => {
  const report = recordedCrashFixture("/selected.core", architecture);
  return { report, bytes: recordedCrashFixtureBytes(report) };
};

describe("recorded core source bindings", () => {
  it.each(RECORDED_LINUX_CORE_ARCHITECTURES)(
    "binds each %s register to its own source bytes",
    (architecture) => {
      const { report, bytes } = bind(architecture);
      expect(() =>
        validateRecordedCrashSources(report, bytes, diagnostics),
      ).not.toThrow();
    },
  );

  it("measures the AArch64 register window one slot wide per name", () => {
    const profile = RECORDED_LINUX_CORE_PROFILES["aarch64-little-endian"];
    expect(profile.registers.length).toBe(34);
    expect(profile.prstatusBytes).toBe(392);
    expect(profile.machine).toBe(183);
    // The fixtures and the bindings both read these numbers, so they are pinned
    // here against the ABI record rather than only used consistently.
    expect(profile.registerOffset).toBe(112);
    expect(profile.registerBytes).toBe(8);
    const amd64 = RECORDED_LINUX_CORE_PROFILES["x86_64-little-endian"];
    expect(amd64.registers.length).toBe(27);
    expect(amd64.prstatusBytes).toBe(336);
    expect(amd64.machine).toBe(62);
    expect(amd64.registerOffset).toBe(112);
    expect(amd64.registerBytes).toBe(8);
  });

  it("stamps each crafted core with the machine its profile declares", () => {
    for (const architecture of RECORDED_LINUX_CORE_ARCHITECTURES) {
      const bytes = bind(architecture).bytes;
      expect(bytes.readUInt16LE(18)).toBe(
        RECORDED_LINUX_CORE_PROFILES[architecture].machine,
      );
    }
  });

  it("rejects an AArch64 register bound to another slot", () => {
    const { report, bytes } = bind("aarch64-little-endian");
    const shifted = {
      ...report,
      threads: report.threads.map((thread) => ({
        ...thread,
        registers: thread.registers.map((register, index) =>
          index === 3
            ? {
                ...register,
                location: {
                  ...register.location,
                  offset: `0x${(BigInt(register.location.offset) + 8n).toString(
                    16,
                  )}`,
                },
              }
            : register,
        ),
      })),
    };
    expect(() =>
      validateRecordedCrashSources(shifted, bytes, diagnostics),
    ).toThrow(/aarch64-little-endian register identity/);
  });

  it("rejects an AArch64 note shorter than the profile descriptor", () => {
    const { report, bytes } = bind("aarch64-little-endian");
    const shortened = {
      ...report,
      notes: report.notes.map((note, index) =>
        index === 0
          ? {
              ...note,
              descriptor_location: {
                ...note.descriptor_location,
                bytes: "0x150",
              },
            }
          : note,
      ),
    };
    expect(() =>
      validateRecordedCrashSources(shortened, bytes, diagnostics),
    ).toThrow(/aarch64-little-endian source bytes/);
  });

  it("rejects an amd64 register name reported for AArch64", () => {
    const { report, bytes } = bind("aarch64-little-endian");
    const renamed = {
      ...report,
      threads: report.threads.map((thread) => ({
        ...thread,
        registers: thread.registers.map((register, index) =>
          index === 0 ? { ...register, name: "rax" } : register,
        ),
      })),
    };
    expect(() =>
      validateRecordedCrashSources(renamed, bytes, diagnostics),
    ).toThrow(/aarch64-little-endian register identity/);
  });

  it("rejects a reported PID that differs from the recorded source bytes", () => {
    const { report, bytes } = bind("aarch64-little-endian");
    const wrongPid = {
      ...report,
      threads: report.threads.map((thread) => ({
        ...thread,
        historical_pid: thread.historical_pid + 1,
      })),
    };
    expect(() =>
      validateRecordedCrashSources(wrongPid, bytes, diagnostics),
    ).toThrow(/aarch64-little-endian source bytes/);
  });
});
