import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { build } from "plist";
import { expect, it } from "vitest";

import { ArtifactProvider } from "../../../src/artifacts/ArtifactProvider.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.each(["bundle", "standalone"] as const)(
  "preserves selector schema failures through the %s provider boundary",
  async (kind) => {
    const bundle = await createTestTempDirectory("rea-keyed-input-");
    await mkdir(join(bundle, "Resources"));
    const info = join(bundle, "Info.plist");
    await writeFile(info, build({ CFBundleIdentifier: "org.example.static" }));
    const path = join(bundle, "Resources", "Model.plist");
    const bytes = build({
      $archiver: "NSKeyedArchiver",
      $version: 100000,
      $objects: ["$null", "leaf"],
      $top: { root: { CF$UID: 1 } },
    });
    await writeFile(path, bytes);
    const provider = new ArtifactProvider({}, "linux");
    const client =
      kind === "bundle"
        ? provider.createBundleResourceClient({
            callerPath: bundle,
            canonicalPath: bundle,
            infoPlistPath: info,
            layout: "root",
            executableSha256: null,
          })
        : provider.createClient({
            path,
            sha256: createHash("sha256").update(bytes).digest("hex"),
            kind: "artifact",
            format: "plist",
          });
    try {
      for (const [path, reason] of [
        ["", "out_of_range"],
        ["Model\u0000.plist", "invalid_format"],
      ] as const) {
        const result = await client.execute("inspect_keyed_archive", { path });
        if (result.ok) throw new Error("Expected invalid selector refusal");
        expect(projectAnalysisError(result.error)).toMatchObject({
          code: "invalid_request",
          category: "invalid_input",
          recovery: {
            kind: "inspect_input_contract",
            operation: "inspect_keyed_archive",
          },
          details: { issues: [{ path: ["path"], reason }] },
        });
      }
      const valid = await client.execute("inspect_keyed_archive", {
        path: kind === "bundle" ? "Resources/Model.plist" : ".",
      });
      if (!valid.ok) throw valid.error;
      expect(valid.value.result).toMatchObject({ total_objects: 2 });
    } finally {
      const closed = await client.close();
      if (!closed.ok) throw closed.error;
    }
  },
);
