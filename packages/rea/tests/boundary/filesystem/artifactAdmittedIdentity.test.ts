import { build } from "plist";
import { elf } from "../../../src/domain/binaryTarget.fixture.js";
import {
  machoImage,
  CPU,
} from "../../../src/artifacts/apple/MachoImage.fixture.js";
import { buildGodotPck, pckU64 } from "../../fixtures/godotPck.js";
import {
  access,
  mkdir,
  readFile,
  writeFile,
  unlink,
  symlink,
  rmdir,
} from "node:fs/promises";
import { join } from "node:path";
import { createPackage } from "@electron/asar";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { expect, it } from "vitest";
import { ArtifactProvider } from "../../../src/artifacts/ArtifactProvider.js";
import {
  artifactExtractionResultSchema,
  artifactInventoryResultSchema,
} from "../../../src/domain/artifactGraph.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { createSingleEntryZip } from "../../fixtures/zipNames.js";

it.skipIf(process.platform === "win32").each(["zip", "asar"])(
  "rejects a %s selection whose traversed directory became a file",
  async (format) => {
    const root = await createTestTempDirectory("rea-admitted-traversal-");
    const child = join(root, "child");
    await mkdir(child);
    const stored = join(root, `stored.${format}`);
    if (format === "asar") {
      const source = join(root, "source");
      await mkdir(source);
      await writeFile(join(source, "payload.txt"), "member bytes");
      await createPackage(source, stored);
    } else {
      await writeFile(stored, await createSingleEntryZip("payload.txt"));
    }
    const selected = `${child}/../stored.${format}`;
    const session = createTestBinarySession(new ArtifactProvider({}));
    try {
      const opened = await session.open(selected);
      if (!opened.ok) throw opened.error;
      await rmdir(child);
      await writeFile(child, "now a regular file");
      await expect(readFile(selected)).rejects.toMatchObject({
        code: "ENOTDIR",
      });
      for (const operation of [
        "inventory_artifact",
        "extract_artifact",
      ] as const) {
        const output = join(root, operation);
        const result = await session.execute(
          operation,
          operation === "extract_artifact" ? { output_root: output } : {},
        );
        expect(result).toMatchObject({
          ok: false,
          error: {
            reason: "integrity",
            detail: expect.stringContaining(
              "no longer resolves to its admitted source",
            ),
          },
        });
        await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
      }
    } finally {
      await session.close();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "keeps native symlink parent traversal when revalidating archive selections",
  async () => {
    const root = await createTestTempDirectory(
      "rea-admitted-native-traversal-",
    );
    const physical = join(root, "physical");
    await mkdir(join(physical, "child"), { recursive: true });
    const link = join(root, "link");
    await symlink(join(physical, "child"), link);
    await writeFile(
      join(physical, "stored.zip"),
      await createSingleEntryZip("payload.txt", "selected bytes"),
    );
    await writeFile(
      join(root, "stored.zip"),
      "lexical sibling is not an archive",
    );
    const session = createTestBinarySession(new ArtifactProvider({}));
    try {
      const opened = await session.open(`${link}/../stored.zip`);
      if (!opened.ok) throw opened.error;
      const inventory = await session.execute("inventory_artifact", {});
      if (!inventory.ok) throw inventory.error;
      expect(
        artifactInventoryResultSchema.parse(inventory.value.result).manifest
          .root_format,
      ).toBe("zip");
      const output = join(root, "output");
      const extraction = await session.execute("extract_artifact", {
        output_root: output,
      });
      if (!extraction.ok) throw extraction.error;
      expect(await readFile(join(output, "payload.txt"), "utf8")).toBe(
        "selected bytes",
      );
    } finally {
      await session.close();
    }
  },
);

it.each([
  { format: "zip", replacement: "valid" },
  { format: "apk", replacement: "valid" },
  { format: "asar", replacement: "valid" },
  { format: "zip", replacement: "malformed" },
  { format: "asar", replacement: "malformed" },
])(
  "binds $format $replacement archive operations to the admitted source before output creation",
  async ({ format, replacement }) => {
    const root = await createTestTempDirectory(
      "rea-archive-admitted-identity-",
    );
    const path = join(root, `selected.${format}`);
    const source = join(root, "source");
    await mkdir(source);
    const writeArchive = async (value: string) => {
      if (format === "asar") {
        await writeFile(join(source, "payload.txt"), value);
        await createPackage(source, path);
      } else {
        const zip = new ZipWriter(new Uint8ArrayWriter());
        await zip.add("payload.txt", new TextReader(value));
        await writeFile(path, await zip.close());
      }
    };
    await writeArchive("admitted version one");
    const session = createTestBinarySession(new ArtifactProvider({}));
    try {
      const opened = await session.open(path);
      if (!opened.ok) throw opened.error;
      const initial = await session.execute("inventory_artifact", {});
      if (!initial.ok) throw initial.error;
      if (replacement === "malformed") await writeFile(path, "not an archive");
      else await writeArchive("changed version two");
      for (const operation of [
        "inventory_artifact",
        "inspect_artifact",
        "extract_artifact",
      ] as const) {
        const output = join(root, `refused-${operation}`);
        const result = await session.execute(
          operation,
          operation === "extract_artifact"
            ? { output_root: output, integrity_policy: "fail" }
            : {},
        );
        expect(result).toMatchObject({
          ok: false,
          error: {
            reason: "integrity",
            detail: expect.stringContaining("changed after target admission"),
          },
        });
        await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
      }
      if (replacement === "valid") {
        const reopened = await session.open(path);
        if (!reopened.ok) throw reopened.error;
        const inventory = await session.execute("inventory_artifact", {});
        if (!inventory.ok) throw inventory.error;
        expect(
          artifactInventoryResultSchema.parse(inventory.value.result).manifest
            .root_sha256,
        ).not.toBe(
          artifactInventoryResultSchema.parse(initial.value.result).manifest
            .root_sha256,
        );
        const extracted = await session.execute("extract_artifact", {
          output_root: join(root, "reopened-output"),
          integrity_policy: "fail",
        });
        if (!extracted.ok) throw extracted.error;
        const result = artifactExtractionResultSchema.parse(
          extracted.value.result,
        );
        expect(
          await readFile(join(result.output_root, "payload.txt"), "utf8"),
        ).toBe("changed version two");
      }
    } finally {
      expect(await session.close()).toEqual({ ok: true, value: null });
    }
  },
);

it.skipIf(process.platform === "win32")(
  "rejects retargeted ZIP selections without attributing or publishing the old packed bytes",
  async () => {
    const root = await createTestTempDirectory("rea-admitted-zip-alias-");
    const stored = join(root, "stored.zip");
    const other = join(root, "other.zip");
    const selected = join(root, "selected.zip");
    const zip = new ZipWriter(new Uint8ArrayWriter());
    await zip.add("payload.txt", new TextReader("same bytes"));
    const bytes = await zip.close();
    await writeFile(stored, bytes);
    await writeFile(other, bytes);
    await symlink(stored, selected);
    const session = createTestBinarySession(new ArtifactProvider({}));
    try {
      const opened = await session.open(selected);
      if (!opened.ok) throw opened.error;
      await unlink(selected);
      await symlink(other, selected);
      for (const operation of [
        "inventory_artifact",
        "extract_artifact",
      ] as const) {
        const output = join(root, operation);
        const result = await session.execute(
          operation,
          operation === "extract_artifact" ? { output_root: output } : {},
        );
        expect(result).toMatchObject({
          ok: false,
          error: {
            reason: "integrity",
            detail: expect.stringContaining(
              "no longer resolves to its admitted source",
            ),
          },
        });
        await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
      }
    } finally {
      await session.close();
    }
  },
);

it("rejects an admitted archive replaced by a directory", async () => {
  const root = await createTestTempDirectory("rea-admitted-file-directory-");
  const path = join(root, "selected.zip");
  const zip = new ZipWriter(new Uint8ArrayWriter());
  await zip.add("payload.txt", new TextReader("original"));
  await writeFile(path, await zip.close());
  const session = createTestBinarySession(new ArtifactProvider({}));
  try {
    const opened = await session.open(path);
    if (!opened.ok) throw opened.error;
    await unlink(path);
    await mkdir(path);
    await writeFile(join(path, "payload.txt"), "replacement directory");
    const output = join(root, "output");
    expect(
      await session.execute("extract_artifact", { output_root: output }),
    ).toMatchObject({ ok: false, error: { reason: "integrity" } });
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await session.close();
  }
});

it("keeps app bundle aggregate inventories live when resources change", async () => {
  const root = await createTestTempDirectory("rea-admitted-bundle-resources-");
  const app = join(root, "Fixture.app");
  await mkdir(join(app, "Contents", "MacOS"), { recursive: true });
  await writeFile(
    join(app, "Contents", "MacOS", "fixture"),
    machoImage({ cpu: CPU.arm64e }),
  );
  await writeFile(
    join(app, "Contents", "Info.plist"),
    build({ CFBundlePackageType: "APPL", CFBundleExecutable: "fixture" }),
  );
  const payload = join(app, "Contents", "payload.txt");
  await writeFile(payload, "first resource");
  const session = createTestBinarySession(new ArtifactProvider({}));
  try {
    const opened = await session.open(app);
    if (!opened.ok) throw opened.error;
    const initial = await session.execute("inventory_artifact", {});
    if (!initial.ok) throw initial.error;
    await writeFile(payload, "second resource");
    const current = await session.execute("inventory_artifact", {});
    if (!current.ok) throw current.error;
    expect(
      artifactInventoryResultSchema.parse(current.value.result).manifest
        .root_sha256,
    ).not.toBe(
      artifactInventoryResultSchema.parse(initial.value.result).manifest
        .root_sha256,
    );
    const extracted = await session.execute("extract_artifact", {
      output_root: join(root, "output"),
    });
    if (!extracted.ok) throw extracted.error;
    const result = artifactExtractionResultSchema.parse(extracted.value.result);
    expect(
      await readFile(
        join(result.output_root, "Contents", "payload.txt"),
        "utf8",
      ),
    ).toBe("second resource");
  } finally {
    await session.close();
  }
});

it("checks embedded native packs before acceptance while preserving unsupported fast refusal", async () => {
  const root = await createTestTempDirectory("rea-admitted-native-preflight-");
  const path = join(root, "game");
  const writePack = async (text: string) => {
    const pack = buildGodotPck(2, [
      { path: "res://payload.txt", data: Buffer.from(text) },
    ]);
    await writeFile(
      path,
      Buffer.concat([
        elf(2, 1, 62),
        pack,
        pckU64(pack.length),
        Buffer.from("GDPC"),
      ]),
    );
  };
  await writePack("first");
  const session = createTestBinarySession(new ArtifactProvider({}));
  try {
    const opened = await session.open(path);
    if (!opened.ok) throw opened.error;
    await writePack("second");
    const output = join(root, "output");
    expect(
      await session.execute("extract_artifact", { output_root: output }),
    ).toMatchObject({
      ok: false,
      error: {
        reason: "integrity",
        detail: expect.stringContaining("changed after target admission"),
      },
    });
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(path, "not a native pack");
    expect(
      await session.execute("extract_artifact", { output_root: output }),
    ).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisUnsupportedTargetError" },
    });
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await session.close();
  }
});
