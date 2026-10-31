import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as v8 from "node:v8";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_BUILD_TEMPLATE_RULES,
  buildEnvironment,
} from "../../src/application/environment/environmentBuild.js";
import { evidenceFileBytes } from "../../src/application/environment/environmentEvidenceBytes.js";
import { readEnvironmentExportFile } from "../../src/application/environment/environmentExport.js";
import { createCli } from "../../src/cli.js";
import {
  analysisViewCaptureEvidence,
  environmentManifestCaptureFixture,
} from "../fixtures/analysisView.js";
import { environmentManifestHar } from "../fixtures/historicalHar.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

vi.mock("node:v8", { spy: true });

// The HAR decoder runs as a compiled child process; inspection returns the capture Evidence it decodes.
vi.mock("../../src/composition/webNetworkCaptures.js", () => ({
  createWebNetworkCaptureService: () => ({
    inspect: async () => ({
      ok: true,
      value: analysisViewCaptureEvidence(environmentManifestCaptureFixture()),
    }),
    close: async () => {},
  }),
}));

/** Every later heap reading reports no headroom. */
const starveHeap = (): void => {
  const heap = v8.getHeapStatistics();
  vi.mocked(v8.getHeapStatistics).mockImplementation(() => ({
    ...heap,
    total_available_size: 0,
  }));
};

afterEach(() => {
  vi.mocked(v8.getHeapStatistics).mockReset();
});

describe("environment build heap headroom", () => {
  it("refuses to serialize the manifest the live heap cannot hold, before writing", async () => {
    const root = await createTestTempDirectory("rea-environment-build-heap-");
    const path = join(root, "grafana.capture.json");
    await writeFile(
      path,
      evidenceFileBytes(
        analysisViewCaptureEvidence(environmentManifestCaptureFixture()),
      ),
    );
    const capture = await readEnvironmentExportFile(
      "evidence",
      path,
      "environment-build",
    );
    if (!capture.ok) throw capture.error;
    starveHeap();
    const built = await buildEnvironment({
      capture: capture.value,
      captureInput: "evidence",
      capturePath: path,
      templateRules: DEFAULT_BUILD_TEMPLATE_RULES,
      directory: join(root, "built"),
      dryRun: false,
    });
    expect(built).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisResourceConstraintError",
        operation: "environment-build",
        resource: "memory",
        reportedLimits: {
          input_path: "manifest.json",
          input_file_bytes: expect.any(Number),
          available_heap_bytes: 0,
        },
      },
    });
    expect(await readdir(root)).toEqual(["grafana.capture.json"]);
  });

  it("refuses to serialize an inspected HAR's Evidence the live heap cannot hold, before writing", async () => {
    const root = await createTestTempDirectory("rea-environment-build-heap-");
    const har = join(root, "grafana.har");
    await writeFile(har, JSON.stringify(environmentManifestHar()));
    const exitCode = process.exitCode;
    starveHeap();
    let stdout = "";
    try {
      await createCli({ REA_LOG_LEVEL: "silent" }).serve(
        ["environment-build", har, join(root, "built"), "--json"],
        {
          env: {},
          exit: () => {},
          stdout: (text) => {
            stdout += text;
          },
        },
      );
    } finally {
      process.exitCode = exitCode;
    }
    expect(JSON.parse(stdout)).toMatchObject({
      code: "resource_constraint",
      details: {
        operation: "environment-build",
        resource: "memory",
        reported_limits: { input_path: har, available_heap_bytes: 0 },
      },
    });
    expect(await readdir(root)).toEqual(["grafana.har"]);
  });
});
