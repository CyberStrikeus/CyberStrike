import { inspectSignatureSchema } from "../../../../src/domain/native/nativeInspection.js";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  CPU,
  fatImage,
  machoImage,
} from "../../../../src/artifacts/apple/MachoImage.fixture.js";
import { err, ok } from "../../../../src/domain/result.js";
import { parseExecutableHeader } from "../../../../src/domain/binaryTarget.js";
import {
  NativeCommandFailure,
  type NativeCommandCapture,
  type NativeCommandOptions,
  type NativeCommandRunner,
} from "../../../../src/native/CommandRunner.js";
import { NativeMacOSProvider } from "../../../../src/native/NativeMacOSProvider.js";
import {
  parseDyldExports,
  parseDyldImports,
} from "../../../../src/native/parsers/dyldInfo.js";
import {
  NativeFixtureRunner as FixtureRunner,
  nativeFixture as fixture,
  nativeMachoTargetForFile,
} from "../../../fixtures/nativeCommands.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

const inventoryTarget = async (chained = false) => {
  const path = join(
    await createTestTempDirectory("rea-native-inventory-"),
    "fixture",
  );
  const segment = Buffer.alloc(72);
  segment.writeUInt32LE(0x19, 0);
  segment.writeUInt32LE(segment.length, 4);
  segment.write("__TEXT", 8);
  segment.writeBigUInt64LE(0x100000000n, 24);
  segment.writeBigUInt64LE(0x4000n, 32);
  segment.writeBigUInt64LE(0x4000n, 48);
  segment.writeUInt32LE(7, 56);
  segment.writeUInt32LE(5, 60);
  const fixups = Buffer.alloc(16);
  fixups.writeUInt32LE(0x80000034, 0);
  fixups.writeUInt32LE(16, 4);
  const image = machoImage({
    cpu: CPU.arm64,
    commands: chained ? [segment, fixups] : [segment],
  });
  await writeFile(
    path,
    Buffer.concat([image, Buffer.alloc(0x4000 - image.byteLength)]),
  );
  return nativeMachoTargetForFile(path);
};

const thinLipo =
  "input file fixture is not a fat file\nNon-fat file: fixture is architecture: arm64\n";
const inventoryRunner = (outputs: Readonly<Record<string, string>> = {}) =>
  new FixtureRunner({ lipo: thinLipo, ...outputs });

const signatureTarget = async (
  signedArchitecture: "arm64" | "arm64e" = "arm64",
) => {
  const path = join(
    await createTestTempDirectory("rea-native-inventory-"),
    "fixture",
  );
  await writeFile(
    path,
    fatImage(
      [CPU.x86_64, CPU[signedArchitecture]].map((cpu) => ({
        cpu,
        bytes: machoImage({ cpu }),
      })),
    ),
  );
  const target = await nativeMachoTargetForFile(path);
  const header = parseExecutableHeader(await readFile(path), "arm64");
  if (!header.ok || header.value.format !== "mach-o-universal")
    throw new Error("expected a universal Mach-O fixture");
  return { ...target, ...header.value };
};

it("distinguishes a codesign execution failure from an observed unsigned artifact", async () => {
  for (const kind of ["missing", "unsigned"] as const) {
    const fixtureOutput = await fixture(`dyld-inventory/codesign-${kind}.txt`);
    const client = new NativeMacOSProvider(
      {},
      {
        async run(tool, arguments_) {
          const output =
            kind === "unsigned"
              ? `${arguments_.at(-1)}: code object is not signed at all\n`
              : fixtureOutput;
          const capture = await new FixtureRunner({ codesign: output }, 1).run(
            tool,
            arguments_,
          );
          if (!capture.ok || kind !== "unsigned") return capture;
          return ok({
            ...capture.value,
            stdout: "",
            stderr: output,
            stdoutBytes: 0,
            stderrBytes: Buffer.byteLength(output),
          });
        },
      },
      "darwin",
    ).createClient(await signatureTarget());
    const execution = await client.execute("inspect_signature", {});
    if (kind === "missing")
      expect(execution).toMatchObject({
        ok: false,
        error: { _tag: "ProviderAdapterError" },
      });
    else {
      expect(execution.ok).toBe(true);
      if (execution.ok)
        expect(execution.value.result).toMatchObject({ signed: false });
    }
  }
});

it("reports unsigned slices when a universal Mach-O has mixed signatures", async () => {
  const signedFixture = await fixture("codesign.txt");
  const unsigned = await fixture("dyld-inventory/codesign-unsigned.txt");
  const entitlements = await fixture("entitlements.xml");
  for (const signedArchitecture of ["arm64", "arm64e"] as const) {
    const signed = signedFixture.replace(
      /^Format=.*$/mu,
      `Format=Mach-O universal (x86_64 ${signedArchitecture})`,
    );
    const client = new NativeMacOSProvider(
      {},
      signatureRunner({ signed, unsigned, entitlements, unsignedHeader: true }),
      "darwin",
    ).createClient(await signatureTarget(signedArchitecture));

    const execution = await client.execute("inspect_signature", {});

    expect(execution.ok).toBe(true);
    if (!execution.ok) continue;
    expect(execution.value.result).toMatchObject({
      signed: true,
      identifier: "com.example.fixture",
      designated_requirement: null,
      entitlements: { "com.apple.security.app-sandbox": true },
      limitations: expect.arrayContaining([
        expect.stringContaining(
          "signature identity, hashes, designated requirement",
        ),
        "Unsigned Mach-O slices: x86_64.",
        "The designated requirement for the requested architecture is unavailable because codesign reported it unsigned.",
      ]),
      provenance: expect.arrayContaining([
        expect.objectContaining({
          command: [
            "/usr/bin/codesign",
            "-d",
            "-a",
            "x86_64",
            "--verbose=4",
            "$ARTIFACT",
          ],
          exit: { code: 1, signal: null },
        }),
        expect.objectContaining({
          command: expect.arrayContaining(["-a", signedArchitecture]),
          exit: { code: 0, signal: null },
        }),
      ]),
    });
  }
});

it("uses the admitted universal target when codesign describes only its selected slice", async () => {
  const existing = await signatureTarget();
  const header = parseExecutableHeader(await readFile(existing.path), "arm64");
  if (!header.ok || header.value.format !== "mach-o-universal")
    throw new Error("expected a universal Mach-O fixture");
  const signed = (await fixture("codesign.txt")).replace(
    /^Format=.*$/mu,
    "Format=Mach-O thin (arm64)",
  );
  const client = new NativeMacOSProvider(
    {},
    signatureRunner({
      signed,
      unsigned: await fixture("dyld-inventory/codesign-unsigned.txt"),
      entitlements: await fixture("entitlements.xml"),
      unsignedHeader: true,
    }),
    "darwin",
  ).createClient({ ...existing, ...header.value });
  const execution = await client.execute("inspect_signature", {});
  if (!execution.ok) throw execution.error;
  expect(execution.value.result).toMatchObject({
    signed: true,
    format: "Mach-O thin (arm64)",
    limitations: expect.arrayContaining([
      expect.stringContaining("Partial signature coverage"),
      "Unsigned Mach-O slices: x86_64.",
    ]),
    provenance: expect.arrayContaining([
      expect.objectContaining({
        command: expect.arrayContaining(["-a", "x86_64"]),
        exit: { code: 1, signal: null },
      }),
    ]),
  });
});

it("retains distinct same-family FAT slices for signature coverage", async () => {
  const path = join(
    await createTestTempDirectory("rea-native-same-family-"),
    "fixture",
  );
  await writeFile(
    path,
    fatImage(
      [CPU.arm64, CPU.arm64e].map((cpu) => ({
        cpu,
        bytes: machoImage({ cpu }),
      })),
    ),
  );
  const header = parseExecutableHeader(await readFile(path), "arm64");
  if (!header.ok || header.value.format !== "mach-o-universal")
    throw new Error("expected universal fixture");
  const replay = signatureRunner({
    signed: (await fixture("codesign.txt")).replace(
      /^Format=.*$/mu,
      "Format=Mach-O thin (arm64)",
    ),
    unsigned: await fixture("dyld-inventory/codesign-unsigned.txt"),
    entitlements: await fixture("entitlements.xml"),
    unsignedHeader: true,
  });
  const runner: NativeCommandRunner = {
    async run(tool, args, options) {
      const result = await replay.run(
        tool,
        args.map((value) => (value === "arm64e" ? "x86_64" : value)),
        options,
      );
      return result.ok ? ok({ ...result.value, arguments: [...args] }) : result;
    },
  };
  const client = new NativeMacOSProvider({}, runner, "darwin").createClient({
    ...(await nativeMachoTargetForFile(path)),
    ...header.value,
  });
  const execution = await client.execute("inspect_signature", {});
  if (!execution.ok) throw execution.error;
  expect(execution.value.result).toMatchObject({
    limitations: expect.arrayContaining([
      expect.stringContaining("Partial signature coverage"),
      "Unsigned Mach-O slices: arm64e.",
    ]),
    provenance: expect.arrayContaining([
      expect.objectContaining({
        command: expect.arrayContaining(["-a", "arm64e"]),
        exit: { code: 1, signal: null },
      }),
    ]),
  });
});

it.each([42, 0x81000002])(
  "reports unknown signature coverage for unmapped FAT subtype %i",
  async (subtype) => {
    const path = join(
      await createTestTempDirectory("rea-native-unknown-subtype-"),
      "fixture",
    );
    const unknown = { type: CPU.arm64.type, subtype };
    await writeFile(
      path,
      fatImage(
        [CPU.arm64, unknown].map((cpu) => ({
          cpu,
          bytes: machoImage({ cpu }),
        })),
      ),
    );
    const header = parseExecutableHeader(await readFile(path), "arm64");
    if (!header.ok || header.value.format !== "mach-o-universal")
      throw new Error("expected universal fixture");
    const client = new NativeMacOSProvider(
      {},
      signatureRunner({
        signed: await fixture("codesign.txt"),
        unsigned: await fixture("dyld-inventory/codesign-unsigned.txt"),
        entitlements: await fixture("entitlements.xml"),
      }),
      "darwin",
    ).createClient({
      ...(await nativeMachoTargetForFile(path)),
      ...header.value,
    });
    const execution = await client.execute("inspect_signature", {});
    if (!execution.ok) throw execution.error;
    expect(execution.value.result).toMatchObject({
      limitations: expect.arrayContaining([
        expect.stringContaining("signature states are unknown"),
        expect.stringContaining("Partial signature coverage"),
      ]),
    });
  },
);

it.each(["x64", "arm64"] as const)(
  "inspects an x86_64 LIB64 slice when %s is selected",
  async (host) => {
    const path = join(
      await createTestTempDirectory("rea-native-lib64-"),
      "fixture",
    );
    const lib64 = { type: CPU.x86_64.type, subtype: 0x80000003 };
    await writeFile(
      path,
      fatImage(
        [lib64, CPU.arm64].map((cpu) => ({ cpu, bytes: machoImage({ cpu }) })),
      ),
    );
    const header = parseExecutableHeader(await readFile(path), host);
    if (!header.ok || header.value.format !== "mach-o-universal")
      throw new Error("expected universal fixture");
    const replay = signatureRunner({
      signed: await fixture("codesign.txt"),
      unsigned: await fixture("dyld-inventory/codesign-unsigned.txt"),
      entitlements: await fixture("entitlements.xml"),
      unsignedHeader: true,
    });
    const calls: (readonly string[])[] = [];
    const runner: NativeCommandRunner = {
      run(tool, args, options) {
        calls.push(args);
        return replay.run(tool, args, options);
      },
    };
    const client = new NativeMacOSProvider({}, runner, "darwin").createClient({
      ...(await nativeMachoTargetForFile(path)),
      ...header.value,
    });
    const result = await client.execute("inspect_signature", {});
    if (!result.ok) throw result.error;
    expect(calls.some((args) => args.includes("x86_64"))).toBe(true);
    expect(result.value.result).toMatchObject({
      limitations: expect.arrayContaining(["Unsigned Mach-O slices: x86_64."]),
    });
    if (host === "x64")
      expect(calls.slice(0, 3).every((args) => args.includes("x86_64"))).toBe(
        true,
      );
  },
);

it("rejects nonzero supplemental codesign output that is not an unsigned observation", async () => {
  const signed = await fixture("codesign.txt");
  const entitlements = await fixture("entitlements.xml");
  const client = new NativeMacOSProvider(
    {},
    signatureRunner({
      signed,
      unsigned: "/private/fixture: invalid or unsupported format\n",
      entitlements,
    }),
    "darwin",
  ).createClient(await signatureTarget());

  const execution = await client.execute("inspect_signature", {});

  expect(execution).toMatchObject({
    ok: false,
    error: { _tag: "ProviderAdapterError" },
  });
});

it.each([
  "extra diagnostic",
  "foreign executable",
  "slice diagnostic",
  "later slice diagnostic",
])("rejects an unsigned response with %s", async (kind) => {
  const signed = (await fixture("codesign.txt")).replace(
    /^Format=.*$/mu,
    "Format=Mach-O universal (x86_64 arm64)",
  );
  const replay = signatureRunner({
    signed,
    unsigned: "code object is not signed at all",
    entitlements: await fixture("entitlements.xml"),
    unsignedHeader: true,
  });
  let captureCount = 0;
  const runner: NativeCommandRunner = {
    async run(tool, args, options) {
      captureCount += 1;
      const result = await replay.run(tool, args, options);
      if (!result.ok) return result;
      if (kind === "later slice diagnostic") {
        if (captureCount <= 3 || !args.includes("arm64")) return result;
        const stderr = "later architecture probe failed\n";
        return ok({
          ...result.value,
          exitCode: 1,
          stderr,
          stderrBytes: Buffer.byteLength(stderr),
        });
      }
      if (result.value.exitCode === 0) return result;
      const isSlice = captureCount > 3;
      if ((kind === "slice diagnostic") !== isSlice) return result;
      const stderr =
        kind === "foreign executable"
          ? result.value.stderr.replace(
              /^Executable=.*\n/u,
              "Executable=/foreign/program\n",
            )
          : `${result.value.stderr}additional codesign failure\n`;
      return ok({
        ...result.value,
        stderr,
        stderrBytes: Buffer.byteLength(stderr),
      });
    },
  };
  const result = await new NativeMacOSProvider({}, runner, "darwin")
    .createClient(await signatureTarget())
    .execute("inspect_signature", {});
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "ProviderAdapterError" },
  });
  if (kind.endsWith("slice diagnostic") && !result.ok) {
    const partial = inspectSignatureSchema.parse(
      result.error.partialObservation,
    );
    expect(partial).toMatchObject({
      signed: true,
      identifier: "com.example.fixture",
      entitlements: { "com.apple.security.app-sandbox": true },
      designated_requirement: null,
      limitations: expect.arrayContaining([
        expect.stringContaining("Partial signature coverage"),
        expect.stringContaining("did not complete"),
      ]),
    });
    expect(partial.provenance).toHaveLength(
      kind === "later slice diagnostic" ? 5 : 4,
    );
    expect(partial.provenance[0]?.command).toContain("--verbose=4");
    expect(partial.provenance[1]?.command).toContain("-r-");
    expect(partial.provenance[2]?.command).toContain("--entitlements");
    if (kind === "later slice diagnostic") {
      expect(partial.limitations).toEqual(
        expect.arrayContaining([
          "Unsigned Mach-O slices: x86_64.",
          "The designated requirement for the requested architecture is unavailable because codesign reported it unsigned.",
        ]),
      );
      expect(partial.provenance[4]).toMatchObject({
        command: expect.arrayContaining(["-a", "arm64"]),
        exit: { code: 1, signal: null },
      });
    }
    expect(partial.provenance[3]).toMatchObject({
      command: expect.arrayContaining(["-a", "x86_64"]),
      exit: { code: 1, signal: null },
    });
  }
});

it("retains native inventory facts from captured Apple tool output", async () => {
  const outputs: Record<string, string> = {};
  for (const tool of ["lipo", "nm", "dwarfdump", "vtool"])
    outputs[tool] = await fixture(`dyld-inventory/${tool}.txt`);
  outputs["nm:-gju"] = "_puts\n_fixture_weak\n";
  outputs["dyld_info:-imports"] = await fixture("dyld-inventory/imports.txt");
  const exportsOutput = await fixture("dyld-inventory/exports.txt");
  outputs["dyld_info:-exports"] = exportsOutput;
  const client = new NativeMacOSProvider(
    {},
    inventoryRunner(outputs),
    "darwin",
  ).createClient(await inventoryTarget(true));
  const execution = await client.execute("inspect_macho", {});
  if (!execution.ok) throw execution.error;
  expect(execution.value.result).toMatchObject({
    imports: {
      items: [
        {
          name: "_puts",
          runtime_name: "puts",
          name_status: "exact",
          address: null,
          source: "libSystem",
        },
        {
          name: "_fixture_weak",
          runtime_name: "fixture_weak",
          name_status: "exact",
          address: null,
          source: "<weak-def-coalesce>",
        },
      ],
    },
    exports: {
      items: expect.arrayContaining([
        expect.objectContaining({
          name: "_fixture_export",
          runtime_name: "fixture_export",
          address: "0x100000468",
        }),
        expect.objectContaining({
          name: "_fixture_weak",
          address: "0x100000460",
          weak: true,
        }),
        expect.objectContaining({
          name: "_fixture_absolute",
          address: "0x42",
        }),
      ]),
    },
  });
  expect(
    parseDyldImports(await fixture("dyld-imports.txt"), false).items,
  ).toEqual([
    {
      name: "__Block_copy",
      raw_name: null,
      name_status: "exact",
      addend: null,
      address: null,
      weak: null,
      reexport: null,
      source: "libSystem",
    },
    {
      name: "_objc_bp_assist_cfg_np",
      raw_name: null,
      name_status: "exact",
      addend: null,
      address: null,
      weak: true,
      reexport: null,
      source: "libSystem",
    },
  ]);
  expect(
    parseDyldExports(
      await fixture("dyld-inventory/library-reexports.txt"),
      null,
      new Set(),
    ),
  ).toEqual([
    {
      name: "__ZNKSt10bad_typeid4whatEv",
      address: null,
      weak: null,
      reexport: true,
      source: "libc++abi",
    },
  ]);
  expect(parseDyldExports(exportsOutput, null, new Set())).toContainEqual({
    name: "_fixture_export",
    address: null,
    weak: null,
    reexport: false,
    source: null,
  });
});

it("preserves literal import suffixes and whitespace through native inspection", async () => {
  // Actual Apple dyld_info output for .quad references in an inert arm64
  // executable, linked with -no_fixup_chains and -undefined dynamic_lookup.
  const imports = [
    "    -imports:",
    "        _leading  (from <flat-namespace>)",
    "      _literal [weak-import]  (from <flat-namespace>)",
    "      _trailing    (from <flat-namespace>)",
    "      _weak [weak-import] (from <flat-namespace>)",
    "",
  ].join("\n");
  const client = new NativeMacOSProvider(
    {},
    inventoryRunner({ "dyld_info:-imports": imports }),
    "darwin",
  ).createClient(await inventoryTarget());
  const execution = await client.execute("inspect_macho", {});
  if (!execution.ok) throw execution.error;
  expect(execution.value.result).toMatchObject({
    imports: {
      exhaustive: false,
      items: [
        {
          name: "  _leading",
          runtime_name: "  _leading",
          name_status: "exact",
        },
        {
          name: "_literal [weak-import]",
          runtime_name: "literal [weak-import]",
          weak: null,
          name_status: "exact",
        },
        {
          name: "_trailing  ",
          runtime_name: "trailing  ",
          weak: null,
          name_status: "exact",
        },
        {
          name: "_weak",
          runtime_name: "weak",
          weak: true,
          name_status: "exact",
        },
      ],
    },
  });
});

it("retains unfamiliar and competing import boundaries as unknown", () => {
  for (const row of [
    "_future [new-flag] (from library)",
    "_literal  (from name)  (from library)",
  ])
    expect(parseDyldImports(`      ${row}`, false).items).toEqual([
      {
        name: null,
        raw_name: row,
        name_status: "ambiguous",
        addend: null,
        address: null,
        weak: null,
        reexport: null,
        source: null,
      },
    ]);
});

it("uses independent undefined names to resolve chained producer spacing", async () => {
  const outputs: Record<string, string> = {};
  for (const tool of ["lipo", "nm", "dwarfdump", "vtool"])
    outputs[tool] = await fixture(`dyld-inventory/${tool}.txt`);
  outputs["nm:-gju"] =
    "  _leading\n_literal [weak-import]\n_trailing  \n_weak\n";
  // Actual forced-chained output from the same inert assembler references.
  outputs["dyld_info:-imports"] = [
    "    -imports:",
    "      0x0000  _weak [weak-import] (from <flat-namespace>)",
    "      0x0001  _trailing    (from <flat-namespace>)",
    "      0x0002  _literal [weak-import]  (from <flat-namespace>)",
    "      0x0003    _leading  (from <flat-namespace>)",
  ].join("\n");
  const client = new NativeMacOSProvider(
    {},
    inventoryRunner(outputs),
    "darwin",
  ).createClient(await inventoryTarget(true));
  const execution = await client.execute("inspect_macho", {});
  if (!execution.ok) throw execution.error;
  expect(execution.value.result).toMatchObject({
    imports: {
      items: [
        { name: "_weak", weak: true, name_status: "exact" },
        { name: "_trailing  ", weak: null, name_status: "exact" },
        { name: "_literal [weak-import]", weak: null, name_status: "exact" },
        { name: "  _leading", weak: null, name_status: "exact" },
      ],
    },
    exports: {
      items: expect.arrayContaining([
        expect.objectContaining({ name: "_main", runtime_name: "main" }),
      ]),
    },
  });
});

it("keeps missing and competing undefined-name matches unknown", () => {
  const output = "      0x0000  _literal  (from library)";
  expect(parseDyldImports(output, true).needsNameInventory).toBe(true);
  for (const names of [new Set<string>(), new Set(["_literal", " _literal"])])
    expect(parseDyldImports(output, true, names)).toEqual({
      needsNameInventory: false,
      items: [
        {
          name: null,
          raw_name: "0x0000  _literal  (from library)",
          name_status: "ambiguous",
          addend: null,
          address: null,
          weak: null,
          reexport: null,
          source: "library",
        },
      ],
    });
});

it("reports a chained bind addend separately in native inspection", async () => {
  const outputs: Record<string, string> = {};
  for (const tool of ["lipo", "nm", "dwarfdump", "vtool"])
    outputs[tool] = await fixture(`dyld-inventory/${tool}.txt`);
  outputs["dyld_info:-imports"] =
    "-imports:\n      0x0000 _fixture_data  (from libFixture)\n      0x0001 _fixture_data+0x4  (from libFixture)\n";
  outputs["dyld_info:-exports"] = await fixture("dyld-inventory/exports.txt");
  const client = new NativeMacOSProvider(
    {},
    inventoryRunner(outputs),
    "darwin",
  ).createClient(await inventoryTarget(true));
  const execution = await client.execute("inspect_macho", {});
  if (!execution.ok) throw execution.error;
  expect(execution.value.result).toMatchObject({
    imports: {
      exhaustive: false,
      limitations: expect.arrayContaining([
        "Import text contains name, flags, library, or addend boundaries whose split is ambiguous.",
      ]),
      items: [
        {
          name: "_fixture_data",
          runtime_name: "fixture_data",
          raw_name: null,
          name_status: "exact",
          addend: null,
          address: null,
          weak: null,
          reexport: null,
          source: "libFixture",
        },
        {
          name: null,
          runtime_name: null,
          raw_name: "_fixture_data+0x4",
          name_status: "ambiguous",
          addend: null,
          address: null,
          weak: null,
          reexport: null,
          source: "libFixture",
        },
      ],
    },
  });
});

it("reports a renamed re-export once under its exported name", async () => {
  const client = new NativeMacOSProvider(
    {},
    inventoryRunner({
      "dyld_info:-exports": await fixture(
        "dyld-inventory/renamed-reexports.txt",
      ),
      nm: "_foo_renamed\n_own\n",
    }),
    "darwin",
  ).createClient(await inventoryTarget());
  const execution = await client.execute("inspect_macho", {});
  if (!execution.ok) throw execution.error;
  expect(execution.value.result).toMatchObject({
    exports: {
      items: [
        {
          name: "_foo_renamed",
          address: null,
          weak: null,
          reexport: true,
          source: "libfoo",
        },
        { name: "_own", reexport: false, source: null },
      ],
      limitations: [
        "Merged nm/dyld_info results may be incomplete for stripped binaries.",
        "Renamed re-exports are listed under their exported name; the source library's symbol name is not reported.",
      ],
    },
  });
});

it("splits re-export rows at the source library", () => {
  // dyld_info -exports rows for synthetic dylibs: a source symbol named
  // `operator()`, and a library whose install name contains ` from `.
  expect(
    parseDyldExports(
      [
        "[re-export] _call_renamed (operator() from libfoo)",
        "[re-export] _g (from lib from foo)",
        "[re-export] _nested (from lib (from foo))",
      ].join("\n"),
      null,
      new Set(["_call_renamed", "_g", "_nested"]),
    ),
  ).toEqual([
    {
      name: "_call_renamed",
      address: null,
      weak: null,
      reexport: true,
      source: "libfoo",
      sourceSymbol: "operator()",
    },
    {
      name: "_g",
      address: null,
      weak: null,
      reexport: true,
      source: "lib from foo",
    },
    {
      name: "_nested",
      address: null,
      weak: null,
      reexport: true,
      source: "lib (from foo)",
    },
  ]);
});

it("retains symbol names containing spaces in dyld inventory rows", () => {
  expect(
    parseDyldImports("      _entry with space  (from fixture)", false).items,
  ).toEqual([
    {
      name: "_entry with space",
      raw_name: null,
      name_status: "exact",
      addend: null,
      address: null,
      weak: null,
      reexport: null,
      source: "fixture",
    },
  ]);
  expect(
    parseDyldExports(
      "  offset symbol\n  0x00000348  _entry with space",
      "0x0",
      new Set(),
    ),
  ).toEqual([
    {
      name: "_entry with space",
      address: "0x348",
      weak: null,
      reexport: false,
      source: null,
    },
  ]);
  expect(
    parseDyldExports(
      "[re-export] _entry with space (from fixture)",
      null,
      new Set(),
    ),
  ).toEqual([
    {
      name: "_entry with space",
      address: null,
      weak: null,
      reexport: true,
      source: "fixture",
    },
  ]);
  expect(
    parseDyldExports("0x123 _weak with space [weak-def]", null, new Set()),
  ).toEqual([
    {
      name: "_weak with space",
      address: "0x123",
      weak: true,
      reexport: false,
      source: null,
    },
  ]);
});

const signatureRunner = (outputs: {
  readonly signed: string;
  readonly unsigned: string;
  readonly entitlements: string;
  readonly unsignedHeader?: boolean;
}): NativeCommandRunner => ({
  async run(
    tool: string,
    arguments_: readonly string[],
    options: NativeCommandOptions,
  ) {
    const architectureIndex = arguments_.indexOf("-a");
    const architecture =
      architectureIndex < 0 ? null : arguments_[architectureIndex + 1];
    const selectedResponse = arguments_.includes("-r-")
      ? { output: outputs.unsigned, exitCode: 1 }
      : arguments_.includes("--entitlements")
        ? { output: outputs.entitlements, exitCode: 0 }
        : architecture === "x86_64"
          ? { output: outputs.unsigned, exitCode: 1 }
          : { output: outputs.signed, exitCode: 0 };
    const response =
      selectedResponse.exitCode !== 0 &&
      selectedResponse.output.includes("code object is not signed at all")
        ? {
            ...selectedResponse,
            output: `${outputs.unsignedHeader ? `Executable=${await realpath(arguments_.at(-1)!)}\n` : ""}${arguments_.at(-1)}: code object is not signed at all\n`,
          }
        : selectedResponse;
    const capture: NativeCommandCapture = {
      tool,
      executable: `/usr/bin/${tool}`,
      executableSha256: "a".repeat(64),
      toolVersion: null,
      versionReason: "fixture",
      arguments: [...arguments_],
      // Entitlements XML is printed to stdout; diagnostics to stderr.
      ...(response.exitCode === 0 && arguments_.includes("--entitlements")
        ? {
            stdout: response.output,
            stderr: "",
            stdoutBytes: Buffer.byteLength(response.output),
            stderrBytes: 0,
          }
        : {
            stdout: "",
            stderr: response.output,
            stdoutBytes: 0,
            stderrBytes: Buffer.byteLength(response.output),
          }),
      exitCode: response.exitCode,
      signal: null,
    };
    return Promise.resolve(
      response.exitCode === 0 || options.acceptNonZero === true
        ? ok(capture)
        : err(
            new NativeCommandFailure(tool, "nonzero-exit", response.exitCode),
          ),
    );
  },
});

it.each(["weak-def", "absolute", "literal suffix"])(
  "preserves an nm-proven export name ending in [%s]",
  (suffix) => {
    const name = `symbol [${suffix}]`;
    expect(
      parseDyldExports(
        `offset symbol\n0x120 ${name}`,
        "0x1000",
        new Set([name]),
      ),
    ).toEqual([
      { name, address: "0x1120", weak: null, reexport: false, source: null },
    ]);
  },
);

it("keeps true weak annotations when nm establishes the unannotated name", () => {
  expect(
    parseDyldExports("0x120 _weak [weak-def]", null, new Set(["_weak"])),
  ).toEqual([
    {
      name: "_weak",
      address: "0x120",
      weak: true,
      reexport: false,
      source: null,
    },
  ]);
});

it("retains chained import suffixes as ambiguous raw text", () => {
  expect(
    parseDyldImports(
      "      0x0000 _fixture_data  (from libFixture)\n      0x0001 _fixture_data+0x4  (from libFixture)\n      0x0002 _fixture_weak+0x8 [weak-import] (from libFixture)",
      true,
    ).items,
  ).toEqual([
    {
      name: "_fixture_data",
      raw_name: null,
      name_status: "exact",
      addend: null,
      address: null,
      weak: null,
      reexport: null,
      source: "libFixture",
    },
    {
      name: null,
      raw_name: "_fixture_data+0x4",
      name_status: "ambiguous",
      addend: null,
      address: null,
      weak: null,
      reexport: null,
      source: "libFixture",
    },
    {
      name: null,
      raw_name: "_fixture_weak+0x8",
      name_status: "ambiguous",
      addend: null,
      address: null,
      weak: true,
      reexport: null,
      source: "libFixture",
    },
  ]);
  expect(
    parseDyldImports("      0x0001 _literal+0x4  (from libFixture)", true)
      .items,
  ).toEqual([
    {
      name: null,
      raw_name: "_literal+0x4",
      name_status: "ambiguous",
      addend: null,
      address: null,
      weak: null,
      reexport: null,
      source: "libFixture",
    },
  ]);
  expect(
    parseDyldImports("      _literal+0x4  (from libFixture)", false).items,
  ).toMatchObject([{ name: "_literal+0x4", name_status: "exact" }]);
});

it("leaves an ambiguous short and literal name to the caller's nm inventory", () => {
  expect(
    parseDyldExports(
      "0x120 symbol [weak-def]",
      null,
      new Set(["symbol", "symbol [weak-def]"]),
    ),
  ).toEqual([]);
});

it("retains unmatched re-export rows when the known export inventory is incomplete", () => {
  expect(
    parseDyldExports("[re-export] _g (from libfoo)", null, new Set(["_own"])),
  ).toEqual([
    {
      name: "_g",
      address: null,
      weak: null,
      reexport: true,
      source: "libfoo",
    },
  ]);
});

it("retains annotation parsing without nm name evidence", () => {
  expect(parseDyldExports("0x120 _weak [weak-def]", null, new Set())).toEqual([
    {
      name: "_weak",
      address: "0x120",
      weak: true,
      reexport: false,
      source: null,
    },
  ]);
});

/** Replay fixtures, answering nm by whether its dyld-info pass is disabled. */
const symbolTableRunner = (
  outputs: Readonly<Record<string, string>>,
  nm: { readonly symbolTable: string; readonly withDyldInfo: string },
) => {
  const nmArguments: (readonly string[])[] = [];
  const replay = (output: string) =>
    inventoryRunner({ ...outputs, nm: output });
  const runner: NativeCommandRunner = {
    run: (tool, arguments_) => {
      if (tool !== "nm") return replay("").run(tool, arguments_);
      nmArguments.push([...arguments_.slice(0, -1), "/private/fixture"]);
      return replay(
        arguments_.includes("--no-dyldinfo") ? nm.symbolTable : nm.withDyldInfo,
      ).run(tool, arguments_);
    },
  };
  return { runner, nmArguments };
};

/** nm arguments in provenance, which records the artifact operand as a placeholder. */
const nmCommands = (result: unknown) =>
  (result as { provenance: { tool: string; command: string[] }[] }).provenance
    .filter(({ tool }) => tool === "nm")
    .map(({ command }) => [...command.slice(1, -1), "/private/fixture"]);

it("reads exports from the symbol table without llvm-nm's dyld-info pass", async () => {
  const names = await fixture("dyld-inventory/nm.txt");
  const { runner, nmArguments } = symbolTableRunner(
    { "dyld_info:-exports": await fixture("dyld-inventory/exports.txt") },
    { symbolTable: names, withDyldInfo: names },
  );
  const execution = await new NativeMacOSProvider({}, runner, "darwin")
    .createClient(await inventoryTarget())
    .execute("inspect_macho", {});
  if (!execution.ok) throw execution.error;
  expect(nmArguments).toEqual([
    ["-gjU", "--no-dyldinfo", "-arch", "arm64", "/private/fixture"],
  ]);
  expect(nmCommands(execution.value.result)).toEqual(nmArguments);
});

it("binds leading-space exports to their exact nm identities", async () => {
  // Real clang dylib: .globl "  _spaced"; "  _spaced": ret; .globl _spaced; _spaced: ret.
  // dyld_info separates the address from the literal symbol with two spaces.
  const names = "  _spaced\n_spaced\n";
  const { runner, nmArguments } = symbolTableRunner(
    {
      "dyld_info:-exports": [
        "fixture [arm64]:",
        "    -exports:",
        "        offset      symbol",
        "        0x000002A0    _spaced",
        "        0x000002A4  _spaced",
        "",
      ].join("\n"),
    },
    { symbolTable: names, withDyldInfo: names },
  );
  const execution = await new NativeMacOSProvider({}, runner, "darwin")
    .createClient(await inventoryTarget())
    .execute("inspect_macho", {});
  if (!execution.ok) throw execution.error;
  expect(nmArguments).toHaveLength(1);
  const exported = (
    execution.value.result as {
      exports: { items: { name: string; address: string | null }[] };
    }
  ).exports.items;
  expect(exported).toEqual([
    expect.objectContaining({ name: "  _spaced", address: "0x1000002a0" }),
    expect.objectContaining({ name: "_spaced", address: "0x1000002a4" }),
  ]);
});

it("keeps an export name ending in a carriage return distinct", async () => {
  // Captured from a clang executable exporting "trailing\r" and "trailing".
  const names = "__mh_execute_header\n_main\ntrailing\ntrailing\r\n";
  const { runner, nmArguments } = symbolTableRunner(
    {
      "dyld_info:-exports": [
        "fixture [arm64]:",
        "    -exports:",
        "        offset      symbol",
        "        0x00000000  __mh_execute_header",
        "        0x00000338  _main",
        "        0x00000330  trailing",
        "        0x00000328  trailing\r",
        "",
      ].join("\n"),
    },
    { symbolTable: names, withDyldInfo: names },
  );
  const execution = await new NativeMacOSProvider({}, runner, "darwin")
    .createClient(await inventoryTarget())
    .execute("inspect_macho", {});
  if (!execution.ok) throw execution.error;
  expect(nmArguments).toHaveLength(1);
  const exported = (
    execution.value.result as {
      exports: { items: { name: string; address: string | null }[] };
    }
  ).exports.items.filter(({ name }) => name.startsWith("trailing"));
  expect(exported).toEqual([
    expect.objectContaining({ name: "trailing", address: "0x100000330" }),
    expect.objectContaining({ name: "trailing\r", address: "0x100000328" }),
  ]);
});

it("reruns nm with its dyld-info pass when a stripped symbol table omits trie exports", async () => {
  const trieNames = await fixture("dyld-inventory/stripped-swift-nm.txt");
  const { runner, nmArguments } = symbolTableRunner(
    {
      "dyld_info:-exports": await fixture(
        "dyld-inventory/stripped-swift-exports.txt",
      ),
    },
    { symbolTable: "", withDyldInfo: trieNames },
  );
  const execution = await new NativeMacOSProvider({}, runner, "darwin")
    .createClient(await inventoryTarget())
    .execute("inspect_macho", {});
  if (!execution.ok) throw execution.error;
  const rerun = ["-gjU", "-arch", "arm64", "/private/fixture"];
  expect(nmArguments).toEqual([
    ["-gjU", "--no-dyldinfo", "-arch", "arm64", "/private/fixture"],
    rerun,
  ]);
  // Provenance names the nm run whose output the exports came from.
  expect(nmCommands(execution.value.result)).toEqual([rerun]);
  const exported = (
    execution.value.result as { exports: { items: { name: string }[] } }
  ).exports.items.map(({ name }) => name);
  expect(exported).toEqual(trieNames.trim().split("\n").sort());
});

it("reruns nm with its dyld-info pass when a dyld_info export row is unreadable", async () => {
  const names = await fixture("dyld-inventory/nm.txt");
  const exportsOutput = await fixture("dyld-inventory/exports.txt");
  const { runner, nmArguments } = symbolTableRunner(
    {
      "dyld_info:-exports": `${exportsOutput.trimEnd()}\n        <unrecognized export row>\n`,
    },
    { symbolTable: names, withDyldInfo: names },
  );
  const execution = await new NativeMacOSProvider({}, runner, "darwin")
    .createClient(await inventoryTarget())
    .execute("inspect_macho", {});
  if (!execution.ok) throw execution.error;
  expect(nmArguments.map((arguments_) => arguments_.slice(0, 2))).toEqual([
    ["-gjU", "--no-dyldinfo"],
    ["-gjU", "-arch"],
  ]);
});

it("lets codesign select the only slice of a thin arm64e target", async () => {
  const path = join(
    await createTestTempDirectory("rea-thin-signature-"),
    "fixture",
  );
  await writeFile(path, machoImage({ cpu: CPU.arm64e }));
  const calls: (readonly string[])[] = [];
  const display = (await fixture("codesign.txt")).replace(
    /^Format=.*$/mu,
    "Format=Mach-O thin (arm64e)",
  );
  const runner: NativeCommandRunner = {
    run(tool, args, options) {
      calls.push(args);
      return new FixtureRunner({ codesign: display }).run(tool, args, options);
    },
  };
  const client = new NativeMacOSProvider({}, runner, "darwin").createClient(
    await nativeMachoTargetForFile(path),
  );
  const result = await client.execute("inspect_signature", {});
  if (!result.ok) throw result.error;
  expect(result.value.result).toMatchObject({ signed: true });
  expect(calls).toHaveLength(3);
  expect(calls.every((args) => !args.includes("-a"))).toBe(true);
  await client.close();
});

it.each(["arm64", "x86_64"] as const)(
  "binds every signature facet to the requested %s slice when all slices are signed",
  async (architecture) => {
    const registered = await signatureTarget();
    const header = parseExecutableHeader(
      await readFile(registered.path),
      architecture === "x86_64" ? "x64" : "arm64",
    );
    if (!header.ok || header.value.format !== "mach-o-universal")
      throw new Error("expected universal fixture");
    const display = (await fixture("codesign.txt")).replace(
      /^Format=.*$/mu,
      "Format=Mach-O universal (x86_64 arm64)",
    );
    const calls: (readonly string[])[] = [];
    const runner: NativeCommandRunner = {
      run(tool, args, options) {
        calls.push(args);
        const selected = args[args.indexOf("-a") + 1];
        const output = args.includes("-r-")
          ? `designated => identifier com.example.${selected}\n`
          : args.includes("--entitlements")
            ? `<?xml version="1.0"?><plist><dict><key>slice</key><string>${selected}</string></dict></plist>`
            : display.replace(
                /^Identifier=.*$/mu,
                `Identifier=com.example.${selected}`,
              );
        return new FixtureRunner({ codesign: output }).run(tool, args, options);
      },
    };
    const result = await new NativeMacOSProvider({}, runner, "darwin")
      .createClient({ ...registered, ...header.value })
      .execute("inspect_signature", {});
    if (!result.ok) throw result.error;
    expect(result.value.result).toMatchObject({
      identifier: `com.example.${architecture}`,
      designated_requirement: `identifier com.example.${architecture}`,
      entitlements: { slice: architecture },
      limitations: expect.arrayContaining([
        expect.stringContaining(`requested ${architecture} architecture`),
      ]),
    });
    expect(
      calls
        .slice(0, 3)
        .every((args) => args[args.indexOf("-a") + 1] === architecture),
    ).toBe(true);
    expect(calls.slice(3).map((args) => args[args.indexOf("-a") + 1])).toEqual([
      "x86_64",
      "arm64",
    ]);
  },
);
