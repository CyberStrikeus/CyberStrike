import { createOwnedArtifactClient } from "../../../support/artifactClientScope.js";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { createPackage, createPackageWithOptions } from "@electron/asar";
import { expect, it, onTestFinished, vi } from "vitest";

import { parseBinaryTarget } from "../../../../src/application/BinaryTargetResolver.js";
import {
  materializeArtifactInventory,
  scanArtifactInventory,
} from "../../../fixtures/artifactInventory.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { DirectoryArtifactReader } from "../../../../src/artifacts/DirectoryArtifactReader.js";

it.for([false, true])(
  "preserves source traversal coverage when invalid-byte names are present: %s",
  async (invalidName, context) => {
    if (invalidName && process.platform !== "linux") context.skip();
    const root = await createTestTempDirectory("rea-extract-coverage-");
    const source = join(root, "source");
    await mkdir(source);
    await writeFile(join(source, "visible.txt"), "retained");
    if (invalidName)
      await writeFile(
        Buffer.concat([Buffer.from(`${source}/`), Buffer.from([0xff])]),
        "unrepresented",
      );
    const snapshot = await scanArtifactInventory(source);
    const extracted = await extractDirectory(source, join(root, "output"));
    expect(extracted.coverage).toEqual(snapshot.coverage);
    expect(extracted.coverage.status).toBe(
      invalidName ? "unknown" : "complete",
    );
    expect(extracted.limitations).toEqual(
      expect.arrayContaining([...snapshot.limitations]),
    );
    expect(
      extracted.artifacts.map(({ relative_path }) => relative_path),
    ).toEqual(["visible.txt"]);
    expect(
      await readFile(join(extracted.output_root, "visible.txt"), "utf8"),
    ).toBe("retained");
  },
);

it.skipIf(process.platform !== "linux")(
  "retains newly unknown materialization traversal after a complete inventory",
  async () => {
    const root = await createTestTempDirectory("rea-extract-late-coverage-");
    const source = join(root, "source");
    await mkdir(source);
    await writeFile(join(source, "visible.txt"), "retained");
    const snapshot = await scanArtifactInventory(source);
    expect(snapshot.coverage.status).toBe("complete");
    await writeFile(
      Buffer.concat([Buffer.from(`${source}/`), Buffer.from([0xff])]),
      "unrepresented",
    );
    const extracted = await materializeArtifactInventory(
      {
        inputPath: source,
        inputFormat: "asar",
        outputRoot: join(root, "output"),
        environment: {},
        integrityPolicy: "fail",
      },
      source,
      snapshot,
    );
    expect(extracted.coverage.status).toBe("unknown");
    expect(extracted.limitations).toContainEqual(
      expect.stringContaining("not valid UTF-8"),
    );
  },
);

it.each(["file", "directory"] as const)(
  "rolls back when an inventoried %s disappears before extraction",
  async (removedKind) => {
    const root = await createTestTempDirectory("rea-extract-missing-");
    const source = join(root, "source");
    await mkdir(join(source, "z"), { recursive: true });
    // Equal bytes share an artifact node, but both occurrences must be copied.
    const bytes = Buffer.from("same bytes\n");
    await writeFile(join(source, "a.txt"), bytes);
    await writeFile(join(source, "z", "missing.txt"), bytes);
    const output = join(root, "output");
    const materialize = await inventoriedExtraction(source, output);
    await rm(
      removedKind === "file"
        ? join(source, "z", "missing.txt")
        : join(source, "z"),
      { recursive: removedKind === "directory" },
    );
    await expect(materialize()).rejects.toMatchObject({
      reason: "integrity",
      message:
        "Inventoried regular artifact entries were not materialized: z/missing.txt",
    });
    await expect(access(output)).rejects.toThrow();
    expect(
      createHash("sha256")
        .update(await readFile(join(source, "a.txt")))
        .digest("hex"),
    ).toBe(createHash("sha256").update(bytes).digest("hex"));
  },
);

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "rolls back when a previously inventoried directory becomes unreadable",
  async () => {
    const root = await createTestTempDirectory("rea-extract-denied-late-");
    const source = join(root, "source");
    const child = join(source, "child");
    await mkdir(child, { recursive: true });
    await writeFile(join(child, "selected.txt"), "selected bytes\n");
    const output = join(root, "output");
    const materialize = await inventoriedExtraction(source, output);
    await chmod(child, 0);
    onTestFinished(() => chmod(child, 0o755));
    await expect(materialize()).rejects.toMatchObject({
      reason: "integrity",
      message:
        "Inventoried regular artifact entries were not materialized: child/selected.txt",
    });
    await expect(access(output)).rejects.toThrow();
    await chmod(child, 0o755);
    expect(await readFile(join(child, "selected.txt"), "utf8")).toBe(
      "selected bytes\n",
    );
  },
);

it("still refuses a regular file added after inventory and rolls back", async () => {
  const root = await createTestTempDirectory("rea-extract-added-");
  const source = join(root, "source");
  await mkdir(source);
  await writeFile(join(source, "a.txt"), "original\n");
  const output = join(root, "output");
  const materialize = await inventoriedExtraction(source, output);
  await writeFile(join(source, "z.txt"), "new\n");
  await expect(materialize()).rejects.toMatchObject({
    reason: "integrity",
    message: "Regular artifact entry is missing from inventory: z.txt",
  });
  await expect(access(output)).rejects.toThrow();
});

it
  .skipIf(process.platform !== "linux")
  .each(["inventory", "materialization"] as const)(
  "retains unknown filename coverage established during %s",
  async (phase) => {
    const root = await createTestTempDirectory(
      "rea-extract-unknown-traversal-",
    );
    const source = join(root, "source");
    await mkdir(source);
    await writeFile(join(source, "known.txt"), "retained bytes\n");
    const opaque = Buffer.concat([
      Buffer.from(join(source, "opaque-")),
      Buffer.from([0xff]),
    ]);
    if (phase === "inventory") await writeFile(opaque, "opaque bytes\n");
    const output = join(root, "output");
    const materialize = await inventoriedExtraction(source, output);
    if (phase === "inventory") await rm(opaque);
    else await writeFile(opaque, "opaque bytes\n");

    const result = await materialize();
    expect(result.artifacts.map(({ relative_path }) => relative_path)).toEqual([
      "known.txt",
    ]);
    expect(await readFile(join(output, "known.txt"), "utf8")).toBe(
      "retained bytes\n",
    );
    expect(result.limitations).toContainEqual(
      expect.stringContaining("not valid UTF-8"),
    );
    expect(result.limitations).toContainEqual(
      expect.stringContaining("source traversal coverage is unknown"),
    );
    expect(
      result.limitations.some((value) => value.startsWith("All regular files")),
    ).toBe(false);
  },
);

it.each(["inventory", "materialization"] as const)(
  "retains typed unknown coverage from only the %s producer stage",
  async (phase) => {
    const root = await createTestTempDirectory("rea-extract-stage-coverage-");
    const source = join(root, "source");
    await mkdir(source);
    await writeFile(join(source, "known.txt"), "retained bytes\n");
    const output = join(root, "output");
    let stage: "inventory" | "materialization" = "inventory";
    const limitation = `Producer traversal coverage is unknown during ${phase}.`;
    const entries = DirectoryArtifactReader.prototype.entries;
    const spy = vi
      .spyOn(DirectoryArtifactReader.prototype, "entries")
      .mockImplementation(async function* (
        this: DirectoryArtifactReader,
        signal,
        selection,
      ) {
        yield* entries.call(this, signal, selection);
        if (typeof selection === "function") return;
        if (stage === phase)
          selection?.onCoverage?.({
            status: "unknown",
            limitations: [limitation],
          });
        // A later complete observation must not erase established uncertainty.
        selection?.onCoverage?.({ status: "complete", limitations: [] });
      });
    try {
      const materialize = await inventoriedExtraction(source, output);
      stage = "materialization";
      const result = await materialize();
      expect(result.limitations).toContain(limitation);
      expect(result.limitations).toContainEqual(
        expect.stringContaining("source traversal coverage is unknown"),
      );
      expect(
        result.limitations.some((value) =>
          value.startsWith("All regular files"),
        ),
      ).toBe(false);
      expect(
        result.artifacts.map(({ relative_path }) => relative_path),
      ).toEqual(["known.txt"]);
      expect(await readFile(join(output, "known.txt"), "utf8")).toBe(
        "retained bytes\n",
      );
    } finally {
      spy.mockRestore();
    }
  },
);

it("normalizes an NFD omission once across inventory and materialization", async () => {
  const root = await createTestTempDirectory("rea-extract-omission-nfc-");
  const source = join(root, "source");
  await mkdir(source);
  await writeFile(join(source, "known.txt"), "retained bytes\n");
  const output = join(root, "output");
  const entries = DirectoryArtifactReader.prototype.entries;
  const spy = vi
    .spyOn(DirectoryArtifactReader.prototype, "entries")
    .mockImplementation(async function* (
      this: DirectoryArtifactReader,
      signal,
      selection,
    ) {
      yield* entries.call(this, signal, selection);
      if (typeof selection === "function") return;
      selection?.onOmission?.({ path: "cafe\u0301.pipe", kind: "fifo" });
      selection?.onCoverage?.({ status: "complete", limitations: [] });
    });
  try {
    const snapshot = await scanArtifactInventory(source);
    expect(snapshot.coverage.status).toBe("unknown");
    const result = await materializeArtifactInventory(
      {
        inputPath: source,
        inputFormat: "asar",
        outputRoot: output,
        environment: process.env,
        integrityPolicy: "fail",
      },
      source,
      snapshot,
    );
    const omission = 'Artifact traversal omitted fifo at "caf\u00e9.pipe".';
    for (const limitations of [snapshot.limitations, result.limitations])
      expect(
        limitations.filter((value) =>
          value.startsWith("Artifact traversal omitted"),
        ),
      ).toEqual([omission]);
    expect(result.limitations).toContainEqual(
      expect.stringContaining("source traversal coverage is unknown"),
    );
    expect(await readFile(join(output, "known.txt"), "utf8")).toBe(
      "retained bytes\n",
    );
  } finally {
    spy.mockRestore();
  }
});

it("rolls back when cancellation arrives while closing the materialization reader", async () => {
  const root = await createTestTempDirectory("rea-extract-cancel-close-");
  const source = join(root, "source");
  await mkdir(source);
  await writeFile(join(source, "payload.txt"), "complete payload\n");
  const snapshot = await scanArtifactInventory(source);
  const output = join(root, "output");
  const controller = new AbortController();
  const close = DirectoryArtifactReader.prototype.close;
  const closeSpy = vi
    .spyOn(DirectoryArtifactReader.prototype, "close")
    .mockImplementation(async function (this: DirectoryArtifactReader) {
      controller.abort();
      await close.call(this);
    });
  try {
    await expect(
      materializeArtifactInventory(
        {
          inputPath: source,
          inputFormat: "asar",
          outputRoot: output,
          environment: process.env,
          integrityPolicy: "fail",
        },
        source,
        snapshot,
        controller.signal,
      ),
    ).rejects.toMatchObject({ reason: "cancelled" });
    await expect(access(output)).rejects.toThrow();
  } finally {
    closeSpy.mockRestore();
  }
});

it("preserves every equal-content occurrence and copies a nested ASAR as its containing file", async () => {
  const root = await createTestTempDirectory("rea-extract-nested-");
  const source = join(root, "source");
  const nested = join(root, "nested");
  await mkdir(source);
  await mkdir(join(nested, "assets"), { recursive: true });
  await writeFile(join(nested, "assets", "main.js"), "export default 1;\n");
  await createPackage(nested, join(source, "app.asar"));
  await writeFile(join(source, "a.txt"), "same bytes\n");
  await writeFile(join(source, "b.txt"), "same bytes\n");
  const output = join(root, "output");
  const extracted = await extractDirectory(source, output);
  expect(extracted.artifacts.map(({ relative_path }) => relative_path)).toEqual(
    ["a.txt", "app.asar", "b.txt"],
  );
  expect(extracted.extraction_manifest.selected_occurrence_ids).toHaveLength(3);
  expect(extracted.artifacts[0]?.artifact_id).toBe(
    extracted.artifacts[2]?.artifact_id,
  );
  for (const path of ["a.txt", "b.txt", "app.asar"])
    expect(
      Buffer.compare(
        await readFile(join(output, path)),
        await readFile(join(source, path)),
      ),
    ).toBe(0);
});

it("ignores unavailable members of a nested ASAR but refuses them as active entries", async () => {
  const root = await createTestTempDirectory("rea-extract-nested-unpacked-");
  const contents = join(root, "contents");
  await mkdir(join(contents, "native"), { recursive: true });
  await writeFile(join(contents, "main.js"), "export default 1;\n");
  await writeFile(join(contents, "native", "addon.node"), "native bytes\n");

  const source = join(root, "bundle");
  await mkdir(source);
  const archive = join(source, "app.asar");
  await createPackageWithOptions(contents, archive, { unpack: "*.node" });
  await rm(join(`${archive}.unpacked`, "native", "addon.node"));

  const nestedOutput = join(root, "nested-output");
  const nestedExtraction = await extractDirectory(source, nestedOutput);
  expect(
    nestedExtraction.extraction_manifest.selected_occurrence_ids,
  ).toHaveLength(1);
  expect(
    nestedExtraction.artifacts.map(({ relative_path }) => relative_path),
  ).toEqual(["app.asar"]);
  expect(
    Buffer.compare(
      await readFile(join(nestedOutput, "app.asar")),
      await readFile(archive),
    ),
  ).toBe(0);

  const activeOutput = join(root, "active-output");
  const activeResult = await extractArchive(archive, activeOutput);
  if (activeResult.ok)
    throw new Error("Unavailable active ASAR member must fail extraction");
  expect(projectAnalysisError(activeResult.error)).toMatchObject({
    code: "artifact_operation_failed",
    category: "unavailable",
    details: { logical_path: "native/addon.node", unpacked: true },
  });
  await expect(access(activeOutput)).rejects.toThrow();
});

const inventoriedExtraction = async (source: string, output: string) => {
  const snapshot = await scanArtifactInventory(source);
  return () =>
    materializeArtifactInventory(
      {
        inputPath: source,
        inputFormat: "asar",
        outputRoot: output,
        environment: process.env,
        integrityPolicy: "fail",
      },
      source,
      snapshot,
    );
};

/** Raw directory completeness belongs to inventory/materialization, not file target admission. */
const extractDirectory = async (source: string, output: string) => {
  const materialize = await inventoriedExtraction(source, output);
  return materialize();
};

const extractArchive = async (source: string, output: string) => {
  const target = await parseBinaryTarget(source);
  if (!target.ok) throw target.error;
  return createOwnedArtifactClient(target.value).execute("extract_artifact", {
    output_root: output,
  });
};
