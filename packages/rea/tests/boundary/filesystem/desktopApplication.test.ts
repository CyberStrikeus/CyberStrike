import {
  mkdir,
  writeFile,
  symlink,
  open,
  rename,
  realpath,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { expect, it, onTestFinished, vi } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { createDesktopApplicationService } from "../../../src/composition/desktop.js";
import {
  desktopApplicationSchema,
  type DesktopFact,
} from "../../../src/domain/desktopApplication.js";
import { createDesktopApplicationEvidence } from "../../../src/domain/desktopApplicationEvidence.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { inspectAnalysisView } from "../../../src/application/analysisView/AnalysisViewService.js";
import {
  buildManagedPeFixture,
  buildNativePeFixture,
} from "../../../src/dotnet/ManagedPe.fixture.js";
import { readManagedMetadataLayout } from "../../../src/dotnet/ManagedMetadataLayout.js";
import { readManagedPeLayout } from "../../../src/dotnet/ManagedPeReader.js";
import { readAssemblyReference } from "../../../src/dotnet/ManagedMetadataInventoryRows.js";
import {
  CPU,
  FILE_TYPE,
  fatImage,
  machoImage,
} from "../../../src/artifacts/apple/MachoImage.fixture.js";
import { locateGodotPck } from "../../../src/artifacts/GodotPckLocation.js";
import { DirectoryArtifactReader } from "../../../src/artifacts/DirectoryArtifactReader.js";
import { ArtifactReaderFailure } from "../../../src/artifacts/ArtifactReader.js";
import { artifactFilePrimaryFacts } from "../../../src/artifacts/ArtifactFileOperation.js";
import { DesktopApplicationReader } from "../../../src/artifacts/DesktopApplicationReader.js";
import { inspectDesktopFile } from "../../../src/artifacts/DesktopFileInspection.js";
import { DesktopApplicationService } from "../../../src/application/artifacts/DesktopApplicationService.js";

const inspect = async (path: string, extra: Record<string, number> = {}) => {
  const service = createDesktopApplicationService();
  try {
    const result = await service.inspect({ path, ...extra });
    if (!result.ok) throw result.error;
    return {
      evidence: parseEvidence(result.value),
      report: desktopApplicationSchema.parse(result.value.normalized_result),
    };
  } finally {
    await service.close();
  }
};
const put = async (root: string, path: string, bytes: Buffer | string) => {
  const destination = join(root, path);
  await mkdir(join(destination, ".."), { recursive: true });
  await writeFile(destination, bytes);
};

it.each(["NE", "LE", "LX", "PE\0\0"])(
  "admits the MZ signature before interpreting a trailing %j header as PE",
  async (signature) => {
    const root = await createTestTempDirectory("rea-desktop-mz-signature-");
    const bytes = Buffer.alloc(64 + signature.length);
    bytes.write("MZ");
    bytes.writeUInt16LE(4, 8);
    bytes.writeUInt32LE(64, 60);
    bytes.write(signature, 64, "latin1");
    await put(root, "legacy.exe", bytes);

    const { report } = await inspect(root);
    const file = report.files.find((row) => row.path === "legacy.exe");
    expect(file?.facts).toEqual([]);
    expect(file?.issues).toEqual(
      signature.startsWith("PE") ? ["PE COFF header is truncated"] : [],
    );
    expect(file?.ranges).toContainEqual({
      offset: 64,
      bytes: signature.length,
      sha256: expect.any(String),
    });
  },
);

it.each(["oversized-header", "prefix-only-section"] as const)(
  "keeps desktop CLR prefix admission distinct from full managed admission: %s",
  async (mode) => {
    const original = buildManagedPeFixture({
      references: ["UnityEngine.CoreModule"],
    });
    expect(readManagedPeLayout(original).cli).not.toBeNull();
    let image = Buffer.from(original);
    if (mode === "oversized-header") {
      // The directory declares 72 bytes; desktop needs only cb >= 72.
      image.writeUInt32LE(73, 0x200);
    } else {
      // Metadata remains in .text; a second section backs only the CLI prefix.
      image = Buffer.concat([original, original.subarray(0x200, 0x210)]);
      const coff = image.readUInt32LE(0x3c) + 4;
      const optional = coff + 20;
      const secondSection = optional + image.readUInt16LE(coff + 16) + 40;
      image.writeUInt16LE(2, coff + 2);
      image.writeUInt32LE(0x900000, optional + 96 + 14 * 8);
      image.write(".cli", secondSection, "ascii");
      image.writeUInt32LE(16, secondSection + 8);
      image.writeUInt32LE(0x900000, secondSection + 12);
      image.writeUInt32LE(16, secondSection + 16);
      image.writeUInt32LE(original.length, secondSection + 20);
    }
    expect(readManagedPeLayout(image)).toMatchObject({
      cli: null,
      cliIssue: {
        code:
          mode === "oversized-header"
            ? "invalid-cli-header"
            : "invalid-directory",
        scope: "cli.header",
      },
    });
    const root = await createTestTempDirectory("rea-desktop-clr-prefix-");
    const path = "Game_Data/Managed/Assembly-CSharp.dll";
    await put(root, path, image);
    const { report } = await inspect(root);
    const file = report.files.find((row) => row.path === path);
    expect(file?.issues).toEqual([]);
    expect(file?.facts).toContainEqual({
      kind: "unity-assembly-reference",
      offset: expect.any(Number),
      value: {
        name: "UnityEngine.CoreModule",
        token: expect.any(String),
        managed_directory: "Game_Data/Managed",
      },
    });
  },
);

it.skipIf(process.platform !== "linux")(
  "keeps desktop sibling files with partial coverage for invalid UTF-8 names",
  async () => {
    const root = await createTestTempDirectory("rea-desktop-filename-bytes-");
    const rawName = Buffer.from([
      0x62, 0x61, 0x64, 0xff, 0x2e, 0x74, 0x78, 0x74,
    ]);
    const rawPath = Buffer.concat([Buffer.from(`${root}/`), rawName]);
    await Promise.all([
      writeFile(rawPath, "RAW_FILE"),
      writeFile(join(root, "bad\ufffd.txt"), "UNICODE_FILE"),
      writeFile(join(root, "good.txt"), "GOOD_FILE"),
    ]);

    const { report } = await inspect(root);
    expect(report.coverage).toMatchObject({
      status: "partial",
      entries_examined: 3,
    });
    expect(
      report.files.filter(({ path }) => path === "bad\ufffd.txt"),
    ).toHaveLength(1);
    expect(report.files.map(({ path }) => path)).toContain("good.txt");
    expect(report.limitations.join(" ")).toContain(
      `First raw basename bytes: ${rawName.toString("hex")}`,
    );
  },
);

it("joins real PE/CLI reference facts and independent engine markers without picking a winner", async () => {
  const root = await createTestTempDirectory("rea-desktop-mixed-");
  await put(
    root,
    "Game_Data/Managed/Assembly-CSharp.dll",
    buildManagedPeFixture({ references: ["UnityEngine.CoreModule"] }),
  );
  await put(root, "GameAssembly.dll", buildNativePeFixture());
  const metadata = Buffer.alloc(8);
  metadata.writeUInt32LE(0xfab11baf);
  metadata.writeUInt32LE(31, 4);
  await put(
    root,
    "Game_Data/il2cpp_data/Metadata/global-metadata.dat",
    metadata,
  );
  const godot = Buffer.alloc(20);
  godot.write("GDPC");
  godot.writeUInt32LE(3, 4);
  godot.writeUInt32LE(4, 8);
  await put(root, "game.pck", godot);
  const form = Buffer.alloc(16);
  form.write("FORM");
  form.writeUInt32LE(8, 4);
  form.write("GEN8", 8);
  await put(root, "data.win", form);
  await put(
    root,
    "resources/app.asar",
    "not an archive; this is only a path convention",
  );
  await put(root, "Content/Paks/game.pak", "path convention only");
  await mkdir(join(root, "BepInEx"));
  await mkdir(join(root, "EasyAntiCheat"));
  const { report, evidence } = await inspect(root);
  expect(report.candidates.map((row) => row.family).sort()).toEqual(
    [
      "dotnet",
      "electron",
      "gamemaker",
      "godot",
      "unity-il2cpp",
      "unity-mono",
      "unreal",
    ].sort(),
  );
  expect(
    report.components.map((row) => [row.name, row.runtime_presence]),
  ).toEqual([
    ["BepInEx", "unknown"],
    ["Easy Anti-Cheat", "unknown"],
  ]);
  expect(report.coverage.status).toBe("complete-within-scan");
  const files = new Map(report.files.map((file) => [file.file_id, file]));
  for (const row of report.candidates)
    for (const id of row.basis_file_ids) expect(files.has(id)).toBe(true);
  for (const probe of report.next_probes)
    expect(probe.path).toBe(
      join(await realpath(root), files.get(probe.file_id)!.path),
    );
  const summary = await inspectAnalysisView({
    source: { kind: "inline", evidence },
    view: { kind: "summary" },
  });
  if (!summary.ok) throw summary.error;
  expect(JSON.stringify(summary.value)).not.toContain('"files":[');
  const selected = await inspectAnalysisView({
    source: { kind: "inline", evidence },
    view: {
      kind: "desktop-application",
      collection: "files",
      paths: ["Game_Data/Managed/Assembly-CSharp.dll"],
      fields: ["path", "facts"],
      limit: 1,
    },
  });
  if (!selected.ok) throw selected.error;
  expect(selected.value.evidence_links).toEqual([evidence.evidence_id]);
  expect(selected.value.normalized_result).toMatchObject({
    items: [
      {
        file_id: expect.any(String),
        path: "Game_Data/Managed/Assembly-CSharp.dll",
        facts: expect.arrayContaining([
          {
            kind: "unity-assembly-reference",
            offset: expect.any(Number),
            value: {
              name: "UnityEngine.CoreModule",
              token: expect.any(String),
              managed_directory: "Game_Data/Managed",
            },
          },
        ]),
      },
    ],
    coverage: { total: 1, exhausted: true },
  });
});

it("reads sparse embedded PCK ranges without hashing or retaining a large executable", async () => {
  const root = await createTestTempDirectory("rea-desktop-sparse-");
  const path = join(root, "game.exe");
  const file = await open(path, "w");
  const header = buildNativePeFixture();
  const size = 1024 * 1024 * 1024;
  const pck = Buffer.alloc(20);
  pck.write("GDPC");
  pck.writeUInt32LE(3, 4);
  pck.writeUInt32LE(4, 8);
  pck.writeUInt32LE(0x80000001, 12);
  pck.writeUInt32LE(0xffffffff, 16);
  const trailer = Buffer.alloc(12);
  trailer.writeBigUInt64LE(BigInt(pck.length));
  trailer.write("GDPC", 8);
  await file.write(header, 0, header.length, 0);
  await file.write(pck, 0, pck.length, size - 32);
  await file.write(trailer, 0, 12, size - 12);
  await file.close();
  const { report } = await inspect(root);
  expect(report.candidates.map((row) => row.family)).toContain("godot");
  expect(report.coverage.bytes_read).toBeLessThan(4096);
  expect(report.files[0]?.bytes).toBe(size);
  expect(report.files[0]?.facts).toContainEqual({
    kind: "godot-pck-header",
    offset: size - 32,
    value: {
      pack_version: 3,
      engine_version: [4, 0x80000001, 0xffffffff],
      placement: "embedded-trailer",
    },
  });
});

it.each([4, 19, 20])(
  "keeps PCK location separate from desktop header admission for %i-byte packs",
  async (packBytes) => {
    const root = await createTestTempDirectory("rea-desktop-pck-minimum-");
    const path = join(root, "game.exe");
    const carrier = Buffer.alloc(64);
    carrier.set([0x7f, 0x45, 0x4c, 0x46]);
    const pack = Buffer.alloc(packBytes);
    pack.write("GDPC");
    const trailer = Buffer.alloc(12);
    trailer.writeBigUInt64LE(BigInt(packBytes));
    trailer.write("GDPC", 8);
    const bytes = Buffer.concat([carrier, pack, trailer]);
    await writeFile(path, bytes);
    const handle = await open(path, "r");
    try {
      expect(await locateGodotPck(handle, bytes.length)).toEqual({
        start: carrier.length,
        end: carrier.length + packBytes,
        embedded: true,
      });
    } finally {
      await handle.close();
    }
    const { report } = await inspect(root);
    const file = report.files.find((row) => row.path === "game.exe");
    expect(file).toBeDefined();
    if (packBytes < 20) {
      expect(file?.issues).toContain(
        "Embedded PCK trailer declares an invalid pack extent",
      );
      expect(file?.facts.some((fact) => fact.kind === "godot-pck-header")).toBe(
        false,
      );
    } else {
      expect(file?.issues).toEqual([]);
      expect(file?.facts).toContainEqual({
        kind: "godot-pck-header",
        offset: carrier.length,
        value: {
          pack_version: 0,
          engine_version: [0, 0, 0],
          placement: "embedded-trailer",
        },
      });
    }
  },
);

it("does not promote filenames, arbitrary pak files or symlink targets into byte facts", async () => {
  const root = await createTestTempDirectory("rea-desktop-unknown-");
  await put(root, "GameAssembly.dll", "x");
  await put(root, "global-metadata.dat", "");
  await put(root, "game.pck", "GDPC");
  await put(root, "resources.pak", "not Unreal");
  await symlink("/outside/nonexistent", join(root, "foreign"));
  const { report } = await inspect(root);
  expect(report.candidates).toEqual([]);
  expect(report.coverage.symlinks_not_followed).toBe(1);
  expect(
    report.files.find((file) => file.path === "foreign")?.read_status,
  ).toBe("not-selected");
});

it("retains bounded coverage and stable pages without claiming absence after a traversal limit", async () => {
  const root = await createTestTempDirectory("rea-desktop-limit-");
  for (let i = 0; i < 4; i++) await put(root, `${i}.txt`, "ordinary data");
  const { report, evidence } = await inspect(root, { max_entries: 2 });
  expect(report.coverage).toMatchObject({
    status: "partial",
    entries_examined: 2,
  });
  expect(report.files).toHaveLength(2);
  const result = await inspectAnalysisView({
    source: { kind: "inline", evidence },
    view: {
      kind: "desktop-application",
      collection: "files",
      paths: [],
      fields: ["path"],
      limit: 1,
    },
  });
  if (!result.ok) throw result.error;
  expect(result.value.normalized_result).toMatchObject({
    items: [],
    source_coverage: { status: "partial" },
    coverage: { total: 0, exhausted: true },
    unknowns: expect.arrayContaining([expect.stringContaining("partial")]),
  });
});

it("preserves caller cancellation and refuses a replaced selected entry", async () => {
  const root = await createTestTempDirectory("rea-desktop-identity-");
  await put(root, "entry", "original");
  const reader = new DirectoryArtifactReader(root);
  const values = [];
  for await (const row of reader.entries()) values.push(row);
  const entry = values[0]!;
  await expect(
    reader.inspectFile(entry, async () => {
      await rename(join(root, "entry"), join(root, "old"));
      await put(root, "entry", "replacement");
      return "untrusted";
    }),
  ).rejects.toMatchObject({ reason: "integrity" });
  await reader.close();
  const service = createDesktopApplicationService();
  const reason = new Error("caller cancellation");
  const result = await service.inspect(
    { path: root },
    { signal: AbortSignal.abort(reason) },
  );
  expect(result.ok).toBe(false);
  if (!result.ok)
    expect(result.error).toMatchObject({
      _tag: "AnalysisCancelledError",
      cause: reason,
    });
  await service.close();
});

it("retains an entry whose close failed and observes cancellation after final close", async () => {
  const root = await createTestTempDirectory("rea-desktop-close-");
  await put(root, "entry", "bytes");
  const reader = new DirectoryArtifactReader(root);
  const entries = [];
  for await (const entry of reader.entries()) entries.push(entry);
  let restore: (() => void) | undefined;
  await expect(
    reader.inspectFile(entries[0]!, async (file) => {
      const close = file.close.bind(file);
      file.close = () => Promise.reject(new Error("close denied"));
      restore = () => {
        file.close = close;
      };
      return "observed";
    }),
  ).rejects.toBeInstanceOf(ArtifactReaderFailure);
  await expect(reader.close()).rejects.toMatchObject({
    cleanup: expect.any(Object),
  });
  restore?.();
  await reader.close();
  const cancelled = new DirectoryArtifactReader(root);
  const controller = new AbortController();
  const reason = new Error("late cancellation");
  await expect(
    cancelled.inspectFile(
      entries[0]!,
      async (file) => {
        const close = file.close.bind(file);
        file.close = async () => {
          await close();
          controller.abort(reason);
        };
        return "completed bytes";
      },
      controller.signal,
    ),
  ).rejects.toMatchObject({ reason: "cancelled", cause: reason });
  await cancelled.close();
});

it.each(["Game_Data/Managed", "Contents/Resources/Data/Managed"])(
  "requires a Unity reference in %s and reports a metadata budget refusal as partial",
  async (managedDirectory) => {
    const root = await createTestTempDirectory("rea-desktop-mono-boundary-");
    await put(
      root,
      `${managedDirectory}/ordinary.dll`,
      buildManagedPeFixture({ references: ["System.Runtime"] }),
    );
    const ordinary = await inspect(root);
    expect(ordinary.report.candidates.map((row) => row.family)).toEqual([
      "dotnet",
    ]);
    await put(
      root,
      `${managedDirectory}/unity.dll`,
      buildManagedPeFixture({
        references: ["UnityEngine.CoreModule", "System.Runtime"],
        additionalEmptyTypes: 5000,
      }),
    );
    const bounded = await inspect(root, { max_probe_bytes: 4096 });
    expect(bounded.report.coverage.status).toBe("partial");
    expect(bounded.report.coverage.bytes_read).toBeLessThanOrEqual(4096);
    expect(bounded.report.candidates.map((row) => row.family)).not.toContain(
      "unity-mono",
    );
    expect(
      bounded.report.files.some((file) =>
        file.issues.some((issue) => issue.includes("budget")),
      ),
    ).toBe(true);
  },
);

it("retains complete observations through cancellation during directory finalization", async () => {
  const root = await createTestTempDirectory("rea-desktop-finalize-cancel-");
  await put(root, "notes.txt", "target content");
  const controller = new AbortController();
  const reason = new Error("cancel during final close");
  const service = new DesktopApplicationService(
    new DesktopApplicationReader((path) => {
      const reader = new DirectoryArtifactReader(path);
      const close = reader.close.bind(reader);
      reader.close = async () => {
        await close();
        controller.abort(reason);
      };
      return reader;
    }),
  );
  const result = await service.inspect(
    { path: root },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected cancellation");
  expect(result.error).toMatchObject({ reason: "cancelled", cause: reason });
  const retained = parseEvidence(result.error.partialObservation);
  expect(
    desktopApplicationSchema.parse(retained.normalized_result).files,
  ).toHaveLength(1);
  await service.close();
});

it("keeps a completed directory report and exact cleanup authority until retry confirms release", async () => {
  const root = await createTestTempDirectory("rea-desktop-finalize-retry-");
  await put(root, "notes.txt", "target content");
  let denied = true;
  const service = new DesktopApplicationService(
    new DesktopApplicationReader((path) => {
      const reader = new DirectoryArtifactReader(path);
      const close = reader.close.bind(reader);
      reader.close = async () => {
        if (denied) throw new Error("owned close denied");
        await close();
      };
      return reader;
    }),
  );
  const result = await service.inspect({ path: root });
  if (result.ok) throw new Error("Expected incomplete cleanup");
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(
    desktopApplicationSchema.parse(
      parseEvidence(result.error.partialObservation).normalized_result,
    ).files,
  ).toHaveLength(1);
  await expect(service.close()).rejects.toBeInstanceOf(ArtifactReaderFailure);
  expect(result.error.cleanupIncomplete).toBe(true);
  denied = false;
  await service.close();
  expect(result.error.cleanupIncomplete).toBe(false);
});

it("bounds simultaneous directory scans without cancelling the admitted caller", async () => {
  const root = await createTestTempDirectory("rea-desktop-capacity-");
  await put(root, "notes.txt", "observed");
  let release!: () => void;
  let entered!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const service = new DesktopApplicationService(
    new DesktopApplicationReader((path) => {
      const reader = new DirectoryArtifactReader(path);
      const entries = reader.entries.bind(reader);
      reader.entries = async function* (...args: Parameters<typeof entries>) {
        entered();
        await barrier;
        yield* entries(...args);
      };
      return reader;
    }),
  );
  const first = service.inspect({ path: root });
  try {
    await started;
    const second = await service.inspect({ path: root });
    expect(second.ok).toBe(false);
    if (!second.ok)
      expect(second.error).toMatchObject({
        _tag: "AnalysisResourceConstraintError",
        resource: "capacity",
        retryable: true,
      });
  } finally {
    release();
  }
  const result = await first;
  if (!result.ok) throw result.error;
  expect(
    desktopApplicationSchema.parse(result.value.normalized_result).files,
  ).toHaveLength(1);
  await service.close();
});

it("keeps directory-only marker identities separate across installation roots", async () => {
  const root = await createTestTempDirectory("rea-desktop-namespaces-");
  const left = join(root, "left");
  const right = join(root, "right");
  await mkdir(join(left, "BepInEx"), { recursive: true });
  await mkdir(join(right, "BepInEx"), { recursive: true });
  const a = await inspect(left);
  const b = await inspect(right);
  expect(a.report.files[0]?.path).toBe(b.report.files[0]?.path);
  expect(a.report.files[0]?.identity).toBeNull();
  expect(a.report.files[0]?.file_id).not.toBe(b.report.files[0]?.file_id);
  expect(a.report.components[0]?.component_id).not.toBe(
    b.report.components[0]?.component_id,
  );
  expect(a.report.root.snapshot_sha256).not.toBe(b.report.root.snapshot_sha256);
});

it.skipIf(process.platform === "win32").each(["path", "kind"] as const)(
  "commits omitted special-entry %s changes and exposes selected omission facts",
  async (change) => {
    const root = await createTestTempDirectory("rea-desktop-omissions-");
    const original = join(root, "special");
    execFileSync("mkfifo", [original], { timeout: 10_000 });
    const before = await inspect(root);
    let selected = "special";
    if (change === "path") {
      selected = "renamed";
      await rename(original, join(root, selected));
    } else {
      await unlink(original);
      const server = createNetServer();
      onTestFinished(async () => {
        if (!server.listening) return;
        await new Promise<void>((resolve, reject) =>
          server.close((cause) => (cause ? reject(cause) : resolve())),
        );
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(original, resolve);
      });
    }
    const after = await inspect(root);
    expect(after.report.root.snapshot_sha256).not.toBe(
      before.report.root.snapshot_sha256,
    );
    expect(before.report.omissions).toEqual([
      {
        omission_id: expect.stringMatching(/^dso_[a-f0-9]{64}$/u),
        path: "special",
        kind: "fifo",
      },
    ]);
    expect(after.report.omissions[0]?.omission_id).not.toBe(
      before.report.omissions[0]?.omission_id,
    );
    expect(after.report.coverage).toMatchObject({
      status: "partial",
      entries_examined: 1,
      special_entries_omitted: 1,
      files_probed: 0,
      bytes_read: 0,
    });
    const page = await inspectAnalysisView({
      source: { kind: "inline", evidence: after.evidence },
      view: {
        kind: "desktop-application",
        collection: "omissions",
        paths: [selected],
        fields: ["kind"],
        offset: 0,
        limit: 1,
      },
    });
    if (!page.ok) throw page.error;
    expect(page.value.evidence_links).toEqual([after.evidence.evidence_id]);
    expect(page.value.normalized_result).toHaveProperty("items", [
      {
        omission_id: after.report.omissions[0]?.omission_id,
        kind: change === "path" ? "fifo" : "socket",
      },
    ]);
    expect(page.value.normalized_result).toMatchObject({
      coverage: { total: 1, exhausted: true },
      source_coverage: { status: "partial" },
    });
  },
);

it("bounds omitted-entry retention before allocating rows or serializing identities", async () => {
  const root = await createTestTempDirectory("rea-desktop-omission-capacity-");
  let examined = 0;
  // Simulate bounded parsed paths without creating hundreds of deep FIFO trees.
  const prefix = Array.from({ length: 15 }, () => "d".repeat(255)).join("/");
  const service = new DesktopApplicationService(
    new DesktopApplicationReader((path) => {
      const reader = new DirectoryArtifactReader(path);
      reader.entries = async function* (_signal, options) {
        if (typeof options === "function")
          throw new Error("Expected traversal options");
        for (let index = 0; index < 5000; index++) {
          examined++;
          options?.onOmission?.({
            path: `${prefix}/${index}/entry`,
            kind: "fifo",
          });
        }
      };
      return reader;
    }),
  );
  onTestFinished(() => service.close());
  const result = await service.inspect({ path: root });
  if (!result.ok) throw result.error;
  const report = desktopApplicationSchema.parse(result.value.normalized_result);
  expect(examined).toBeLessThan(5000);
  expect(report.omissions).toHaveLength(examined - 1);
  expect(report.coverage).toMatchObject({
    status: "partial",
    entries_examined: examined,
    special_entries_omitted: examined,
  });
  expect(report.limitations).toContainEqual(
    expect.stringContaining("representation budget"),
  );
});

/** Inspect simulated directory rows without creating their filesystem tree. */
const inspectSimulatedRows = async (
  count: number,
  path: (index: number) => string,
  kind: "file" | "directory" = "directory",
) => {
  const root = await createTestTempDirectory("rea-desktop-row-capacity-");
  let yielded = 0;
  const service = new DesktopApplicationService(
    new DesktopApplicationReader((selected) => {
      const reader = new DirectoryArtifactReader(selected);
      reader.entries = async function* () {
        for (let index = 0; index < count; index++) {
          yielded++;
          yield {
            path: path(index),
            kind,
            declaredSize: kind === "file" ? 1 : null,
            compressedSize: null,
            executable: false,
            encrypted: false,
            byteOffset: null,
            declaredIntegrity: null,
            unpacked: false,
            limitations: [],
            adapterKey: `${root}/${path(index)}`,
          };
        }
      };
      return reader;
    }),
  );
  onTestFinished(() => service.close());
  const result = await service.inspect({ path: root, max_entries: count });
  if (!result.ok) throw result.error;
  return {
    yielded,
    report: desktopApplicationSchema.parse(result.value.normalized_result),
  };
};

it("admits bundle-sized rows up to max_entries within the representation budget", async () => {
  // Localized resources dominate large macOS bundles such as iWork apps.
  const { report } = await inspectSimulatedRows(
    20_000,
    (index) =>
      `Contents/Resources/${String(index % 40).padStart(2, "0")}.lproj/Localizable${index}.strings`,
  );
  expect(report.files).toHaveLength(20_000);
  expect(report.coverage).toMatchObject({
    status: "complete-within-scan",
    entries_examined: 20_000,
  });
  expect(report.limitations).not.toContainEqual(
    expect.stringContaining("representation budget"),
  );
});

it("charges escaped JSON expansion before retaining control-character paths", async () => {
  const { yielded, report } = await inspectSimulatedRows(
    6000,
    (index) => `${"\u0001".repeat(1000)}/${index}`,
  );
  expect(report.files.length).toBeLessThan(6000);
  expect(report.files).toHaveLength(yielded - 1);
  expect(report.coverage).toMatchObject({
    status: "partial",
    entries_examined: yielded,
  });
  expect(report.limitations).toContainEqual(
    expect.stringContaining("representation budget"),
  );
  // Escaping makes each path six times longer in JSON than in memory.
  expect(Buffer.byteLength(JSON.stringify(report.files))).toBeLessThan(
    32 * 1024 * 1024,
  );
});

it.each([
  ["Unreal pack", "Content/Paks/pakchunk0.pak", 0],
  ["Electron archive", "resources/app.asar", 2],
])(
  "charges %s convention facts and probes that repeat control-character paths",
  async (_name, suffix, probes) => {
    const { yielded, report } = await inspectSimulatedRows(
      3000,
      (index) => `${"\u0001".repeat(1000)}/${index}/${suffix}`,
      "file",
    );
    expect(report.files.length).toBeLessThan(3000);
    expect(report.files).toHaveLength(yielded - 1);
    // The fact value and each next probe repeat the escaped path.
    expect(report.files[0]?.facts).toHaveLength(1);
    expect(report.next_probes).toHaveLength(probes * report.files.length);
    expect(report.coverage.status).toBe("partial");
    expect(report.limitations).toContainEqual(
      expect.stringContaining("representation budget"),
    );
    expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThan(
      32 * 1024 * 1024,
    );
  },
);

it("charges the next probes a header fact offers before retaining the fact", async () => {
  const root = await createTestTempDirectory("rea-desktop-fact-probes-");
  const bytes = buildManagedPeFixture();
  await put(root, "Managed.dll", bytes);
  // Each managed fact offers a probe that repeats this escaped local path.
  const localPath = "\u0001".repeat(100_000);
  const inspectWithin = async (maximumRetainedBytes: number) => {
    const row = {
      file_id: `dsf_${"a".repeat(64)}`,
      path: "Managed.dll",
      local_path: localPath,
      kind: "file" as const,
      bytes: bytes.length,
      identity: null,
      read_status: "not-selected" as const,
      ranges: [],
      facts: [] as DesktopFact[],
      issues: [] as string[],
    };
    const file = await open(join(root, "Managed.dll"), "r");
    try {
      await inspectDesktopFile(file, row, {
        bytes: 0,
        maximum: 1024 * 1024,
        retainedBytes: 0,
        maximumRetainedBytes,
      });
    } finally {
      await file.close();
    }
    return row;
  };
  const refused = await inspectWithin(1024 * 1024);
  expect(refused.facts).toEqual([]);
  expect(refused.issues).toEqual([
    "Directory facts reached the retained metadata budget",
  ]);
  const admitted = await inspectWithin(32 * 1024 * 1024);
  expect(admitted.facts.map((fact) => fact.kind)).toEqual([
    "native-image-header",
    "pe-cli-directory",
  ]);
  expect(admitted.issues).toEqual([]);
});

it("preserves the selected root alias and directs follow-ups to the admitted physical root", async () => {
  const root = await createTestTempDirectory("rea-desktop-root-alias-");
  const admitted = join(root, "admitted");
  const replacement = join(root, "replacement");
  const alias = join(root, "selected");
  await put(admitted, "resources/app.asar", "observed marker");
  await mkdir(replacement);
  await symlink(
    admitted,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  const service = new DesktopApplicationService(
    new DesktopApplicationReader((path) => {
      const reader = new DirectoryArtifactReader(path);
      const entries = reader.entries.bind(reader);
      reader.entries = async function* (...args: Parameters<typeof entries>) {
        await unlink(alias);
        await symlink(
          replacement,
          alias,
          process.platform === "win32" ? "junction" : "dir",
        );
        yield* entries(...args);
      };
      return reader;
    }),
  );
  try {
    const result = await service.inspect({ path: alias });
    if (!result.ok) throw result.error;
    const report = desktopApplicationSchema.parse(
      result.value.normalized_result,
    );
    expect(report.root.path).toBe(alias);
    expect(report.root.canonical_path).toBe(await realpath(admitted));
    expect(report.candidates.map((candidate) => candidate.family)).toEqual([
      "electron",
    ]);
    expect(report.next_probes[0]?.path).toBe(
      join(await realpath(admitted), "resources", "app.asar"),
    );
  } finally {
    await service.close();
  }
});

it.each(
  ["physical read", "format"].flatMap((variant) =>
    ["unavailable", "mismatch"].map((validationState) => ({
      variant,
      validationState,
    })),
  ),
)(
  "keeps $variant failure through $validationState final validation while discarding unverified desktop byte facts",
  async ({ variant, validationState }) => {
    const root = await createTestTempDirectory(
      "rea-desktop-failed-validation-",
    );
    const header = Buffer.alloc(20);
    header.write("GDPC");
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(4, 8);
    await put(root, "game.pck", header);
    const primary =
      variant === "physical read"
        ? Object.assign(new Error("physical read denied"), { code: "EACCES" })
        : new ArtifactReaderFailure(
            "format",
            "invalid later format declaration",
          );
    const validation = Object.assign(
      new Error("final descriptor stat failed"),
      { code: "EIO" },
    );
    let observed: unknown;
    const service = new DesktopApplicationService(
      new DesktopApplicationReader((path) => {
        const reader = new DirectoryArtifactReader(path);
        const inspectFile = reader.inspectFile.bind(reader);
        reader.inspectFile = (entry, inspect, signal) =>
          inspectFile(
            entry,
            async (file) => {
              await inspect(file);
              if (validationState === "unavailable")
                vi.spyOn(file, "stat").mockRejectedValueOnce(validation);
              else {
                const changed = await file.stat({ bigint: true });
                changed.ino += 1n;
                vi.spyOn(file, "stat").mockResolvedValueOnce(changed);
              }
              if (variant === "physical read") {
                vi.spyOn(file, "read").mockRejectedValueOnce(primary);
                await file.read(Buffer.alloc(4), 0, 4, 0);
              }
              throw primary;
            },
            signal,
          ).catch((cause: unknown) => {
            observed = cause;
            throw cause;
          });
        return reader;
      }),
    );
    try {
      const result = await service.inspect({ path: root });
      expect(observed).toMatchObject({
        reason: validationState === "unavailable" ? "io" : "integrity",
      });
      if (validationState === "unavailable")
        expect((observed as ArtifactReaderFailure).cause).toMatchObject({
          errors: [primary, validation],
        });
      else expect((observed as ArtifactReaderFailure).cause).toBe(primary);
      if (!result.ok) throw result.error;
      const report = desktopApplicationSchema.parse(
        result.value.normalized_result,
      );
      expect(report.coverage.status).toBe("partial");
      expect(report.files[0]).toMatchObject({
        read_status: "unavailable",
        ranges: [],
      });
      expect(
        report.files[0]?.facts.filter((fact) => fact.offset !== null),
      ).toEqual([]);
      expect(report.files[0]?.issues.join(" ")).toContain(primary.message);
      expect(report.files[0]?.issues.join(" ")).toContain(
        validationState === "unavailable"
          ? validation.message
          : "Directory entry changed during inspection",
      );
      expect(report.candidates).toEqual([]);
    } finally {
      await service.close();
      vi.restoreAllMocks();
    }
  },
);

it.each([false, true])(
  "preserves a physical desktop read failure when cancellation arrives during final validation (failed close: %s)",
  async (failedClose) => {
    const root = await createTestTempDirectory(
      "rea-desktop-read-final-validation-",
    );
    await put(root, "game.pck", Buffer.from("completed source prefix"));
    const reader = new DirectoryArtifactReader(root);
    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry);
    const controller = new AbortController();
    const reason = { phase: "after physical read failure" };
    const physical = Object.assign(new Error("physical read denied"), {
      code: "EACCES",
    });
    let fileHandle: Awaited<ReturnType<typeof open>> | undefined;
    let denyClose = failedClose;
    try {
      const failure: unknown = await reader
        .inspectFile(
          entries[0]!,
          async (file) => {
            fileHandle = file;
            const stat = file.stat.bind(file);
            file.stat = ((...args: Parameters<typeof file.stat>) => {
              controller.abort(reason);
              return stat(...args);
            }) as typeof file.stat;
            const close = file.close.bind(file);
            file.close = async () => {
              if (denyClose) throw new Error("desktop descriptor close denied");
              await close();
            };
            vi.spyOn(file, "read").mockRejectedValueOnce(physical);
            await file.read(Buffer.alloc(4), 0, 4, 0);
          },
          controller.signal,
        )
        .catch((cause: unknown) => cause);
      expect(controller.signal.reason).toBe(reason);
      expect(failure).toMatchObject({ reason: "io" });
      const primary = artifactFilePrimaryFacts(failure).cause;
      if (failedClose) expect(primary).toBe(physical);
      else expect(primary).toMatchObject({ cause: physical });
      if (failedClose) {
        expect(failure).toMatchObject({
          cleanup: { resources: [entries[0]!.adapterKey] },
        });
        await expect(reader.close()).rejects.toBeDefined();
        expect(fileHandle!.fd).toBeGreaterThanOrEqual(0);
      }
      denyClose = false;
      await reader.close();
      expect(fileHandle!.fd).toBe(-1);
    } finally {
      denyClose = false;
      await reader.close();
      vi.restoreAllMocks();
    }
  },
);

it.each([false, true])(
  "retains verified header facts and exact release authority when file close fails (late cancellation: %s)",
  async (cancelDuringClose) => {
    const root = await createTestTempDirectory("rea-desktop-probe-close-");
    const header = Buffer.alloc(20);
    header.write("GDPC");
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(4, 8);
    await put(root, "game.pck", header);
    const controller = new AbortController();
    const reason = new Error("cancel accepted while file close failed");
    let restore: (() => void) | undefined;
    const service = new DesktopApplicationService(
      new DesktopApplicationReader((path) => {
        const reader = new DirectoryArtifactReader(path);
        const inspectFile = reader.inspectFile.bind(reader);
        reader.inspectFile = (entry, inspect, signal) =>
          inspectFile(
            entry,
            async (file) => {
              const close = file.close.bind(file);
              restore = () => {
                file.close = close;
              };
              file.close = async () => {
                if (cancelDuringClose) controller.abort(reason);
                throw new Error("descriptor close denied");
              };
              return inspect(file);
            },
            signal,
          );
        return reader;
      }),
    );
    try {
      const result = await service.inspect(
        { path: root },
        { signal: controller.signal },
      );
      if (result.ok) throw new Error("Expected incomplete descriptor cleanup");
      expect(result.error.cleanupIncomplete).toBe(true);
      if (cancelDuringClose)
        expect(result.error).toMatchObject({
          reason: "cancelled",
          cause: reason,
        });
      const report = desktopApplicationSchema.parse(
        parseEvidence(result.error.partialObservation).normalized_result,
      );
      expect(report.coverage.status).toBe("partial");
      const successfulRead = await inspect(root);
      expect(report.files[0]?.file_id).toBe(
        successfulRead.report.files[0]?.file_id,
      );
      expect(report.files[0]?.ranges).toEqual(
        successfulRead.report.files[0]?.ranges,
      );
      expect(report.root.snapshot_sha256).toBe(
        successfulRead.report.root.snapshot_sha256,
      );
      expect(report.files[0]).toMatchObject({
        read_status: "examined",
        ranges: [{ offset: 0, bytes: 20, sha256: expect.any(String) }],
        facts: [{ kind: "godot-pck-header", offset: 0 }],
      });
      expect(report.candidates.map((candidate) => candidate.family)).toEqual([
        "godot",
      ]);
      await expect(service.close()).rejects.toMatchObject({
        cleanup: expect.any(Object),
      });
      expect(result.error.cleanupIncomplete).toBe(true);
      restore?.();
      await service.close();
      expect(result.error.cleanupIncomplete).toBe(false);
    } finally {
      restore?.();
      await service.close();
    }
  },
);

it.each([
  "Game_Data/Managed",
  "Contents/Resources/Data/Managed",
  "Nested/Game.app/Contents/Resources/Data/Managed",
])(
  "reads AssemblyRef names in %s independently of unrelated key/hash payload validity",
  async (managedDirectory) => {
    const root = await createTestTempDirectory("rea-desktop-reference-fields-");
    const image = buildManagedPeFixture({
      references: ["System.Runtime", "UnityEngine.CoreModule"],
    });
    const metadataOffset = image.indexOf(Buffer.from("BSJB"));
    const layout = readManagedMetadataLayout(
      image,
      metadataOffset,
      image.length - metadataOffset,
    );
    if (layout.blob === null)
      throw new Error("Fixture requires a #Blob stream");
    const blobSize = layout.blob.size;
    const reference = layout.table(35)!;
    // ECMA-335 AssemblyRef: 8 version bytes, 4 flag bytes, then PublicKeyOrToken.
    // Keep its name valid while making that unrelated blob index invalid.
    if (layout.blobIndexSize === 2)
      image.writeUInt16LE(0xffff, reference.offset + 12);
    else image.writeUInt32LE(0xffff_ffff, reference.offset + 12);
    expect(() => readAssemblyReference(image, layout, 1, blobSize)).toThrow();
    await put(root, `${managedDirectory}/Assembly-CSharp.dll`, image);
    const { report } = await inspect(root);
    expect(report.candidates.map((candidate) => candidate.family)).toEqual([
      "dotnet",
      "unity-mono",
    ]);
    expect(
      report.files.find((file) => file.kind === "file")?.facts,
    ).toContainEqual({
      kind: "unity-assembly-reference",
      offset: expect.any(Number),
      value: {
        name: "UnityEngine.CoreModule",
        token: "0x23000002",
        managed_directory: managedDirectory,
      },
    });
  },
);

it.each([
  "Data/Managed",
  "Other/Resources/Data/Managed",
  "Contents/Resource/Data/Managed",
])("does not infer Unity from an unrelated layout %s", async (directory) => {
  const root = await createTestTempDirectory("rea-desktop-unity-layout-");
  await put(
    root,
    `${directory}/Assembly-CSharp.dll`,
    buildManagedPeFixture({ references: ["UnityEngine.CoreModule"] }),
  );
  const { report } = await inspect(root);
  expect(report.candidates.map((candidate) => candidate.family)).toEqual([
    "dotnet",
  ]);
});

it.each([
  { container: 8, chunk: 0, bytes: 16, valid: true },
  { container: 16, chunk: 8, bytes: 32, valid: true },
  { container: 0, chunk: 0, bytes: 16, valid: false },
  { container: 7, chunk: 0, bytes: 16, valid: false },
  { container: 8, chunk: 1, bytes: 17, valid: false },
  { container: 12, chunk: 8, bytes: 24, valid: false },
  { container: 17, chunk: 8, bytes: 24, valid: false },
  { container: 16, chunk: 9, bytes: 25, valid: false },
  { container: 8, chunk: 0xffff_ffff, bytes: 16, valid: false },
])(
  "requires GEN8 within FORM and the file: $container/$chunk/$bytes (valid=$valid)",
  async ({ container, chunk, bytes, valid }) => {
    const root = await createTestTempDirectory("rea-desktop-form-extents-");
    const form = Buffer.alloc(bytes);
    form.write("FORM");
    form.writeUInt32LE(container, 4);
    form.write("GEN8", 8);
    form.writeUInt32LE(chunk, 12);
    await put(root, "data.win", form);
    const { report } = await inspect(root);
    expect(report.candidates.map((candidate) => candidate.family)).toEqual(
      valid ? ["gamemaker"] : [],
    );
    expect(
      report.files
        .find((file) => file.path === "data.win")
        ?.facts.some((fact) => fact.kind === "gamemaker-form-header"),
    ).toBe(valid);
    expect(report.coverage.status).toBe("complete-within-scan");
  },
);

it.each(["assets/game.unx", "Example.app/Contents/Resources/game.ios"])(
  "probes the GameMaker data file at %s",
  async (path) => {
    const root = await createTestTempDirectory("rea-desktop-gamemaker-data-");
    const form = Buffer.alloc(16);
    form.write("FORM");
    form.writeUInt32LE(8, 4);
    form.write("GEN8", 8);
    form.writeUInt32LE(0, 12);
    await put(root, path, form);

    const { report } = await inspect(root);
    expect(report.candidates.map((candidate) => candidate.family)).toContain(
      "gamemaker",
    );
    expect(report.files).toContainEqual(
      expect.objectContaining({
        path,
        read_status: "examined",
        facts: [
          expect.objectContaining({
            kind: "gamemaker-form-header",
            offset: 0,
            value: { container: "FORM", first_chunk: "GEN8" },
          }),
        ],
      }),
    );
    expect(report.coverage.status).toBe("complete-within-scan");
  },
);

it("compares exact signature bytes without masking high bits in engine headers or trailers", async () => {
  const root = await createTestTempDirectory("rea-desktop-exact-signatures-");
  const pck = Buffer.alloc(20);
  pck.write("GDPC");
  const form = Buffer.alloc(16);
  form.write("FORM");
  form.writeUInt32LE(8, 4);
  form.write("GEN8", 8);
  const toc = Buffer.from("-==-".repeat(4));
  for (const [path, source, offset] of [
    ["invalid.pck", pck, 0],
    ["bad-form/data.win", form, 0],
    ["bad-chunk/data.win", form, 8],
    ["invalid.utoc", toc, 0],
  ] as const) {
    const bytes = Buffer.from(source);
    bytes[offset] = bytes[offset]! | 0x80;
    await put(root, path, bytes);
  }
  const elf = Buffer.alloc(64);
  elf.set([0x7f, 0x45, 0x4c, 0x46]);
  const trailer = Buffer.alloc(12);
  trailer.writeBigUInt64LE(BigInt(pck.length));
  trailer.write("GDPC", 8);
  const badTrailer = Buffer.from(trailer);
  badTrailer[8] = badTrailer[8]! | 0x80;
  await put(root, "bad-trailer.exe", Buffer.concat([elf, pck, badTrailer]));
  const badHeader = Buffer.from(pck);
  badHeader[0] = badHeader[0]! | 0x80;
  await put(root, "bad-header.exe", Buffer.concat([elf, badHeader, trailer]));
  const { report } = await inspect(root);
  expect(report.candidates).toEqual([]);
  expect(report.files.flatMap((file) => file.facts)).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "godot-pck-header" }),
    ]),
  );
});

it("yields between reference-name batches so accepted cancellation precedes inspection completion", async () => {
  const root = await createTestTempDirectory("rea-desktop-reference-cancel-");
  await put(
    root,
    "Game_Data/Managed/Assembly-CSharp.dll",
    buildManagedPeFixture({
      references: Array.from({ length: 2048 }, (_, index) => `Library${index}`),
    }),
  );
  const controller = new AbortController();
  const reason = new Error("cancel while references are being examined");
  let completed = false;
  let completedWhenCancelled: boolean | undefined;
  let scheduled = false;
  const service = new DesktopApplicationService(
    new DesktopApplicationReader((path) => {
      const reader = new DirectoryArtifactReader(path);
      const inspectFile = reader.inspectFile.bind(reader);
      reader.inspectFile = (entry, inspection, signal) =>
        inspectFile(
          entry,
          async (file) => {
            const observed = new Proxy(file, {
              get(target, property, receiver) {
                if (property !== "read")
                  return Reflect.get(target, property, receiver);
                return async (...args: unknown[]) => {
                  const result: unknown = await Reflect.apply(
                    target.read,
                    target,
                    args,
                  );
                  const buffer = args[0];
                  if (
                    !scheduled &&
                    Buffer.isBuffer(buffer) &&
                    buffer.subarray(0, 4).equals(Buffer.from("BSJB"))
                  ) {
                    scheduled = true;
                    // Let the first batch start, then cancel on the following turn.
                    setImmediate(() =>
                      setImmediate(() => {
                        completedWhenCancelled = completed;
                        controller.abort(reason);
                      }),
                    );
                  }
                  return result;
                };
              },
            });
            try {
              return await inspection(observed);
            } finally {
              completed = true;
            }
          },
          signal,
        );
      return reader;
    }),
  );
  try {
    const result = await service.inspect(
      { path: root },
      { signal: controller.signal },
    );
    if (result.ok)
      throw new Error("Expected cancellation while examining references");
    expect(scheduled).toBe(true);
    expect(completedWhenCancelled).toBe(false);
    expect(result.error).toMatchObject({ reason: "cancelled", cause: reason });
  } finally {
    await service.close();
  }
});

it.each([
  {
    format: "ELF",
    path: "GameAssembly.so",
    image: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]),
  },
  {
    format: "thin Mach-O",
    path: "Contents/Frameworks/GameAssembly.dylib",
    image: Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 7, 0, 0, 1]),
  },
  ...[false, true].map((littleEndian) => ({
    format: `FAT64 ${littleEndian ? "little" : "big"}-endian`,
    path: "Contents/Frameworks/GameAssembly.dylib",
    image: Buffer.from(
      fatImage(
        [
          {
            cpu: CPU.arm64,
            bytes: machoImage({ cpu: CPU.arm64, fileType: FILE_TYPE.dylib }),
          },
        ],
        true,
        littleEndian,
      ),
    ),
  })),
])(
  "joins IL2CPP metadata with $format library $path",
  async ({ path, image }) => {
    const root = await createTestTempDirectory("rea-desktop-unix-il2cpp-");
    await put(root, path, image);
    const metadata = Buffer.alloc(8);
    metadata.writeUInt32LE(0xfab11baf);
    metadata.writeUInt32LE(31, 4);
    await put(
      root,
      "Game_Data/il2cpp_data/Metadata/global-metadata.dat",
      metadata,
    );
    const { report } = await inspect(root);
    // Native probes read a fixed prefix and, where present, the existing PCK
    // trailer; the FAT architecture table and slice payload are not traversed.
    expect(report.coverage.bytes_read).toBeLessThanOrEqual(
      64 + 12 + metadata.length,
    );
    expect(
      report.files.find((file) => file.path === path)?.ranges[0],
    ).toMatchObject({
      offset: 0,
      bytes: Math.min(image.length, 64),
    });
    expect(report.candidates.map((candidate) => candidate.family)).toEqual([
      "unity-il2cpp",
    ]);
    expect(report.next_probes).toEqual([
      expect.objectContaining({
        operation: "inspect_il2cpp_metadata",
        path: join(
          await realpath(root),
          "Game_Data/il2cpp_data/Metadata/global-metadata.dat",
        ),
        file_id: report.files.find((file) =>
          file.path.endsWith("global-metadata.dat"),
        )?.file_id,
      }),
      expect.objectContaining({
        operation: "open_binary",
        path: join(await realpath(root), path),
        file_id: expect.any(String),
      }),
    ]);
  },
);

it("bounds diagnostic previews while preserving complete caller-provided issue facts", async () => {
  const root = await createTestTempDirectory("rea-desktop-diagnostic-preview-");
  const malformed = Buffer.alloc(64);
  malformed.write("MZ");
  malformed.writeUInt32LE(0xffffffff, 0x3c);
  await put(root, "broken.exe", malformed);
  const { report, evidence } = await inspect(root);
  const source = structuredClone(report);
  const row = source.files.find((file) => file.path === "broken.exe");
  if (row === undefined) throw new Error("Missing diagnostic fixture");
  const longReason = "A" + "😀".repeat(1000);
  row.issues = [longReason, "second probe reason"];
  const callerEvidence = createDesktopApplicationEvidence(
    {
      path: root,
      max_entries: 20_000,
      max_probe_bytes: 8 * 1024 * 1024,
    },
    source,
    evidence.provider,
  );
  const summarized = await inspectAnalysisView({
    source: { kind: "inline", evidence: callerEvidence },
    view: { kind: "summary" },
  });
  if (!summarized.ok) throw summarized.error;
  expect(summarized.value.normalized_result).toMatchObject({
    summary: {
      probe_issues: {
        file_count: 1,
        issue_count: 2,
        preview_truncated: false,
        preview: [
          {
            file_id: row.file_id,
            path_preview: "broken.exe",
            read_status: "partial",
            issue_count: 2,
            first_issue_preview: "A" + "😀".repeat(127),
            text_truncated: true,
          },
        ],
      },
    },
  });
  for (const ids of [undefined, []]) {
    const selected = await inspectAnalysisView({
      source: { kind: "inline", evidence: callerEvidence },
      view: {
        kind: "desktop-application",
        collection: "files",
        has_issues: true,
        ...(ids === undefined ? {} : { file_ids: ids }),
        fields: ["issues"],
      },
    });
    if (!selected.ok) throw selected.error;
    expect(selected.value.normalized_result).toMatchObject({
      items:
        ids === undefined
          ? [
              {
                file_id: row.file_id,
                issues: [longReason, "second probe reason"],
              },
            ]
          : [],
      source_coverage: { status: "partial" },
    });
    expect(selected.value.evidence_links).toEqual([callerEvidence.evidence_id]);
  }
  expect(row.issues[0]).toBe(longReason);
});

it("keeps snapshot identity stable across limits that preserve source observations", async () => {
  const root = await createTestTempDirectory("rea-desktop-snapshot-policy-");
  await put(root, "GameAssembly.dll", buildNativePeFixture());
  const metadata = Buffer.alloc(8);
  metadata.writeUInt32LE(0xfab11baf);
  metadata.writeUInt32LE(31, 4);
  await put(root, "global-metadata.dat", metadata);
  await mkdir(join(root, "BepInEx"));
  const first = await inspect(root, { max_entries: 10, max_probe_bytes: 4096 });
  const second = await inspect(root, {
    max_entries: 20,
    max_probe_bytes: 8192,
  });
  expect(first.report.files).toEqual(second.report.files);
  expect(first.report.omissions).toEqual(second.report.omissions);
  expect(first.report.coverage.status).toBe("complete-within-scan");
  expect(second.report.coverage.status).toBe("complete-within-scan");
  expect(first.report.root.snapshot_sha256).toBe(
    second.report.root.snapshot_sha256,
  );
  expect(first.evidence.subject?.digest.sha256).toBe(
    second.evidence.subject?.digest.sha256,
  );
  expect(first.evidence.evidence_id).not.toBe(second.evidence.evidence_id);
  expect(first.evidence.parameters).toMatchObject({
    max_entries: 10,
    max_probe_bytes: 4096,
  });
  expect(second.evidence.parameters).toMatchObject({
    max_entries: 20,
    max_probe_bytes: 8192,
  });
  expect(first.report.coverage.limits).toEqual({
    max_entries: 10,
    max_probe_bytes: 4096,
  });
  expect(second.report.coverage.limits).toEqual({
    max_entries: 20,
    max_probe_bytes: 8192,
  });
  const subset = await inspect(root, { max_entries: 1, max_probe_bytes: 8192 });
  expect(subset.report.coverage.status).toBe("partial");
  expect(subset.report.root.snapshot_sha256).not.toBe(
    first.report.root.snapshot_sha256,
  );
});

it("changes snapshot identity when probe limits change retained read ranges", async () => {
  const root = await createTestTempDirectory("rea-desktop-snapshot-ranges-");
  for (let index = 0; index < 20; index++)
    await put(
      root,
      `probe${String(index).padStart(2, "0")}.exe`,
      buildNativePeFixture(),
    );
  const partial = await inspect(root, { max_probe_bytes: 4096 });
  const complete = await inspect(root, { max_probe_bytes: 8192 });
  expect(partial.report.coverage.status).toBe("partial");
  expect(complete.report.coverage.status).toBe("complete-within-scan");
  expect(partial.report.files.map((file) => file.file_id)).toEqual(
    complete.report.files.map((file) => file.file_id),
  );
  expect(partial.report.files.map((file) => file.ranges)).not.toEqual(
    complete.report.files.map((file) => file.ranges),
  );
  expect(partial.report.root.snapshot_sha256).not.toBe(
    complete.report.root.snapshot_sha256,
  );
});

it("rejects expanded managed facts before serializing an over-budget value", async () => {
  const root = await createTestTempDirectory("rea-desktop-fact-capacity-");
  const name = `UnityEngine.${"\u0001".repeat(600_000)}`;
  await put(
    root,
    "Game_Data/Managed/Assembly-CSharp.dll",
    buildManagedPeFixture({ references: [name] }),
  );
  const serialized = vi.spyOn(JSON, "stringify");
  onTestFinished(() => serialized.mockRestore());
  const observed = await inspect(root);
  const materializedFacts = serialized.mock.calls.filter(
    ([value]) =>
      value !== null &&
      typeof value === "object" &&
      Reflect.get(value, "name") === name,
  ).length;
  serialized.mockRestore();
  const file = observed.report.files.find((row) => row.path.endsWith(".dll"));
  expect(file?.facts.map((fact) => fact.kind)).toEqual([
    "native-image-header",
    "pe-cli-directory",
  ]);
  expect(file?.issues).toContain(
    "Directory facts reached the retained metadata budget",
  );
  expect(observed.report.coverage.status).toBe("partial");
  expect(
    observed.report.candidates.map((candidate) => candidate.family),
  ).not.toContain("unity-mono");
  expect(materializedFacts).toBe(0);
});

it("preserves admitted Unicode and escaped AssemblyRef names in complete Evidence", async () => {
  const root = await createTestTempDirectory("rea-desktop-fact-text-");
  const name = `UnityEngine.${'雪🧪"\\\n\u0001'.repeat(1024)}`;
  await put(
    root,
    "Game_Data/Managed/Assembly-CSharp.dll",
    buildManagedPeFixture({ references: [name] }),
  );
  const { report } = await inspect(root);
  const file = report.files.find((row) => row.path.endsWith(".dll"));
  expect(file?.issues).toEqual([]);
  expect(file?.facts).toContainEqual({
    kind: "unity-assembly-reference",
    offset: expect.any(Number),
    value: {
      name,
      token: "0x23000001",
      managed_directory: "Game_Data/Managed",
    },
  });
  expect(report.coverage.status).toBe("complete-within-scan");
  expect(report.candidates.map((candidate) => candidate.family)).toContain(
    "unity-mono",
  );
});

it.each([27, 28, 31, 106, 0xffffffff])(
  "preserves raw metadata version %s and suggests inspection only when supported",
  async (version) => {
    const root = await createTestTempDirectory("rea-desktop-metadata-probe-");
    const bytes = Buffer.alloc(8);
    bytes.writeUInt32LE(0xfab11baf);
    bytes.writeUInt32LE(version, 4);
    await put(root, "global-metadata.dat", bytes);
    const { report } = await inspect(root);
    expect(report.candidates).toEqual([]);
    expect(report.files[0]?.facts).toContainEqual({
      kind: "il2cpp-metadata-header",
      offset: 0,
      value: { magic: "0xfab11baf", raw_version: version },
    });
    expect(report.next_probes).toEqual(
      version === 27 || version === 31
        ? [
            expect.objectContaining({
              operation: "inspect_il2cpp_metadata",
              path: join(await realpath(root), "global-metadata.dat"),
              file_id: report.files[0]?.file_id,
            }),
          ]
        : [],
    );
  },
);

it.each([4, 5, 6, 7])(
  "retains IL2CPP magic with an unknown version for a %i-byte prefix",
  async (length) => {
    const root = await createTestTempDirectory("rea-desktop-metadata-prefix-");
    const bytes = Buffer.alloc(length);
    bytes.writeUInt32LE(0xfab11baf);
    await put(root, "global-metadata.dat", bytes);
    const { report } = await inspect(root);
    const metadata = report.files.find((file) =>
      file.path.endsWith("global-metadata.dat"),
    );

    expect(metadata?.facts).toContainEqual({
      kind: "il2cpp-metadata-header",
      offset: 0,
      value: { magic: "0xfab11baf", raw_version: null },
    });
    expect(report.next_probes).not.toContainEqual(
      expect.objectContaining({ operation: "inspect_il2cpp_metadata" }),
    );
  },
);
