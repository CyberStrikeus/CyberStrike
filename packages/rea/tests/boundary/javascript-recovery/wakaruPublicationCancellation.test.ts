import { createHash } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { expect, it, vi } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const publicationCancellation = vi.hoisted(() => ({
  controller: undefined as AbortController | undefined,
  directorySyncs: 0,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const filesystem = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...filesystem,
    open: async (...args: Parameters<typeof filesystem.open>) => {
      const handle = await filesystem.open(...args);
      if (publicationCancellation.controller !== undefined) {
        const stats = await handle.stat();
        if (stats.isDirectory()) {
          const sync = handle.sync.bind(handle);
          handle.sync = async () => {
            await sync();
            publicationCancellation.directorySyncs += 1;
            if (publicationCancellation.directorySyncs === 2)
              publicationCancellation.controller?.abort();
          };
        }
      }
      return handle;
    },
  };
});

vi.mock(
  "../../../src/javascript/recovery/WakaruCommand.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../src/javascript/recovery/WakaruCommand.js")
      >();
    return {
      ...actual,
      resolveWakaruCommand: async () => ({
        command: {
          invocationPath: "/unused/wakaru",
          resolvedPath: "/unused/wakaru",
        },
        limiter: {
          invocationPath: "/unused/prlimit",
          resolvedPath: "/unused/prlimit",
        },
        sha256: "a".repeat(64),
        bytes: 1,
      }),
    };
  },
);

vi.mock(
  "../../../src/javascript/recovery/WakaruExecution.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../src/javascript/recovery/WakaruExecution.js")
      >();
    const { createAnalysisExecution } =
      await import("../../../src/application/AnalysisProvider.js");
    return {
      ...actual,
      prepareWakaruExecution: async (
        context: Parameters<typeof actual.prepareWakaruExecution>[0],
      ) => {
        const source = context.sources[0];
        if (source === undefined) throw new Error("Missing recovery source");
        const bytes = Buffer.from("module.exports = 42;");
        await context.tree.write("module.js", Readable.from([bytes]), {
          sha256: createHash("sha256").update(bytes).digest("hex"),
          bytes: bytes.byteLength,
        });
        return createAnalysisExecution(
          { status: "complete" },
          { id: "wakaru", name: "Wakaru", version: "1.14.0" },
          {
            subject: {
              path: source.path,
              sha256: source.sha256,
              format: "javascript",
            },
          },
        );
      },
    };
  },
);

import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { WakaruProvider } from "../../../src/javascript/recovery/WakaruProvider.js";

it.skipIf(process.platform === "win32")(
  "keeps mid-commit output-tree cancellation typed through the provider",
  async () => {
    const root = await createTestTempDirectory("rea-wakaru-cancel-");
    const sourcePath = join(root, "source.js");
    const output = join(root, "output");
    await writeFile(sourcePath, "module.exports = 42;");
    const controller = new AbortController();
    publicationCancellation.controller = controller;
    publicationCancellation.directorySyncs = 0;
    const provider = new WakaruProvider({});
    try {
      const result = await provider.recover(
        {
          path: sourcePath,
          output_directory: output,
          extraction_mode: "structural",
          rewrite_level: "standard",
        },
        { signal: controller.signal },
      );
      if (result.ok) throw new Error("Expected publication cancellation");
      expect(result.error).toBeInstanceOf(AnalysisCancelledError);
      expect(projectAnalysisError(result.error).code).toBe("cancelled");
      expect(publicationCancellation.directorySyncs).toBe(2);
      await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      publicationCancellation.controller = undefined;
      publicationCancellation.directorySyncs = 0;
      await provider.close();
    }
  },
);
