import { createOwnedArtifactClient } from "../../../support/artifactClientScope.js";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { CPU_ARM64, universalMacho } from "../../../fixtures/universalMacho.js";
import { thinMach } from "../../../../src/domain/binaryTarget.fixture.js";

import { ArtifactReaderFailure } from "../../../../src/artifacts/ArtifactReader.js";
import {
  CPU,
  fatImage,
  machoImage,
} from "../../../../src/artifacts/apple/MachoImage.fixture.js";
import { parseBinaryTarget } from "../../../../src/application/BinaryTargetResolver.js";
import { artifactExtractionExecutionSchema } from "../../../../src/contracts/artifactToolContracts.js";

const sliceReader = vi.hoisted(() => ({
  reached: vi.fn(),
  failure: null as unknown,
}));

vi.mock("../../../../src/artifacts/MachOSliceArtifactReader.js", () => ({
  MachOSliceArtifactReader: class {
    async *entries() {
      sliceReader.reached();
      yield* [];
      throw sliceReader.failure;
    }

    close() {
      return Promise.resolve();
    }

    provenance() {
      return [];
    }
  },
}));

it("routes universal Mach-O extraction through slice inventory", async () => {
  sliceReader.reached.mockClear();
  sliceReader.failure = new ArtifactReaderFailure(
    "unavailable",
    "fixture reached universal slice inventory",
  );
  const root = await createTestTempDirectory("rea-extract-universal-");
  const image = join(root, "Universal");
  await writeFile(
    image,
    universalMacho([
      {
        bytes: thinMach(0xfeedfacf, CPU_ARM64),
        cpuType: CPU_ARM64,
        cpuSubtype: 0,
      },
    ]).bytes,
  );
  const target = await parseBinaryTarget(image, { hostArchitecture: "arm64" });
  if (!target.ok) throw target.error;
  const output = join(root, "output");
  const result = await createOwnedArtifactClient(target.value).execute(
    "extract_artifact",
    artifactExtractionExecutionSchema.parse({ output_root: output }),
  );

  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "ArtifactOperationError",
      reason: "unavailable",
      detail: "fixture reached universal slice inventory",
    },
  });
  expect(sliceReader.reached).toHaveBeenCalledOnce();
  await expect(access(output)).rejects.toThrow();
});
