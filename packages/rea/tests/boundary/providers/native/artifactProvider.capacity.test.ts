import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import { ArtifactProvider } from "../../../../src/artifacts/ArtifactProvider.js";
import { parseBinaryTarget } from "../../../../src/application/BinaryTargetResolver.js";
import {
  cArchiveExecutable,
  pyzArchive,
  PYTHON_39_MAGIC,
} from "../../../../src/artifacts/pyinstaller/CArchive.fixture.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

it.each([1, 129])(
  "reports the actual private-image capacity for %i compressed PYZ images",
  async (count) => {
    const root = await createTestTempDirectory("rea-artifact-capacity-");
    const path = join(root, "app.exe");
    const bytes = cArchiveExecutable({
      carrier: "pe",
      layout: "2.1",
      pythonVersion: 309,
      members: Array.from({ length: count }, (_, index) => ({
        name: `archive-${index}.pyz`,
        typeCode: "z",
        payload: pyzArchive({ magic: PYTHON_39_MAGIC, modules: [] }),
        compress: true,
      })),
    });
    await writeFile(path, bytes);
    const target = await parseBinaryTarget(path);
    if (!target.ok) throw target.error;
    const client = new ArtifactProvider({}).createClient(target.value);
    try {
      const result = await client.execute("inventory_artifact", {});
      if (count === 1) {
        expect(result.ok).toBe(true);
        return;
      }
      if (result.ok) throw new Error("Expected capacity refusal");
      expect(bytes.length).toBeLessThan(16_384);
      const projected = projectAnalysisError(result.error);
      expect(projected).toMatchObject({
        code: "truncated",
        retryable: false,
        message:
          "PyInstaller compressed PYZ images exceed the 128-file private storage budget",
        details: { boundary: "capacity" },
        remediation: {
          action: expect.stringContaining(
            "capacity reported in details.detail",
          ),
        },
      });
      expect(projected.remediation.action).not.toContain(
        "Narrow the requested path",
      );
    } finally {
      await client.close();
    }
  },
);
