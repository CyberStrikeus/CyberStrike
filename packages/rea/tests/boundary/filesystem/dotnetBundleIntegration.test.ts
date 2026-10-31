import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import * as dotnetLayout from "../../../src/artifacts/dotnet/DotnetBundle.js";
import { dotnetBundleFixture } from "../../../src/artifacts/dotnet/DotnetBundle.fixture.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { extractArtifact } from "../../../src/artifacts/extraction/ArtifactExtraction.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("shares a single marker scan through extraction preflight, inventory and materialization", async () => {
  const root = await createTestTempDirectory("rea-dotnet-shared-scan-");
  const path = join(root, "host");
  const member = Buffer.from("owned .NET resource".repeat(128));
  await writeFile(
    path,
    dotnetBundleFixture([
      { path: "data/resource.txt", bytes: member, compressed: true },
    ]).bytes,
  );
  const locate = vi.spyOn(dotnetLayout, "findDotnetBundleHeader");
  const resources = new ArtifactResourceScope();
  const output = join(root, "out");
  try {
    await extractArtifact({
      inputPath: path,
      inputFormat: "pe",
      outputRoot: output,
      environment: process.env,
      resourceScope: resources,
      integrityPolicy: "fail",
    });
    expect(
      (await readFile(join(output, "data/resource.txt"))).equals(member),
    ).toBe(true);
    expect(locate).toHaveBeenCalledTimes(1);
  } finally {
    try {
      await resources.close();
    } finally {
      locate.mockRestore();
    }
  }
});
