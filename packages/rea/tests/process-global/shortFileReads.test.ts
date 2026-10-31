import { createHash } from "node:crypto";
import { writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({
  path: "",
  maximum: Number.POSITIVE_INFINITY,
  eof: Number.POSITIVE_INFINITY,
  reads: 0,
  onRead: undefined as (() => void) | undefined,
  beforeRead: undefined as
    | ((position: number, length: number) => void)
    | undefined,
  handles: [] as FileHandle[],
  closeFailure: undefined as Error | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (String(args[0]) !== fault.path) return handle;
      fault.handles.push(handle);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        if (fault.closeFailure !== undefined) throw fault.closeFailure;
        await close();
      };
      const read = handle.read.bind(handle);
      handle.read = (async (...args: unknown[]) => {
        const [buffer, offset, length, position] = args;
        if (
          typeof length !== "number" ||
          (typeof position !== "number" && typeof position !== "bigint")
        )
          throw new Error("Expected a positional descriptor read");
        fault.reads += 1;
        fault.beforeRead?.(Number(position), length);
        const result = await Reflect.apply(read, handle, [
          buffer,
          offset,
          Math.max(
            0,
            Math.min(length, fault.maximum, fault.eof - Number(position)),
          ),
          position,
        ]);
        fault.onRead?.();
        return result;
      }) as FileHandle["read"];
      return handle;
    },
  };
});

import { traceDylibResolution } from "../../src/artifacts/apple/DylibResolutionReader.js";
import { DylibFileAccess } from "../../src/artifacts/apple/DylibFileAccess.js";
import {
  machoImage,
  dylibCommand,
  LC,
  CPU,
  fatImage,
} from "../../src/artifacts/apple/MachoImage.fixture.js";
import { ArtifactResourceScope } from "../../src/artifacts/ArtifactResourceScope.js";
import { readElectronFuseImage } from "../../src/electron/ElectronFuseReader.js";
import { ElectronFuseProvider } from "../../src/electron/ElectronFuseProvider.js";
import { RegularFileChangedError } from "../../src/filesystem/RegularFile.js";
import { AnalysisCancelledError } from "../../src/domain/analysisErrorCore.js";
import {
  thinFuseImage,
  OBSIDIAN_FUSE_BYTES,
} from "../fixtures/electron/fuseImage.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { NativeMacOSProvider } from "../../src/native/NativeMacOSProvider.js";
import {
  NativeFixtureRunner,
  nativeMachoTarget,
} from "../fixtures/nativeCommands.js";
import { inspectPlistSchema } from "../../src/domain/native/nativeInspection.js";
import { plistSourceFormat } from "../../src/native/NativePlistSource.js";

const plistXml =
  "<plist><dict><key>Count</key><integer>9007199254740993</integer><key>Data</key><data>AAE=</data></dict></plist>";
const nativePlistFixture = async (
  bytes: Buffer,
  description = "ASCII text",
) => {
  const root = await createTestTempDirectory("rea-plist-short-reads-");
  const path = join(root, "selected.plist");
  await writeFile(path, bytes);
  const commands: string[][] = [];
  const runner = new NativeFixtureRunner({
    file: description,
    plutil: "valid",
  });
  const client = new NativeMacOSProvider(
    {},
    {
      run: async (tool, args, options) => {
        commands.push([tool, ...args]);
        if (tool === "plutil" && args[0] !== "-lint")
          throw new Error("Unexpected conversion of directly readable XML");
        return runner.run(tool, args, options);
      },
    },
    "darwin",
  ).createClient(nativeMachoTarget(join(root, "target")));
  return { path, commands, client };
};

it.each([
  ["UTF8", Buffer.from(plistXml)],
  ["UTF16LE", Buffer.from("\ufeff" + plistXml, "utf16le")],
  ["UTF16BE", Buffer.from("\ufeff" + plistXml, "utf16le").swap16()],
] as const)(
  "preserves %s plist source facts through short reads without conversion",
  async (_name, bytes) => {
    const { path, commands, client } = await nativePlistFixture(bytes);
    fault.path = path;
    fault.maximum = 1;
    try {
      const result = await client.execute("inspect_plist", { path });
      if (!result.ok) throw result.error;
      expect(inspectPlistSchema.parse(result.value.result)).toMatchObject({
        format: "xml",
        source_path: path,
        value: {
          Count: { $plist_type: "integer", decimal: "9007199254740993" },
          Data: { $plist_type: "data", base64: "AAE=" },
        },
      });
      expect(commands).toEqual([
        ["file", "-b", path],
        ["plutil", "-lint", "--", path],
      ]);
      expect(fault.reads).toBeGreaterThan(bytes.length);
      expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
    } finally {
      await client.close();
    }
  },
);

it("treats true EOF in an incomplete plist markup probe as unknown", async () => {
  const { path, client } = await nativePlistFixture(Buffer.from("<"));
  const resources = new ArtifactResourceScope();
  fault.path = path;
  fault.maximum = 1;
  try {
    expect(
      await plistSourceFormat("ASCII text", {
        selection: { path, origin: "selected" },
        resources,
        signal: undefined,
      }),
    ).toEqual({ ok: true, value: "unknown" });
    expect(fault.reads).toBe(2);
    expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
  } finally {
    await resources.close();
    await client.close();
  }
});

it("preserves a native plist probe read denial over a simultaneous abort", async () => {
  const { path, client } = await nativePlistFixture(Buffer.from(plistXml));
  const controller = new AbortController();
  const physical = Object.assign(new Error("controlled plist read denial"), {
    code: "EACCES",
  });
  fault.path = path;
  fault.maximum = 1;
  fault.beforeRead = () => {
    if (fault.reads !== 2) return;
    controller.abort("simultaneous abort");
    throw physical;
  };
  try {
    const result = await client.execute(
      "inspect_plist",
      { path },
      { signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected native plist read denial");
    expect(result.error).not.toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cause).toBe(physical);
    expect(fault.reads).toBe(2);
    expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
  } finally {
    await client.close();
  }
});

it.each([false, true])(
  "preserves plist probe cancellation and descriptor cleanup (closeFails=%s)",
  async (closeFails) => {
    const { path, client } = await nativePlistFixture(Buffer.from(plistXml));
    const controller = new AbortController();
    const reason = { requested: "continued plist probe" };
    fault.path = path;
    fault.maximum = 1;
    fault.onRead = () => {
      if (fault.reads !== 2) return;
      controller.abort(reason);
      if (closeFails)
        fault.closeFailure = new Error("controlled plist close failure");
    };
    try {
      const result = await client.execute(
        "inspect_plist",
        { path },
        { signal: controller.signal },
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected plist probe cancellation");
      const primary = closeFails ? result.error.cleanupPrimary : result.error;
      expect(primary).toBeInstanceOf(AnalysisCancelledError);
      expect(primary?.cause).toBe(reason);
      expect(fault.reads).toBe(2);
      if (closeFails) {
        expect(result.error.cleanupIncomplete).toBe(true);
        expect(fault.handles.at(-1)?.fd).toBeGreaterThanOrEqual(0);
        fault.closeFailure = undefined;
        expect(await client.close()).toEqual({ ok: true, value: null });
        expect(result.error.cleanupIncomplete).toBe(false);
      }
      expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
    } finally {
      fault.closeFailure = undefined;
      await client.close();
    }
  },
);
import { parseBinaryTarget } from "../../src/application/BinaryTargetResolver.js";
import { elf, pe, dosMz } from "../../src/domain/binaryTarget.fixture.js";

const distantCommands = () => {
  const bytes = Buffer.alloc(32 + 4080 + 16);
  Buffer.from(machoImage({})).copy(bytes);
  bytes.writeUInt32LE(2, 16);
  bytes.writeUInt32LE(4096, 20);
  bytes.writeUInt32LE(0x7fffffff, 32);
  bytes.writeUInt32LE(4080, 36);
  bytes.writeUInt32LE(0x7fffffff, 4112);
  bytes.writeUInt32LE(16, 4116);
  return bytes;
};

it.each([
  ["ELF", () => elf(2, 1, 62)],
  ["DOS MZ", () => dosMz()],
  [
    "PE CodeView",
    () => pe(0x8664, 64, 2, false, { pdbPath: "short.pdb", age: 3 }),
  ],
  ["distant PE", () => pe(0x8664, 8192)],
  ["thin command windows", distantCommands],
  [
    "FAT slice command windows",
    () => fatImage([{ cpu: CPU.arm64, bytes: distantCommands() }]),
  ],
] as const)(
  "retains complete %s target admission under positive short reads",
  async (_label, fixture) => {
    const root = await createTestTempDirectory("rea-target-short-reads-");
    const path = join(root, "selected");
    await writeFile(path, fixture());
    const expected = await parseBinaryTarget(path, {
      cwd: root,
      hostArchitecture: "arm64",
    });
    expect(expected.ok).toBe(true);
    fault.path = path;
    fault.maximum = 3;
    expect(
      await parseBinaryTarget(path, { cwd: root, hostArchitecture: "arm64" }),
    ).toEqual(expected);
    expect(fault.reads).toBeGreaterThan(5);
    expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
  },
);

beforeEach(() => {
  fault.path = "";
  fault.maximum = Number.POSITIVE_INFINITY;
  fault.eof = Number.POSITIVE_INFINITY;
  fault.reads = 0;
  fault.onRead = undefined;
  fault.beforeRead = undefined;
  fault.handles = [];
  fault.closeFailure = undefined;
});
afterEach(async () => {
  fault.closeFailure = undefined;
  fault.onRead = undefined;
  fault.beforeRead = undefined;
  for (const handle of fault.handles)
    if (handle.fd !== -1) await handle.close();
});

it("keeps dyld root discovery, commands and digests when positive reads are short", async () => {
  const root = await createTestTempDirectory("rea-dyld-short-reads-");
  const path = join(root, "Main");
  const bytes = machoImage({
    commands: [dylibCommand(LC.LOAD_DYLIB, "@rpath/Absent.dylib")],
  });
  await writeFile(path, bytes);
  const trace = () =>
    traceDylibResolution({
      rootPath: root,
      targetPath: path,
      targetSha256: createHash("sha256").update(bytes).digest("hex"),
      enumerateRoots: true,
      parameters: {},
    });
  const expected = await trace();
  expect(expected.roots).toHaveLength(1);
  expect(expected.edges).toHaveLength(1);
  fault.path = path;
  fault.maximum = 2;
  expect(await trace()).toEqual(expected);
  expect(fault.reads).toBeGreaterThan(10);
  expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
});

it("keeps fuse sentinel offsets, states and complete-file digest across short reads", async () => {
  const root = await createTestTempDirectory("rea-fuse-short-reads-");
  const path = join(root, "Electron");
  const { bytes } = thinFuseImage(OBSIDIAN_FUSE_BYTES);
  await writeFile(path, bytes);
  const provider = new ElectronFuseProvider();
  try {
    const expected = await provider.inspect({ path });
    expect(expected.ok).toBe(true);
    fault.path = path;
    fault.maximum = 2;
    expect(await provider.inspect({ path })).toEqual(expected);
    const scanned = await readElectronFuseImage(path, { chunkBytes: 7 });
    expect(scanned.sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(scanned.slices[0]?.sentinels[0]?.sentinel_offset).toBe(32);
    expect(fault.reads).toBeGreaterThan(10);
    expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
  } finally {
    await provider.close();
  }
});

it("returns malformed dyld header facts when short positive data ends at true EOF", async () => {
  const root = await createTestTempDirectory("rea-dyld-read-eof-");
  const path = join(root, "Main");
  await writeFile(path, machoImage({}));
  fault.path = path;
  fault.maximum = 2;
  fault.eof = 6;
  const resources = new ArtifactResourceScope();
  try {
    const image = await new DylibFileAccess(resources, root).image(path);
    expect(image.facts).toMatchObject({ status: "malformed" });
    expect(fault.reads).toBeGreaterThan(1);
    expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
  } finally {
    await resources.close();
  }
});

it("rejects true EOF before the admitted Electron extent instead of publishing a digest", async () => {
  const root = await createTestTempDirectory("rea-fuse-read-eof-");
  const path = join(root, "Electron");
  await writeFile(path, thinFuseImage(OBSIDIAN_FUSE_BYTES).bytes);
  fault.path = path;
  fault.maximum = 2;
  fault.eof = 6;
  await expect(readElectronFuseImage(path)).rejects.toBeInstanceOf(
    RegularFileChangedError,
  );
  expect(fault.reads).toBeGreaterThan(1);
  expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
});

it("preserves cancellation during continued short reads and releases the descriptor", async () => {
  const root = await createTestTempDirectory("rea-fuse-short-read-cancel-");
  const path = join(root, "Electron");
  await writeFile(path, thinFuseImage(OBSIDIAN_FUSE_BYTES).bytes);
  const controller = new AbortController();
  fault.path = path;
  fault.maximum = 2;
  fault.onRead = () => {
    if (fault.reads === 2) controller.abort(new Error("cancel continued read"));
  };
  const provider = new ElectronFuseProvider();
  try {
    const result = await provider.inspect(
      { path },
      { signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(fault.reads).toBe(2);
    expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
  } finally {
    await provider.close();
  }
});

it.each(["cancelled", "eof", "io"] as const)(
  "preserves %s during short scan reads after container identification",
  async (outcome) => {
    const root = await createTestTempDirectory("rea-fuse-scan-short-read-");
    const path = join(root, "Electron");
    await writeFile(path, thinFuseImage(OBSIDIAN_FUSE_BYTES).bytes);
    const controller = new AbortController();
    const physicalFailure = Object.assign(new Error("scan read failed"), {
      code: "EIO",
    });
    let scanning = false;
    const scanPositions: number[] = [];
    fault.path = path;
    fault.beforeRead = (position, length) => {
      // Header reads use their format windows. A seven-byte read at zero
      // starts this invocation's explicitly selected scan window.
      if (position === 0 && length === 7) {
        scanning = true;
        fault.maximum = 2;
      }
      if (!scanning) return;
      scanPositions.push(position);
      if (position !== 4) return;
      if (outcome === "eof") fault.eof = 4;
      fault.onRead = () => controller.abort(new Error("cancel scan read"));
      if (outcome === "io") {
        controller.abort(new Error("cancel failed scan read"));
        throw physicalFailure;
      }
    };
    const failure: unknown = await readElectronFuseImage(path, {
      signal: controller.signal,
      chunkBytes: 7,
    }).catch((cause: unknown) => cause);
    expect(scanning).toBe(true);
    expect(scanPositions).toEqual([0, 2, 4]);
    if (outcome === "io") expect(failure).toBe(physicalFailure);
    else if (outcome === "eof")
      expect(failure).toBeInstanceOf(RegularFileChangedError);
    else expect(failure).toMatchObject({ reason: "cancelled" });
    expect(controller.signal.aborted).toBe(true);
    expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
  },
);
