import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { PrivateRuntimeRoot } from "../../src/process/PrivateRuntimeRoot.js";
import type { ProcessCleanupResult } from "../../src/process/ProcessOwnership.js";
import { spawnOwnedProviderProcess } from "../../src/process/ProviderProcess.js";

/** Allocate the same private runtime boundary used by the real Ghidra client. */
export const createGhidraTestRuntime = (
  parent: string,
): Promise<PrivateRuntimeRoot> =>
  PrivateRuntimeRoot.create({ parent, prefix: "rea-ghidra-test-" });

/** Publish a closed endpoint file with the provider child's actual file owner. */
export const publishGhidraTestEndpoint = async (
  runtime: PrivateRuntimeRoot,
  content: string,
): Promise<string> => {
  const path = join(runtime.path, "bridge-endpoint.json");
  if (process.platform !== "win32") {
    await writeFile(path, content, { flag: "wx" });
    return path;
  }
  const launched = await spawnOwnedProviderProcess({
    command: process.execPath,
    arguments: [
      "-e",
      "require('node:fs').writeFileSync(process.argv[1],process.argv[2],{flag:'wx'})",
      path,
      content,
    ],
    runId: randomUUID(),
  });
  let cleanup: ProcessCleanupResult | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      launched.process.once("error", reject);
      launched.process.once("close", (code: number | null) => {
        if (code === 0) resolve();
        else reject(new Error(`Endpoint fixture exited with code ${code}`));
      });
    });
  } finally {
    cleanup = await launched.cleanup?.();
  }
  if (cleanup?.cleaned !== true)
    throw new Error("Endpoint fixture process cleanup was not verified");
  return path;
};
