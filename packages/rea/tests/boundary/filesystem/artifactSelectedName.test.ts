import { projectCliAnalysisResult } from "../../../src/cli/projectCliAnalysisResult.js";
import { readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { expect, it, vi } from "vitest";
import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { createDirectAnalysis } from "../../../src/composition/directAnalysis.js";
import {
  artifactExtractionResultSchema,
  artifactInventoryResultSchema,
} from "../../../src/domain/artifactGraph.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { elf } from "../../../src/domain/binaryTarget.fixture.js";
import { ArtifactProvider } from "../../../src/artifacts/ArtifactProvider.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const fixture = async (storedName = "content-addressed-archive") => {
  const root = await createTestTempDirectory("rea-artifact-selected-name-");
  const canonical = join(root, storedName);
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add(
    "AndroidManifest.xml",
    new TextReader(
      '<manifest package="example.fixture"><application /></manifest>',
    ),
  );
  await writer.add("payload.txt", new TextReader("same packed bytes"));
  await writeFile(canonical, await writer.close());
  return { root, canonical };
};

it.skipIf(process.platform === "win32").each([
  ["selected.apk", "content", "apk"],
  ["selected.ipa", "content", "ipa"],
  ["selected.apk", "canonical.ipa", "apk"],
  ["selected.ipa", "canonical.apk", "ipa"],
  ["selected.unknown", "canonical.apk", "apk"],
  ["selected.asar", "content", "zip"],
] as const)(
  "keeps selected %s and stored %s consistent across admission, inventory and extraction",
  async (name, stored, format) => {
    const { root, canonical } = await fixture(stored);
    const selected = join(root, name);
    await symlink(canonical, selected);
    const admitted = await parseBinaryTarget(selected);
    if (!admitted.ok) throw admitted.error;
    expect(admitted.value.path).toBe(canonical);
    expect(admitted.value.format).toBe(format);
    const { runProviderAnalysis } = createDirectAnalysis({});
    const observed = parseEvidence(
      await runProviderAnalysis(selected, "inventory_artifact", {}).then(
        projectCliAnalysisResult,
      ),
    );
    expect(observed.subject?.local_path).toBe(selected);
    expect(
      artifactInventoryResultSchema.parse(observed.normalized_result).manifest
        .root_format,
    ).toBe(format);
    const provider = new ArtifactProvider({});
    const client = provider.createClient(admitted.value);
    try {
      const execution = await client.execute("extract_artifact", {
        output_root: join(root, "output"),
        integrity_policy: "fail",
      });
      if (!execution.ok) throw execution.error;
      expect(execution.value.subject?.path).toBe(selected);
      const result = artifactExtractionResultSchema.parse(
        execution.value.result,
      );
      expect(result.manifest.root_format).toBe(format);
      expect(
        await readFile(join(result.output_root, "payload.txt"), "utf8"),
      ).toBe("same packed bytes");
    } finally {
      await client.close();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "reopens the same packed file under distinct package selections and reuses unchanged selection",
  async () => {
    const { root, canonical } = await fixture();
    const apk = join(root, "selected.apk");
    const ipa = join(root, "selected.ipa");
    await symlink(canonical, apk);
    await symlink(canonical, ipa);
    const provider = new ArtifactProvider({});
    const created = vi.spyOn(provider, "createClient");
    const session = createTestBinarySession(provider);
    try {
      for (const [path, format, calls] of [
        [apk, "apk", 1],
        [apk, "apk", 1],
        [ipa, "ipa", 2],
      ] as const) {
        const opened = await session.open(path);
        if (!opened.ok) throw opened.error;
        expect(created).toHaveBeenCalledTimes(calls);
        const execution = await session.execute("inventory_artifact", {});
        if (!execution.ok) throw execution.error;
        expect(execution.value.subject?.path).toBe(path);
        expect(
          artifactInventoryResultSchema.parse(execution.value.result).manifest
            .root_format,
        ).toBe(format);
      }
    } finally {
      await session.close();
      created.mockRestore();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "does not reinterpret real executable bytes from an artifact alias suffix",
  async () => {
    const root = await createTestTempDirectory("rea-artifact-executable-name-");
    const canonical = join(root, "program");
    const selected = join(root, "selected.asar");
    await writeFile(canonical, elf(2, 1, 62));
    await symlink(canonical, selected);
    const admitted = await parseBinaryTarget(selected);
    if (!admitted.ok) throw admitted.error;
    expect(admitted.value.format).toBe("elf");
    expect(admitted.value.kind).toBe("executable");
  },
);
