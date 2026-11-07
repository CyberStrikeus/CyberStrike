import { readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { exportEvidenceBundleCommand } from "../../../src/application/EvidenceBundleCommands.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

// Host filesystems cannot fail publication and then one staging removal on
// demand; every other export step runs on the real filesystem.
const fault = vi.hoisted(() => ({
  publication: false,
  stagingRemovalFailures: 0,
  stagingRemovals: 0,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const filesystem = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...filesystem,
    link: async (...args: Parameters<typeof filesystem.link>) => {
      if (fault.publication)
        throw Object.assign(new Error("injected publication EACCES"), {
          code: "EACCES",
        });
      return filesystem.link(...args);
    },
    rmdir: async (...args: Parameters<typeof filesystem.rmdir>) => {
      if (String(args[0]).includes(".rea-write-")) {
        fault.stagingRemovals += 1;
        if (fault.stagingRemovals <= fault.stagingRemovalFailures)
          throw Object.assign(new Error("injected staging removal EBUSY"), {
            code: "EBUSY",
          });
      }
      return filesystem.rmdir(...args);
    },
  };
});

const emptyBundle = JSON.stringify({
  artifacts: [],
  providers: [],
  environments: [],
  scenarios: [],
  captures: [],
  unknowns: [],
  records: [],
});

it.each([
  {
    name: "restores the publication failure after a confirmed staging retry",
    publication: true,
    stagingRemovalFailures: 1,
    stagingRemovals: 2,
    code: "execution_failure",
    retained: false,
  },
  {
    name: "keeps cleanup incomplete with its stage when the retry also fails",
    publication: true,
    stagingRemovalFailures: 2,
    stagingRemovals: 2,
    code: "cleanup_incomplete",
    retained: true,
  },
  {
    name: "returns the published receipt after a confirmed staging retry",
    publication: false,
    stagingRemovalFailures: 1,
    stagingRemovals: 2,
    code: undefined,
    retained: false,
  },
])("$name", async (scenario) => {
  const root = await createTestTempDirectory("rea-export-cleanup-retry-");
  const source = join(root, "source.json");
  const output = join(root, "out.json");
  await writeFile(source, emptyBundle);
  Object.assign(fault, {
    publication: scenario.publication,
    stagingRemovalFailures: scenario.stagingRemovalFailures,
    stagingRemovals: 0,
  });
  try {
    const result = await exportEvidenceBundleCommand(source, output, false);
    expect(fault.stagingRemovals).toBe(scenario.stagingRemovals);
    const entries = await readdir(root);
    const stages = entries.filter((entry) => entry.startsWith(".rea-write-"));
    expect(stages).toHaveLength(scenario.retained ? 1 : 0);
    expect(entries.includes("out.json")).toBe(!scenario.publication);
    if (scenario.code === undefined) {
      expect(result).toMatchObject({
        ok: true,
        value: { path: output, records: 0 },
      });
      return;
    }
    if (result.ok) throw new Error("Expected export failure");
    const projected = projectAnalysisError(result.error);
    expect(projected.code).toBe(scenario.code);
    expect(projected.details).toMatchObject({
      operation: "write",
      reason: "io",
      path: output,
    });
    if (!scenario.retained) {
      expect(projected.details).not.toHaveProperty("cleanup");
      expect(projected.details).not.toHaveProperty("resources");
      return;
    }
    expect(projected.details).toMatchObject({
      cleanup: "incomplete",
      cleanup_reason: "injected staging removal EBUSY",
      execution_failure: "execution_failure",
      resources: [join(root, stages[0]!)],
    });
  } finally {
    Object.assign(fault, { publication: false, stagingRemovalFailures: 0 });
    await rm(root, { recursive: true, force: true });
  }
});
