import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { ProviderProcessSnapshot } from "../../src/process/ProviderProcess.js";
import { join } from "node:path";

export const createArtifact = async (): Promise<{
  directory: string;
  path: string;
}> => {
  const directory = await mkdtemp(join(tmpdir(), "rea-reverse-edge-"));
  const path = join(directory, "sample.bin");
  await writeFile(path, "initial artifact");
  return { directory, path };
};

export const providerSnapshot = (
  overrides: Partial<ProviderProcessSnapshot> = {},
): ProviderProcessSnapshot => ({
  stdout: { text: "captured owned output", bytes: 21, observedBytes: 21 },
  stderr: { text: "diagnostic", bytes: 10, observedBytes: 10 },
  exitCode: 0,
  signal: null,
  ...overrides,
});
