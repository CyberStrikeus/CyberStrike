import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  CPU,
  fatImage,
  machoImage,
} from "../../../../src/artifacts/apple/MachoImage.fixture.js";
import { inspectMachoSchema } from "../../../../src/domain/native/nativeInspection.js";
import { err } from "../../../../src/domain/result.js";
import {
  NativeCommandFailure,
  type NativeCommandRunner,
} from "../../../../src/native/CommandRunner.js";
import { NativeMacOSProvider } from "../../../../src/native/NativeMacOSProvider.js";
import type { AnalysisClient } from "../../../../src/application/AnalysisProvider.js";
import { inspectionImage } from "../../../../src/native/NativeMachoInspection.fixture.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import {
  NativeFixtureRunner,
  nativeMachoTargetForFile,
} from "../../../fixtures/nativeCommands.js";

const cpus = {
  x86_64: CPU.x86_64,
  i386: CPU.i386,
  arm64: CPU.arm64,
  arm64v8: { type: CPU.arm64.type, subtype: 1 },
  arm64e: CPU.arm64e,
  "arm64e.x1": { type: CPU.arm64.type, subtype: 0x8000000c },
  "arm64e.v1": { type: CPU.arm64.type, subtype: 0x81000002 },
} as const;
type SliceName = keyof typeof cpus;

const inspect = async (client: AnalysisClient) => {
  try {
    return await client.execute("inspect_macho", {});
  } finally {
    expect((await client.close()).ok).toBe(true);
  }
};

const sliceImage = (
  name: SliceName,
  uuid = "01234567-89AB-CDEF-0123-456789ABCDEF",
) => {
  const cpu = cpus[name];
  if (name === "i386") return machoImage({ cpu, wide: false });
  const original = inspectionImage({ uuids: [uuid] });
  const image = new Uint8Array(4096);
  image.set(original.subarray(0, original.length - 16));
  const view = new DataView(image.buffer);
  const at = original.length - 16;
  view.setUint32(at, 0x80000028, true);
  view.setUint32(at + 4, 24, true);
  view.setBigUint64(at + 8, 1024n, true);
  view.setBigUint64(32 + 48, 4096n, true);
  view.setUint32(16, view.getUint32(16, true) + 1, true);
  view.setUint32(20, view.getUint32(20, true) + 24, true);
  view.setUint32(4, cpu.type, true);
  view.setUint32(8, cpu.subtype, true);
  return image;
};

const makeFat = async (names: readonly SliceName[], filename = "universal") => {
  const directory = await createTestTempDirectory("rea-selected-macho-");
  const path = join(directory, filename);
  const slices = names.map((name) => ({
    cpu: cpus[name],
    bytes: sliceImage(
      name,
      name === "x86_64" ? "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA" : undefined,
    ),
  }));
  const image = fatImage(slices);
  await writeFile(path, image);
  const rows = names
    .map((name, index) => {
      const slice = slices[index]!;
      return `architecture ${name}\n cputype ${slice.cpu.type}\n cpusubtype ${slice.cpu.subtype}\n offset ${(index + 1) * 4096}\n size ${slice.bytes.length}\n align 2^12\n`;
    })
    .join("");
  return {
    target: await nativeMachoTargetForFile(path),
    path,
    lipo: `Fat header in: ${path}\nfat_magic 0xcafebabe\nnfat_arch ${names.length}\n${rows}`,
  };
};

const sliceSelectingRunner = (
  fixtures: NativeFixtureRunner,
  selected: string,
  dyldArchitecture: string,
  calls: { tool: string; arguments_: readonly string[] }[] = [],
): NativeCommandRunner => ({
  run(tool, arguments_) {
    calls.push({ tool, arguments_ });
    const expected = tool === "dyld_info" ? dyldArchitecture : selected;
    if (
      tool !== "lipo" &&
      !arguments_.some(
        (argument, index) =>
          argument === expected ||
          argument === `--arch=${expected}` ||
          (argument === "-arch" && arguments_[index + 1] === expected),
      )
    )
      return Promise.resolve(
        err(new NativeCommandFailure(tool, "nonzero-exit", 1)),
      );
    return fixtures.run(tool, arguments_);
  },
});

it("does not attribute another universal slice's UUID or segments to the selected target", async () => {
  const fixture = await makeFat(["x86_64", "arm64"]);
  const runner = new NativeFixtureRunner({
    lipo: fixture.lipo,
    dwarfdump: `UUID: AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA (x86_64) ${fixture.path}\nUUID: 01234567-89AB-CDEF-0123-456789ABCDEF (arm64) ${fixture.path}\n`,
  });
  const result = await inspect(
    new NativeMacOSProvider({}, runner, "darwin").createClient(fixture.target),
  );
  if (!result.ok) throw result.error;
  expect(result.value.result).toMatchObject({
    uuid: "01234567-89AB-CDEF-0123-456789ABCDEF",
    selected_architecture: { name: "arm64", container_file_offset: 8192 },
    architectures: { total: 2 },
  });
  const normalized = inspectMachoSchema.parse(result.value.result);
  expect(
    normalized.segments.items.filter((segment) => segment.name === "__TEXT"),
  ).toHaveLength(1);
  expect(JSON.stringify(normalized)).not.toContain(
    "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
  );
});

it.each([
  {
    architectures: ["x86_64", "arm64e", "arm64e.x1"],
    selected: "arm64e",
    dyld: "arm64e",
    dwarf: "arm64e",
  },
  {
    architectures: ["x86_64", "arm64e.v1"],
    selected: "arm64e",
    dyld: "arm64e.v1",
    dwarf: "arm64e",
  },
  {
    architectures: ["arm64v8", "arm64e.v1"],
    selected: "arm64e",
    dyld: "arm64e.v1",
    dwarf: "arm64e",
  },
  {
    architectures: ["arm64e.v1", "arm64v8"],
    selected: "arm64e",
    dyld: "arm64e.v1",
    dwarf: "arm64e",
  },
  {
    architectures: ["x86_64", "arm64e.x1"],
    selected: "arm64e.x1",
    dyld: "arm64e.x1",
    dwarf: "arm64e.x1",
  },
] as const)(
  "selects the $dyld slice of a universal target",
  async ({ architectures, selected, dyld, dwarf }) => {
    const fixture = await makeFat(architectures);
    const calls: { tool: string; arguments_: readonly string[] }[] = [];
    const runner = sliceSelectingRunner(
      new NativeFixtureRunner({
        lipo: fixture.lipo,
        dwarfdump: `UUID: 01234567-89AB-CDEF-0123-456789ABCDEF (${dwarf}) ${fixture.path}\n`,
      }),
      selected,
      dyld,
      calls,
    );
    const result = await inspect(
      new NativeMacOSProvider({}, runner, "darwin").createClient(
        fixture.target,
      ),
    );
    if (!result.ok) throw result.error;
    expect(result.value.result).toMatchObject({
      uuid: "01234567-89AB-CDEF-0123-456789ABCDEF",
      selected_architecture: {
        name: dyld,
        container_file_offset:
          (architectures.indexOf(dyld as never) + 1) * 4096,
      },
      architectures: { items: architectures.map((name) => ({ name })) },
    });
    const dyldCalls = calls.filter(({ tool }) => tool === "dyld_info");
    expect(dyldCalls.length).toBeGreaterThan(0);
    expect(dyldCalls.every(({ arguments_ }) => arguments_.includes(dyld))).toBe(
      true,
    );
    expect(
      calls.find(({ tool }) => tool === "dwarfdump")?.arguments_,
    ).toContain(`--arch=${dwarf}`);
    expect(calls.some(({ tool }) => tool === "vtool")).toBe(
      !selected.includes("."),
    );
  },
);

it.each([
  {
    architecture: "arm64e.v2",
    uuid: "FEDCBA98-7654-3210-FEDC-BA9876543210",
    expected: "01234567-89AB-CDEF-0123-456789ABCDEF",
  },
  {
    architecture: "arm64e",
    uuid: "01234567-89ab-cdef-0123-456789abcdef",
    expected: "01234567-89ab-cdef-0123-456789abcdef",
  },
])(
  "reconciles only compatible dwarfdump row $architecture",
  async ({ architecture, uuid, expected }) => {
    const fixture = await makeFat(["arm64e.v1"]);
    const runner = sliceSelectingRunner(
      new NativeFixtureRunner({
        lipo: fixture.lipo,
        dwarfdump: `UUID: ${uuid} (${architecture}) ${fixture.path}\n`,
      }),
      "arm64e",
      "arm64e.v1",
    );
    const result = await inspect(
      new NativeMacOSProvider({}, runner, "darwin").createClient(
        fixture.target,
      ),
    );
    if (!result.ok) throw result.error;
    expect(result.value.result).toMatchObject({
      uuid: expected,
      selected_architecture: { name: "arm64e.v1", container_file_offset: 4096 },
    });
    if (architecture === "arm64e.v2")
      expect(result.value.limitations).toContain(
        "dwarfdump --uuid returned no row for selected architecture arm64e.v1; using the unambiguous binary load commands LC_UUID.",
      );
  },
);

it.each(["ordinary", "\nNon-fat file: forged", "\r\nNon-fat file: forged"])(
  "projects selected segment evidence with %s path framing",
  async (name) => {
    const fixture = await makeFat(["x86_64", "arm64"], name);
    const result = await inspect(
      new NativeMacOSProvider(
        {},
        new NativeFixtureRunner({ lipo: fixture.lipo }),
        "darwin",
      ).createClient(fixture.target),
    );
    if (!result.ok) throw result.error;
    expect(result.value.locations).toContainEqual({
      kind: "file-offset-range",
      start: 8192,
      end: 12288,
    });
    expect(result.value.locations).toContainEqual({
      kind: "file-offset",
      offset: 9216,
    });
    const normalized = inspectMachoSchema.parse(result.value.result);
    expect(normalized.segments.items[0]?.file_offset).toBe(0);
    expect(normalized.entrypoints.items[0]?.file_offset).toBe(1024);
  },
);

it.each(["thin", "one-slice FAT"])(
  "keeps %s segment locations in container coordinates",
  async (format) => {
    const fixture = await makeFat(["arm64"]);
    let lipo = fixture.lipo;
    if (format === "thin") {
      await writeFile(fixture.path, sliceImage("arm64"));
      lipo = `Non-fat file: ${fixture.path} is architecture: arm64\n`;
    }
    const target = await nativeMachoTargetForFile(fixture.path);
    const result = await inspect(
      new NativeMacOSProvider(
        {},
        new NativeFixtureRunner({ lipo }),
        "darwin",
      ).createClient(target),
    );
    if (!result.ok) throw result.error;
    const offset = format === "thin" ? 0 : 4096;
    expect(result.value.locations).toContainEqual({
      kind: "file-offset-range",
      start: offset,
      end: offset + 4096,
    });
    expect(result.value.result).toMatchObject({
      selected_architecture: { container_file_offset: offset },
    });
  },
);

it("uses the uniquely matching FAT entry when lipo omits the selected slice offset", async () => {
  const fixture = await makeFat(["x86_64", "arm64"]);
  const lipo = fixture.lipo.replace("offset 8192\n", "");
  const result = await inspect(
    new NativeMacOSProvider(
      {},
      new NativeFixtureRunner({ lipo }),
      "darwin",
    ).createClient(fixture.target),
  );
  if (!result.ok) throw result.error;
  expect(result.value.result).toMatchObject({
    selected_architecture: { container_file_offset: 8192 },
  });
});

it("reports the selected 32-bit slice's word size and byte order", async () => {
  const fixture = await makeFat(["x86_64", "i386"]);
  const runner = sliceSelectingRunner(
    new NativeFixtureRunner({ lipo: fixture.lipo, dwarfdump: "" }),
    "i386",
    "i386",
  );
  const result = await inspect(
    new NativeMacOSProvider({}, runner, "darwin").createClient({
      ...fixture.target,
      architecture: "x86",
      availableArchitectures: ["x86_64", "x86"],
    }),
  );
  if (!result.ok) throw result.error;
  expect(result.value.result).toMatchObject({
    selected_architecture: { name: "i386", container_file_offset: 8192 },
    word_size: 32,
    endian: "little",
  });
});
