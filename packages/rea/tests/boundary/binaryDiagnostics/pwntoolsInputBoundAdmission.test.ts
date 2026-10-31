import { open } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, onTestFinished } from "vitest";

import { PwntoolsLayoutProvider } from "../../../src/native/pwntools/PwntoolsLayoutProvider.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const unsupportedHost = process.platform !== "linux" || process.arch !== "x64";
const DEFAULT_INPUT_BYTES = 33_554_432;
// One byte above the shipped bound, so the admission decision is the only
// difference between the first two cases.
const ARTIFACT_BYTES = DEFAULT_INPUT_BYTES + 1;

/** Sparse regular file just larger than the shipped input bound. */
const oversizedArtifact = async (): Promise<string> => {
  const root = await createTestTempDirectory("rea-pwntools-input-bound-");
  const path = join(root, "recorded-core");
  const handle = await open(path, "w");
  await handle.truncate(ARTIFACT_BYTES);
  await handle.close();
  return path;
};

/** One admission attempt, reported as the projected caller-visible failure. */
const inspect = async (override?: string) => {
  const path = await oversizedArtifact();
  const provider = new PwntoolsLayoutProvider(
    {
      REA_PWNTOOLS_PYTHON: process.execPath,
      ...(override === undefined
        ? {}
        : { REA_PWNTOOLS_MAX_INPUT_BYTES: override }),
    },
    async (spawn) =>
      spawnOwnedProviderProcess({
        ...spawn,
        command: process.execPath,
        arguments: ["-e", "process.stdout.write('no reply')"],
      }),
  );
  onTestFinished(async () => {
    await provider.close();
  });
  const result = await provider.inspect({ path });
  if (result.ok) throw new Error("Expected the bounded decoder to fail");
  const projected = projectAnalysisError(result.error);
  return { projected, text: JSON.stringify(projected) };
};

it.runIf(!unsupportedHost)(
  "refuses an artifact above the shipped bound when no override is set",
  async () => {
    const { projected, text } = await inspect();
    expect(projected.code).toBe("invalid_request");
    expect(text).toContain(
      `Selected artifact exceeds ${String(DEFAULT_INPUT_BYTES)} bytes`,
    );
  },
);

it.runIf(!unsupportedHost)(
  "admits the same artifact once the override widens the bound",
  async () => {
    const { projected, text } = await inspect(String(ARTIFACT_BYTES));
    // Admission passed, so the only remaining failure is that the owned decoder
    // never wrote a reply, which also proves the process really ran.
    expect(text).not.toContain("Selected artifact exceeds");
    expect(projected.code).toBe("unreadable_output");
    expect(text).toContain("no reply");
  },
);

it.runIf(!unsupportedHost)(
  "refuses an unusable override before reading the artifact",
  async () => {
    const { projected, text } = await inspect("0");
    expect(projected.code).toBe("provider_unavailable");
    expect(projected.details).toMatchObject({
      rejections: [
        { diagnostics: { configuration_key: "REA_PWNTOOLS_MAX_INPUT_BYTES" } },
      ],
    });
    expect(text).toContain("REA_PWNTOOLS_MAX_INPUT_BYTES must be a decimal");
    expect(text).not.toContain("Selected artifact exceeds");
  },
);
