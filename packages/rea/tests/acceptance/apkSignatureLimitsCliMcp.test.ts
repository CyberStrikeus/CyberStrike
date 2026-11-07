import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { parseEvidence } from "../../src/domain/evidence.js";
import { analysisErrorProjectionSchema } from "../../src/contracts/errorSchemas.js";
import { apkSignatureSummaryViewResultSchema } from "../../src/domain/analysisView/analysisView.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import {
  withSigningBlock,
  zipWith,
} from "../fixtures/apkSignature/v1SignatureBlock.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest(
  "keeps fixed APK pair refusals nonretryable through CLI and MCP, then accepts a valid input",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-apk-pair-limit-");
    const archive = await zipWith([
      { name: "AndroidManifest.xml", data: Uint8Array.of(3, 0, 8, 0) },
    ]);
    const paths = new Map<number, string>();
    const digests = new Map<number, string>();
    for (const count of [1, 4096, 4097]) {
      const path = join(root, `pairs-${count}.apk`);
      const bytes = withSigningBlock(
        archive,
        Array.from({ length: count }, () => ({
          id: 0xffffffff,
          value: new Uint8Array(),
        })),
      );
      await writeFile(path, bytes);
      digests.set(count, createHash("sha256").update(bytes).digest("hex"));
      paths.set(count, path);
    }
    const expected = {
      code: "resource_constraint",
      category: "resource_constraint",
      retryable: false,
      details: {
        operation: "inspect_apk_signature",
        resource: "capacity",
        reported_limits: { max_signing_block_pairs: 4096 },
      },
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = await cli.run({
        arguments: ["inspect-apk-signature", paths.get(4097)!, "--json"],
      });
      expect(reply.exitCode, reply.stderr).toBe(1);
      const error = analysisErrorProjectionSchema.parse(reply.json);
      expect(error).toMatchObject(expected);
      expect(error.remediation.action).toContain("4096");
      expect(error.remediation.action).toContain("no runtime override");
      expect(error.remediation.action).toContain(
        "Waiting for an active analysis to finish does not raise it",
      );
    }
    const { call } = await connectLocalToolsMcp({
      REA_MCP_OUTPUT_SCHEMA_PROFILE: "off",
    });
    const rejected = await call("inspect_apk_signature", {
      path: paths.get(4097),
    });
    expect(parseMcpToolError(rejected).error).toMatchObject(expected);
    for (const count of [4096, 1]) {
      const path = paths.get(count)!;
      const reply = await call("inspect_apk_signature", { path });
      expect(reply.isError, JSON.stringify(reply.content)).not.toBe(true);
      const report = apkSignatureSummaryViewResultSchema.parse(
        parseEvidence(reply.structuredContent).normalized_result,
      ).summary;
      expect(report.artifact.path).toBe(path);
      expect(report.artifact.sha256).toBe(digests.get(count));
      expect(report.posture.strongest_scheme).toBe("none");
    }
  },
);
