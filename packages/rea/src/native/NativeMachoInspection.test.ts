import { describe, expect, it } from "vitest";

import {
  CPU,
  LC,
  dylibCommand,
  fatImage,
  machoImage,
  lazyLoadDylibInfoCommand,
  readerOf,
} from "../artifacts/apple/MachoImage.fixture.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import { err, ok } from "../domain/result.js";
import { parseMachoLayout, selectMachoSlice } from "./AppleMachoSelection.js";
import type { NativeCommandCapture } from "./CommandRunner.js";
import type { MachoSliceEncryption } from "../domain/apple/machoEncryption.js";
import { inspectMachoSchema } from "../domain/native/nativeInspection.js";
import {
  inspectNativeMacho,
  type MachoEncryptionRead,
} from "./NativeMachoInspection.js";
import { readMachoCommandNames } from "./MachoCommandNames.js";
import {
  inspectionImage,
  inspectionReader,
  unreadEncryption,
} from "./NativeMachoInspection.fixture.js";
import {
  NativeFixtureRunner,
  nativeMachoTarget,
} from "../../tests/fixtures/nativeCommands.js";

const capture = (tool: string, stdout: string): NativeCommandCapture => ({
  tool,
  executable: tool,
  executableSha256: "a".repeat(64),
  toolVersion: null,
  versionReason: null,
  arguments: [],
  stdout,
  stderr: "",
  stdoutBytes: stdout.length,
  stderrBytes: 0,
  exitCode: 0,
  signal: null,
});

const inspect = async (lipo: string, architecture: "x86" | "arm64") => {
  const commands: {
    readonly tool: string;
    readonly args: readonly string[];
  }[] = [];
  const result = await inspectNativeMacho({
    readCommandNames: inspectionReader(),
    target: {
      kind: "executable",
      format: "mach-o",
      path: "/fixture/app",
      sha256: "b".repeat(64),
      architecture,
      availableArchitectures: ["x86", "arm64"],
    },
    run: (tool, args) => {
      commands.push({ tool, args });
      if (tool === "lipo") return Promise.resolve(ok(capture(tool, lipo)));
      return Promise.resolve(err(new AnalysisCancelledError("inspect_native")));
    },
    invocation: () => {
      throw new Error("invocation is not reached");
    },
    readEncryption: unreadEncryption,
  });
  return { result, commands };
};

describe("Mach-O tool architecture selection", () => {
  it("rejects a CPU lipo did not list instead of reading another slice", async () => {
    const { result, commands } = await inspect("architecture arm64\n", "x86");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      _tag: "AnalysisOutputError",
      reason: "lipo did not list i386; refusing to read another slice",
    });
    expect(commands.map(({ tool }) => tool)).toEqual(["lipo"]);
  });

  it("passes the arm64e slice lipo listed for an arm64 target", async () => {
    const { commands } = await inspect("architecture arm64e\n", "arm64");
    expect(commands.find(({ tool }) => tool === "dyld_info")?.args).toContain(
      "arm64e",
    );
  });

  it("uses the subtype-specific tool name when lipo calls ARM64 V8 arm64", async () => {
    const lipo =
      "architecture x86_64\n cputype CPU_TYPE_X86_64\n cpusubtype CPU_SUBTYPE_X86_64_ALL\n offset 4096\n size 4096\n align 2^12\n" +
      "architecture arm64\n cputype CPU_TYPE_ARM64\n cpusubtype CPU_SUBTYPE_ARM64_V8\n offset 8192\n size 4096\n align 2^12\n";
    const { commands } = await inspect(lipo, "arm64");
    expect(commands.find(({ tool }) => tool === "dyld_info")?.args).toContain(
      "arm64v8",
    );
  });

  it("reads the selected FAT slice's command bytes", async () => {
    const slices = [CPU.x86_64, CPU.arm64].map((cpu) => ({
      cpu,
      bytes: machoImage({
        cpu,
        commands: [
          dylibCommand(
            LC.LOAD_DYLIB,
            cpu === CPU.arm64 ? "/selected.dylib" : "/other.dylib",
          ),
        ],
      }),
    }));
    const fat = fatImage(slices);
    const lipo = slices
      .map(
        (slice, index) =>
          `architecture ${index === 0 ? "x86_64" : "arm64"}\n cputype ${slice.cpu.type}\n cpusubtype ${slice.cpu.subtype}\n offset ${(index + 1) * 4096}\n size ${slice.bytes.length}\n align 2^12\n`,
      )
      .join("");
    const runner = new NativeFixtureRunner({ lipo });
    const readOffsets: number[] = [];
    const result = await inspectNativeMacho({
      target: nativeMachoTarget("/fixture/app"),
      run: (tool, args) => runner.run(tool, args),
      readEncryption: unreadEncryption,
      readCommandNames: (offset, size) => {
        readOffsets.push(offset);
        const image = fat.subarray(
          offset,
          offset + (size ?? fat.length - offset),
        );
        return readMachoCommandNames(readerOf(image), image.length, 1024, 100);
      },
      invocation: (capture) => ({
        tool: capture.tool,
        command: [capture.executable, ...capture.arguments],
        tool_version: capture.toolVersion,
        version_reason: capture.versionReason,
        executable_sha256: capture.executableSha256,
        exit: { code: capture.exitCode, signal: capture.signal },
        stdout_bytes: capture.stdoutBytes,
        stderr_bytes: capture.stderrBytes,
      }),
    });
    if (!result.ok) throw result.error;
    expect(readOffsets).toEqual([8192]);
    expect(result.value.result).toMatchObject({
      dependencies: { items: [{ path: "/selected.dylib" }] },
    });
  });

  it("refuses an ambiguous selector instead of assigning another row's offset", async () => {
    const row =
      "architecture arm64\n cputype CPU_TYPE_ARM64\n cpusubtype CPU_SUBTYPE_ARM64_ALL\n offset 4096\n size 4096\n align 2^12\n";
    const { result, commands } = await inspect(row + row, "arm64");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      _tag: "AnalysisOutputError",
      reason: expect.stringContaining("multiple slices addressable as arm64"),
    });
    expect(commands.map(({ tool }) => tool)).toEqual(["lipo"]);
  });

  it.each([
    { names: ["arm64v8", "arm64e"], selected: "arm64e" },
    { names: ["arm64e", "arm64v8"], selected: "arm64e" },
    { names: ["arm64v8", "arm64e", "arm64"], selected: "arm64" },
    { names: ["arm64v8"], selected: "arm64v8" },
    { names: ["arm64v8", "arm64e.x1"], selected: "arm64v8" },
    { names: ["arm64e.x1", "arm64v8"], selected: "arm64v8" },
    { names: ["arm64v8", "arm64e.v1"], selected: "arm64e.v1" },
    { names: ["arm64e.v1", "arm64v8"], selected: "arm64e.v1" },
  ] as const)(
    "keeps inspection and dispatch on $selected for FAT order $names",
    async ({ names, selected }) => {
      const cpus = {
        arm64: CPU.arm64,
        arm64v8: { type: CPU.arm64.type, subtype: 1 },
        arm64e: CPU.arm64e,
        "arm64e.x1": { type: CPU.arm64.type, subtype: 0x8000000c },
        "arm64e.v1": { type: CPU.arm64.type, subtype: 0x81000002 },
      };
      const slices = names.map((name) => {
        const cpu = cpus[name];
        return {
          cpu,
          bytes: machoImage({
            cpu,
            commands: [dylibCommand(LC.LOAD_DYLIB, `/fixture/${name}.dylib`)],
          }),
        };
      });
      const fat = Buffer.from(fatImage(slices));
      const lipo = names
        .map(
          (name, index) =>
            `architecture ${name}\n cputype ${cpus[name].type}\n cpusubtype ${cpus[name].subtype}\n offset ${(index + 1) * 4096}\n size ${slices[index]?.bytes.length}\n align 2^12\n`,
        )
        .join("");
      const { commands } = await inspect(lipo, "arm64");
      expect(commands.find(({ tool }) => tool === "dyld_info")?.args).toContain(
        selected,
      );
      expect(selectMachoSlice(fat, "arm64").slice).toBe(
        (names.findIndex((name) => name === selected) + 1) * 4096,
      );
      expect(parseMachoLayout(fat, "arm64").fixups.dylibs).toEqual([
        `/fixture/${selected}.dylib`,
      ]);
    },
  );
});

describe("Mach-O inspection container format", () => {
  const runInspection = async (lipo: string) => {
    const runner = new NativeFixtureRunner({ lipo });
    return inspectNativeMacho({
      readCommandNames: inspectionReader(),
      target: nativeMachoTarget("/fixture/app"),
      run: (tool, args) => runner.run(tool, args),
      invocation: (capture) => ({
        tool: capture.tool,
        command: [capture.executable, ...capture.arguments],
        tool_version: capture.toolVersion,
        version_reason: capture.versionReason,
        executable_sha256: capture.executableSha256,
        exit: { code: capture.exitCode, signal: capture.signal },
        stdout_bytes: capture.stdoutBytes,
        stderr_bytes: capture.stderrBytes,
      }),
      readEncryption: unreadEncryption,
    });
  };

  it.each([false, true])(
    "keeps the selected subtype's offset when lipo repeats an architecture name (reversed=%s)",
    async (reversed) => {
      const v8 =
        "architecture arm64\n cputype CPU_TYPE_ARM64\n cpusubtype CPU_SUBTYPE_ARM64_V8\n offset 16384\n size 4096\n align 2^12\n";
      const all =
        "architecture arm64\n cputype CPU_TYPE_ARM64\n cpusubtype CPU_SUBTYPE_ARM64_ALL\n offset 32768\n size 4096\n align 2^12\n";
      const result = await runInspection(
        `Fat header in: /fixture/app\nfat_magic 0xcafebabe\nnfat_arch 2\n${reversed ? all + v8 : v8 + all}`,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.result).toMatchObject({
        selected_architecture: { name: "arm64", container_file_offset: 32768 },
      });
      expect(result.value.locations).toContainEqual({
        kind: "file-offset-range",
        start: 32768,
        end: 36864,
      });
    },
  );

  it.each([
    {
      framing: "one-slice FAT",
      lipo: `Fat header in: /fixture/app\nfat_magic 0xcafebabe\nnfat_arch 1\narchitecture arm64\n cputype CPU_TYPE_ARM64\n cpusubtype CPU_SUBTYPE_ARM64_ALL\n offset 4096\n size 128\n align 2^12\n`,
      expected: "mach-o-universal",
    },
    {
      framing: "thin",
      lipo: "Non-fat file: /fixture/app is architecture: arm64\n",
      expected: "mach-o",
    },
  ] as const)("reports parsed $framing framing", async ({ lipo, expected }) => {
    const result = await runInspection(lipo);
    if (!result.ok) throw result.error;
    expect(result.value.result).toMatchObject({ format: expected });
  });

  it("does not call a lazy-info payload dependency exhaustive", async () => {
    const runner = new NativeFixtureRunner({
      lipo: "Non-fat file: /fixture/app is architecture: arm64\n",
    });
    const result = await inspectNativeMacho({
      readCommandNames: inspectionReader(
        inspectionImage({
          commands: [
            dylibCommand(LC.LOAD_DYLIB, "/usr/lib/libSystem.B.dylib"),
            lazyLoadDylibInfoCommand(49304, 56),
          ],
        }),
      ),
      target: nativeMachoTarget("/fixture/app"),
      run: (tool, args) => runner.run(tool, args),
      readEncryption: unreadEncryption,
      invocation: (captured) => ({
        tool: captured.tool,
        command: [captured.executable, ...captured.arguments],
        tool_version: captured.toolVersion,
        version_reason: captured.versionReason,
        executable_sha256: captured.executableSha256,
        exit: { code: captured.exitCode, signal: captured.signal },
        stdout_bytes: captured.stdoutBytes,
        stderr_bytes: captured.stderrBytes,
      }),
    });
    if (!result.ok) throw result.error;
    expect(result.value.result).toMatchObject({
      load_commands: {
        items: [{ kind: "LC_LOAD_DYLIB" }, { kind: "LC_LAZY_LOAD_DYLIB_INFO" }],
      },
      dependencies: {
        exhaustive: false,
        total: null,
        items: [
          {
            path: "/usr/lib/libSystem.B.dylib",
            kind: "LC_LOAD_DYLIB",
          },
        ],
        limitations: [expect.stringContaining("linkedit dependency payload")],
      },
    });
  });
});

describe("Mach-O UUID reconciliation", () => {
  const validUuid = "01234567-89AB-CDEF-0123-456789ABCDEF";

  const runInspection = async (
    dwarfdump: string,
    binaryUuids: readonly string[] = [validUuid],
    targetPath = "/fixture/app",
  ) => {
    const runner = new NativeFixtureRunner({
      dwarfdump,
    });
    const result = await inspectNativeMacho({
      readCommandNames: inspectionReader(
        inspectionImage({ uuids: binaryUuids }),
      ),
      target: nativeMachoTarget(targetPath),
      run: (tool, args) => runner.run(tool, args),
      readEncryption: unreadEncryption,
      invocation: (capture) => ({
        tool: capture.tool,
        command: [capture.executable, ...capture.arguments],
        tool_version: capture.toolVersion,
        version_reason: capture.versionReason,
        executable_sha256: capture.executableSha256,
        exit: { code: capture.exitCode, signal: capture.signal },
        stdout_bytes: capture.stdoutBytes,
        stderr_bytes: capture.stderrBytes,
      }),
    });
    return result;
  };

  it("keeps a valid binary UUID when dwarfdump is malformed and reports the limitation", async () => {
    const result = await runInspection("UUID: A (arm64) /fixture/app\n");
    if (!result.ok) throw result.error;
    expect(result.value.result).toMatchObject({ uuid: validUuid });
    expect(result.value.limitations).toContain(
      'dwarfdump --uuid returned malformed UUID "A"; using the unambiguous binary load commands LC_UUID.',
    );
  });

  it("does not choose between conflicting valid UUIDs", async () => {
    const result = await runInspection(
      `UUID: FEDCBA98-7654-3210-FEDC-BA9876543210 (arm64) /fixture/app\n`,
    );
    if (!result.ok) throw result.error;
    expect(result.value.result).toMatchObject({ uuid: null });
    expect(result.value.limitations).toContain(
      `dwarfdump --uuid (FEDCBA98-7654-3210-FEDC-BA9876543210) conflicts with binary load commands LC_UUID (${validUuid}); the image UUID is unknown.`,
    );
  });

  it("accepts matching UUIDs with different case and preserves dwarfdump spelling", async () => {
    const lower = validUuid.toLowerCase();
    const result = await runInspection(`UUID: ${lower} (arm64) /fixture/app\n`);
    if (!result.ok) throw result.error;
    expect(result.value.result).toMatchObject({ uuid: lower });
  });

  it("uses a valid dwarfdump UUID when the binary has no UUID observation", async () => {
    const result = await runInspection(
      `UUID: ${validUuid} (arm64) /fixture/app\n`,
      [],
    );
    if (!result.ok) throw result.error;
    expect(result.value.result).toMatchObject({ uuid: validUuid });
  });

  it("frames a path containing a newline and UUID-like text as one dwarfdump row", async () => {
    const path =
      "/fixture/\nUUID: FEDCBA98-7654-3210-FEDC-BA9876543210 (arm64) fake";
    const result = await runInspection(
      `UUID: ${validUuid} (arm64) ${path}\n`,
      [validUuid],
      path,
    );
    if (!result.ok) throw result.error;
    expect(result.value.result).toMatchObject({ uuid: validUuid });
  });

  it("keeps a conflict between duplicate valid LC_UUID commands unknown despite dwarfdump", async () => {
    const result = await runInspection(
      `UUID: ${validUuid} (arm64) /fixture/app\n`,
      [validUuid, "FEDCBA98-7654-3210-FEDC-BA9876543210"],
      "/fixture/app",
    );
    if (!result.ok) throw result.error;
    expect(result.value.result).toMatchObject({ uuid: null });
    expect(result.value.limitations).toContain(
      `binary load commands returned conflicting LC_UUID values ${JSON.stringify(validUuid)} and ${JSON.stringify("FEDCBA98-7654-3210-FEDC-BA9876543210")}`,
    );
  });

  it("keeps conflicting duplicate dwarfdump rows unknown despite binary UUID", async () => {
    const conflictingUuid = "FEDCBA98-7654-3210-FEDC-BA9876543210";
    const result = await runInspection(
      `UUID: ${validUuid} (arm64) /fixture/app\nUUID: ${conflictingUuid} (arm64) /fixture/app\n`,
    );
    if (!result.ok) throw result.error;
    expect(result.value.result).toMatchObject({ uuid: null });
    expect(result.value.limitations).toContain(
      "dwarfdump --uuid returned conflicting UUIDs for selected architecture arm64",
    );
  });
});

describe("Mach-O slice command scheduling", () => {
  const SLICE_TOOLS = ["nm", "dyld_info", "dyld_info", "dwarfdump"];

  /** Finish later-launched slice commands first and record overlap. */
  const reorderingRunner = (failing: ReadonlySet<string> = new Set()) => {
    const fixtures = new NativeFixtureRunner();
    let inFlight = 0;
    let maxInFlight = 0;
    let launched = 0;
    const run = async (tool: string, args: readonly string[]) => {
      if (tool === "lipo") return fixtures.run(tool, args);
      const order = launched++;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      for (let turn = 0; turn < 12 - order * 2; turn += 1)
        await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
      if (failing.has(tool))
        return err(new AnalysisOutputError("inspect_macho", `${tool} failed`));
      return fixtures.run(tool, args);
    };
    return { run, maxInFlight: () => maxInFlight };
  };

  const inspectWith = (run: ReturnType<typeof reorderingRunner>["run"]) =>
    inspectNativeMacho({
      readCommandNames: inspectionReader(),
      target: nativeMachoTarget("/fixture/app"),
      run,
      readEncryption: unreadEncryption,
      invocation: (capture) => ({
        tool: capture.tool,
        command: [capture.executable, ...capture.arguments],
        tool_version: capture.toolVersion,
        version_reason: capture.versionReason,
        executable_sha256: capture.executableSha256,
        exit: { code: capture.exitCode, signal: capture.signal },
        stdout_bytes: capture.stdoutBytes,
        stderr_bytes: capture.stderrBytes,
      }),
    });

  it("runs independent slice commands together and keeps provenance in declared order", async () => {
    const runner = reorderingRunner();
    const result = await inspectWith(runner.run);
    if (!result.ok) throw result.error;
    expect(runner.maxInFlight()).toBe(SLICE_TOOLS.length + 1);
    expect(result.value.result).toMatchObject({
      provenance: ["lipo", ...SLICE_TOOLS, "vtool"].map((tool) => ({
        tool,
      })),
    });
  });

  it("reports the first failing slice command in declared order", async () => {
    const runner = reorderingRunner(new Set(["nm", "dwarfdump"]));
    const result = await inspectWith(runner.run);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ reason: "nm failed" });
  });
});

describe("Mach-O encryption reporting", () => {
  const slice = (
    overrides: Partial<MachoSliceEncryption> = {},
  ): MachoSliceEncryption => ({
    architecture: null,
    cpu_type: 16777228,
    cpu_subtype: 0,
    container_file_offset: 32768,
    size: 8192,
    status: "absent",
    reason: null,
    commands: [],
    range: null,
    ...overrides,
  });
  const encrypted = (start: number, end: number) =>
    slice({
      status: "encrypted",
      commands: [
        {
          kind: "LC_ENCRYPTION_INFO_64",
          index: 1,
          cmdsize: 24,
          cryptoff: start,
          cryptsize: end - start,
          cryptid: 1,
          pad: 0,
        },
      ],
      range: {
        content: "ciphertext",
        slice_start: start,
        slice_end: end,
        container_start: 32768 + start,
        container_end: 32768 + end,
        mapping: { status: "mapped", fragments: [], sections: [] },
      },
    });
  const inspectEncryption = async (encryption: MachoEncryptionRead) => {
    const runner = new NativeFixtureRunner();
    const result = await inspectNativeMacho({
      readCommandNames: inspectionReader(),
      target: nativeMachoTarget("/fixture/app"),
      run: (tool, args) => runner.run(tool, args),
      readEncryption: () => Promise.resolve(encryption),
      invocation: (capture) => ({
        tool: capture.tool,
        command: [capture.executable, ...capture.arguments],
        tool_version: capture.toolVersion,
        version_reason: capture.versionReason,
        executable_sha256: capture.executableSha256,
        exit: { code: capture.exitCode, signal: capture.signal },
        stdout_bytes: capture.stdoutBytes,
        stderr_bytes: capture.stderrBytes,
      }),
    });
    if (!result.ok) throw result.error;
    return {
      encryption: inspectMachoSchema.parse(result.value.result).encryption,
      limitations: result.value.limitations,
    };
  };

  it("labels every slice with the lipo record at its offset and names ciphertext bytes", async () => {
    const x86 = slice({
      cpu_type: 16777223,
      cpu_subtype: 3,
      container_file_offset: 16384,
      size: 4096,
    });
    const { encryption, limitations } = await inspectEncryption({
      status: "parsed",
      slices: [x86, encrypted(4096, 6144)],
    });
    expect(encryption).toMatchObject({ total: 2, exhaustive: true });
    expect(encryption.items.map(({ architecture }) => architecture)).toEqual([
      "x86_64",
      "arm64",
    ]);
    expect(limitations).toContain(
      "Bytes 36864-38912 (input file offsets, end exclusive) of the arm64 slice are ciphertext (cryptid 1); disassembly, decompilation, strings and references derived from them do not describe program code.",
    );
  });

  it("leaves a slice lipo did not describe unlabeled", async () => {
    const { encryption, limitations } = await inspectEncryption({
      status: "parsed",
      slices: [
        slice({
          container_file_offset: 49152,
          status: "malformed",
          reason: "load commands is truncated",
        }),
      ],
    });
    expect(encryption.items[0]?.architecture).toBeNull();
    expect(limitations).toContain(
      "Encryption status of the slice at offset 49152 is malformed: load commands is truncated.",
    );
  });

  it("does not mark bytes as ciphertext for an empty encrypted range", async () => {
    const { limitations } = await inspectEncryption({
      status: "parsed",
      slices: [encrypted(4096, 4096)],
    });
    expect(limitations).toContain(
      "The arm64 slice declares encryption (cryptid 1) over an empty range; no bytes are marked as ciphertext.",
    );
    expect(limitations.some((line) => line.includes("are ciphertext"))).toBe(
      false,
    );
  });

  it("keeps encryption unknown when the bytes were not read", async () => {
    const { encryption, limitations } = await inspectEncryption({
      status: "unread",
      reason: "the target could not be opened for reading (ENOENT)",
    });
    expect(encryption).toEqual({
      items: [],
      total: null,
      exhaustive: false,
      limitations: [
        "Encryption load commands were not read: the target could not be opened for reading (ENOENT)",
      ],
    });
    expect(limitations).toContain(
      "Encryption load commands were not read: the target could not be opened for reading (ENOENT)",
    );
  });
});

it.each(["10", "DSYM", "2"])(
  "classifies the unbacked-text dyld refusal using observed file type %s",
  async (fileType) => {
    const diagnostic =
      "section '__TEXT/__text' has offset=0 but is not a zero-fill section type\n";
    const runner = new NativeFixtureRunner();
    const result = await inspectNativeMacho({
      readCommandNames: inspectionReader(
        inspectionImage({ fileType: fileType === "2" ? 2 : 10 }),
      ),
      target: nativeMachoTarget("/fixture/debug-companion"),
      run: async (tool, args, _signal, acceptNonZeroIf) => {
        const captured = await runner.run(tool, args);
        if (!captured.ok || tool !== "dyld_info") return captured;
        const refused = {
          ...captured.value,
          stdout: diagnostic,
          stdoutBytes: Buffer.byteLength(diagnostic),
          exitCode: 1,
        };
        if (acceptNonZeroIf?.(refused)) return ok(refused);
        return err(
          new AnalysisOutputError("inspect_macho", "unaccepted native failure"),
        );
      },
      readEncryption: unreadEncryption,
      invocation: () => {
        throw new Error(
          "Refused target does not produce inspection provenance",
        );
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error._tag).toBe(
      fileType === "2"
        ? "AnalysisOutputError"
        : "AnalysisUnsupportedTargetError",
    );
    expect(result.error.capturedOutput).toMatchObject({
      stdout: diagnostic,
      exit_code: 1,
    });
  },
);

describe("dSYM diagnostic admission", () => {
  const diagnostic =
    "section '__TEXT/__text' has offset=0 but is not a zero-fill section type";

  it.each([
    { name: "stdout refusal", stdout: diagnostic, stderr: "", accepted: true },
    { name: "stderr refusal", stdout: "", stderr: diagnostic, accepted: true },
    {
      name: "echoed path and prefixed refusal",
      stdout: `/fixture/debug-companion:\n\ndyld_info: ${diagnostic}\n`,
      stderr: "",
      accepted: true,
    },
    {
      name: "unrelated stdout after refusal",
      stdout: `${diagnostic}\nmalformed load command`,
      stderr: "",
      accepted: false,
    },
    {
      name: "unrelated stdout before refusal",
      stdout: `malformed load command\n${diagnostic}`,
      stderr: "",
      accepted: false,
    },
    {
      name: "unrelated stderr beside stdout refusal",
      stdout: diagnostic,
      stderr: "malformed load command",
      accepted: false,
    },
    {
      name: "unrelated stdout beside stderr refusal",
      stdout: "malformed load command",
      stderr: diagnostic,
      accepted: false,
    },
    {
      name: "unrelated stderr after refusal",
      stdout: "",
      stderr: `${diagnostic}\nmalformed load command`,
      accepted: false,
    },
    {
      name: "missing UUID before dSYM refusal",
      stdout: `missing LC_UUID load command\n${diagnostic}`,
      stderr: "",
      accepted: false,
    },
    {
      name: "missing UUID beside stderr dSYM refusal",
      stdout: "missing LC_UUID load command",
      stderr: diagnostic,
      accepted: false,
    },
    {
      name: "duplicate refusal across streams",
      stdout: diagnostic,
      stderr: diagnostic,
      accepted: false,
    },
  ])("preserves $name", async ({ stdout, stderr, accepted }) => {
    const runner = new NativeFixtureRunner();
    const result = await inspectNativeMacho({
      readCommandNames: inspectionReader(inspectionImage({ fileType: 10 })),
      target: nativeMachoTarget("/fixture/debug-companion"),
      readEncryption: unreadEncryption,
      run: async (tool, args, _signal, acceptNonZeroIf) => {
        const captured = await runner.run(tool, args);
        if (!captured.ok || tool !== "dyld_info") return captured;
        const refused = {
          ...captured.value,
          stdout,
          stderr,
          stdoutBytes: Buffer.byteLength(stdout),
          stderrBytes: Buffer.byteLength(stderr),
          exitCode: 1,
        };
        return acceptNonZeroIf?.(refused)
          ? ok(refused)
          : err(
              new AnalysisOutputError("inspect_macho", "native refusal", {
                capturedOutput: {
                  stdout,
                  stderr,
                  truncated: false,
                  stdout_bytes: refused.stdoutBytes,
                  stderr_bytes: refused.stderrBytes,
                  exit_code: 1,
                  signal: null,
                },
              }),
            );
      },
      invocation: () => {
        throw new Error("Refused target does not produce provenance");
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error._tag).toBe(
      accepted ? "AnalysisUnsupportedTargetError" : "AnalysisOutputError",
    );
    expect(result.error.capturedOutput).toMatchObject({
      stdout,
      stderr,
      exit_code: 1,
    });
  });
});
