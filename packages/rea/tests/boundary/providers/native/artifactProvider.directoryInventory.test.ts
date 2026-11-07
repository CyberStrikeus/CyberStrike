import { createOwnedArtifactClient } from "../../../support/artifactClientScope.js";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

import { parseBinaryTarget } from "../../../../src/application/BinaryTargetResolver.js";
import {
  CPU,
  machoImage,
} from "../../../../src/artifacts/apple/MachoImage.fixture.js";
import { artifactInventoryResultSchema } from "../../../../src/domain/artifactGraph.js";
import type { BinaryTarget } from "../../../../src/domain/binaryTargetTypes.js";

describe("artifact directory inventory", () => {
  it("inventories app trees deterministically without following symlinks", async () => {
    const root = await createTestTempDirectory("rea-artifacts-");
    const app = join(root, "Fixture.app");
    await mkdir(join(app, "Contents", "Resources"), { recursive: true });
    await mkdir(join(app, "Contents", "MacOS"), { recursive: true });
    await mkdir(join(app, "Contents", "Frameworks", "Fixture.framework"), {
      recursive: true,
    });
    const machO = machoImage({ cpu: CPU.arm64 });
    await writeFile(
      join(app, "Contents/Info.plist"),
      '<plist version="1.0"><dict><key>CFBundleExecutable</key><string>Fixture</string></dict></plist>',
    );
    await writeFile(join(app, "Contents", "MacOS", "Fixture"), machO, {
      mode: 0o755,
    });
    await writeFile(
      join(app, "Contents", "Frameworks", "Fixture.framework", "Fixture"),
      machO,
    );
    await writeFile(join(app, "Contents", "Resources", "main.js"), "main();\n");
    await writeFile(join(app, "Contents", "Resources", "main.js.MAP"), "{}\n");
    await symlink("/etc/passwd", join(app, "Contents", "Resources", "outside"));
    const client = createOwnedArtifactClient(await target(app));
    const input = {};
    const first = await client.execute("inventory_artifact", input);
    const second = await client.execute("inventory_artifact", input);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const left = artifactInventoryResultSchema.parse(first.value.result);
    const right = artifactInventoryResultSchema.parse(second.value.result);
    expect(left.manifest).toEqual(right.manifest);
    expect(left.occurrences.map(({ artifact_kind }) => artifact_kind)).toEqual(
      expect.arrayContaining([
        "executable",
        "framework",
        "javascript",
        "source-map",
      ]),
    );
    expect(
      left.occurrences.find(({ logical_path: path }) =>
        path.endsWith("outside"),
      ),
    ).toMatchObject({ artifact_id: null, entry_kind: "symlink" });
    const script = left.occurrences.find(({ logical_path: path }) =>
      path.endsWith("main.js"),
    );
    const sourceMap = left.occurrences.find(({ logical_path: path }) =>
      path.endsWith("main.js.MAP"),
    );
    expect(left.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "maps-source",
          parent_artifact_id: script?.artifact_id,
          occurrence_id: sourceMap?.occurrence_id,
        }),
      ]),
    );
  });
});

const target = async (path: string): Promise<BinaryTarget> => {
  const parsed = await parseBinaryTarget(path);
  if (!parsed.ok) throw parsed.error;
  expect(parsed.value.bundleInfoPlist).toBe(join(path, "Contents/Info.plist"));
  return parsed.value;
};
