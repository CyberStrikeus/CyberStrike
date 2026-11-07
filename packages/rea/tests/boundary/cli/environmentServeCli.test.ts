import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { inspectAnalysisView } from "../../../src/application/analysisView/AnalysisViewService.js";
import { loadEnvironmentSource } from "../../../src/application/environment/environmentSource.js";

import {
  analysisViewCaptureEvidence,
  analysisViewCaptureFixture,
  environmentManifestCaptureFixture,
} from "../../fixtures/analysisView.js";
import {
  environmentServeSource,
  writeEnvironmentServeFiles,
} from "../../fixtures/environmentServe.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

describe("rea environment-serve refusals", () => {
  cliTest(
    "refuses a manifest whose parent is not the supplied evidence with a typed invalid request",
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-environment-serve-cli-");
      const files = await writeEnvironmentServeFiles(root);
      const other = join(root, "other.json");
      await writeFile(
        other,
        JSON.stringify(
          analysisViewCaptureEvidence(analysisViewCaptureFixture()),
        ),
      );
      const result = await cli.run({
        arguments: [
          "environment-serve",
          files.manifestPath,
          "--evidence",
          other,
          "--port",
          "0",
          "--json",
        ],
        timeoutMs: 30_000,
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        error: "Application workflow failed",
        code: "invalid_request",
        category: "invalid_input",
        details: {
          operation: "environment-serve",
          issues: [{ path: ["evidence", "evidence_id"] }],
        },
      });
      expect(result.stdout).toContain("different capture");
    },
  );

  cliTest(
    "reports a missing --evidence option as a usage error",
    async ({ cli }) => {
      const root = await createTestTempDirectory(
        "rea-environment-serve-usage-",
      );
      const files = await writeEnvironmentServeFiles(root);
      const result = await cli.run({
        arguments: ["environment-serve", files.manifestPath, "--json"],
        timeoutMs: 30_000,
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "VALIDATION_ERROR",
        fieldErrors: [{ path: "evidence", missing: true }],
      });
    },
  );

  cliTest(
    "refuses an unreadable manifest path before binding",
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-environment-serve-path-");
      const files = await writeEnvironmentServeFiles(root);
      const result = await cli.run({
        arguments: [
          "environment-serve",
          join(root, "missing.json"),
          "--evidence",
          files.capturePath,
          "--json",
        ],
        timeoutMs: 30_000,
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        error: "Application workflow failed",
        code: "invalid_request",
        input_path: join(root, "missing.json"),
        input_reason: "read-failed",
        details: { operation: "environment-serve" },
      });
    },
  );
});

cliTest(
  "refuses a fully authenticated capture whose discovery exceeds capacity before listening",
  async ({ cli }) => {
    const records = environmentManifestCaptureFixture();
    const ordinal = environmentServeSource().manifest.tools.find(
      (tool) => tool.name === "get_users_by_id",
    )?.record_ordinals[0];
    const first = records.records.find((record) => record.ordinal === ordinal);
    if (first === undefined) throw new Error("Fixture has no cited API record");
    const reported = first.reported;
    if (
      typeof reported !== "object" ||
      reported === null ||
      Array.isArray(reported)
    )
      throw new Error("Fixture has no reported request");
    const request = reported.request;
    if (
      typeof request !== "object" ||
      request === null ||
      Array.isArray(request)
    )
      throw new Error("Fixture has no request object");
    if (typeof request.url !== "string") throw new Error("Fixture has no URL");
    const url = new URL(request.url);
    const query = new URLSearchParams(url.search);
    for (let index = 0; index < 10000; index += 1)
      query.append(`q_${index}`, "x");
    url.search = query.toString();
    request.url = url.href;
    const capture = analysisViewCaptureEvidence(records);
    const manifest = await inspectAnalysisView({
      source: { kind: "inline", evidence: capture },
      view: { kind: "environment-manifest" },
    });
    if (!manifest.ok) throw manifest.error;
    const source = loadEnvironmentSource(manifest.value, capture);
    if (!source.ok) throw source.error;
    expect(
      source.value.manifest.tools.some(
        (tool) => tool.query_parameter_names.length >= 10000,
      ),
    ).toBe(true);
    const root = await createTestTempDirectory(
      "rea-environment-catalog-capacity-",
    );
    const files = await writeEnvironmentServeFiles(root, {
      capture,
      manifest: manifest.value,
    });
    const result = await cli.run({
      arguments: [
        "environment-serve",
        files.manifestPath,
        "--evidence",
        files.capturePath,
        "--port",
        "0",
        "--json",
      ],
      timeoutMs: 30000,
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "resource_constraint",
      details: { operation: "environment-serve", resource: "capacity" },
    });
    expect(result.stderr).not.toContain("MCP transport listening");
  },
);
