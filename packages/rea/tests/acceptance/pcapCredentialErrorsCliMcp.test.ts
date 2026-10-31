import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { z } from "zod";
import { analysisErrorProjectionSchema } from "../../src/contracts/errorSchemas.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { parseEvidenceBundle } from "../../src/domain/evidenceBundle.js";
import { pcapResultSchemas } from "../../src/domain/pcap/pcapAnalysis.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { offlineHttpCapture } from "../fixtures/pcap/offlineHttpCapture.js";
import { cliTest } from "../support/cli/cliFixture.js";

const missingNative =
  process.platform !== "linux" ||
  !existsSync("/usr/bin/tshark") ||
  !existsSync("/usr/bin/capinfos");
const credential = "SYNTHETIC_PCAP_AUTH_83A4";
const uri = `http://user:${credential}@example.test/a/../b?value=keep%2Fthis`;
const safeUri = "http://example.test/a/../b?value=keep%2Fthis";
const environmentFor = (root: string) => ({
  REA_TSHARK_COMMAND: "/usr/bin/tshark",
  REA_CAPINFOS_COMMAND: "/usr/bin/capinfos",
  HOME: root,
  USERPROFILE: root,
  XDG_CONFIG_HOME: join(root, "config"),
  XDG_CACHE_HOME: join(root, "cache"),
  XDG_DATA_HOME: join(root, "data"),
});
const verifyOriginalError = (document: unknown) => {
  const error = analysisErrorProjectionSchema.parse(document);
  expect(error.code).toBe("resource_constraint");
  const facts = z
    .object({
      resource: z.literal("memory"),
      reported_limits: z.object({
        max_output_bytes: z.literal(8 * 1024 * 1024),
      }),
      captured_output: z.object({
        stdout: z.string(),
        stdout_bytes: z.literal(8 * 1024 * 1024),
        truncated: z.literal(true),
      }),
    })
    .parse(error.details);
  expect(facts.captured_output.stdout.includes(credential)).toBe(false);
  expect(facts.captured_output.stdout.includes(safeUri)).toBe(true);
  expect(facts.captured_output.stdout.includes('"ip.src"')).toBe(true);
};

cliTest.skipIf(missingNative)(
  "keeps real pcap success and output-limit CLI Evidence credential-safe",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-pcap-private-cli-");
    const single = join(root, "single.pcap");
    await writeFile(single, offlineHttpCapture(uri));
    const success = await cli.run({
      arguments: ["inspect-pcap-capture", single, "--json"],
      environment: environmentFor(root),
      timeoutMs: 60_000,
    });
    expect(success.exitCode, success.stderr).toBe(0);
    expect(success.stdout.includes(credential)).toBe(false);
    const result = pcapResultSchemas.inspect_pcap_capture.parse(
      parseEvidence(success.json).normalized_result,
    );
    expect(result.http_request_uris).toEqual([safeUri]);
    expect(result.http_request_uri_count).toBe(1);
    expect(result.http_uri_redaction_count).toBe(1);
    expect(result.target.path).toBe(single);
    const many = join(root, "many.pcap");
    const bytes = offlineHttpCapture(uri, 40_000);
    const before = createHash("sha256").update(bytes).digest("hex");
    await writeFile(many, bytes);
    const failed = await cli.run({
      arguments: ["inspect-pcap-capture", many, "--json"],
      environment: environmentFor(root),
      timeoutMs: 60_000,
    });
    expect(failed.exitCode, failed.stderr).toBe(1);
    expect(failed.stdout.includes(credential)).toBe(false);
    verifyOriginalError(failed.json);
    expect(
      createHash("sha256")
        .update(await readFile(many))
        .digest("hex"),
    ).toBe(before);
  },
  120_000,
);

it.skipIf(missingNative)(
  "keeps real pcap MCP errors and exported retained errors credential-safe",
  async () => {
    const root = await createTestTempDirectory("rea-pcap-private-mcp-");
    const path = join(root, "many.pcap");
    await writeFile(path, offlineHttpCapture(uri, 40_000));
    for (const direct of [true, false]) {
      const environment = {
        ...environmentFor(root),
        ...(direct
          ? { REA_MCP_MAX_RESPONSE_BYTES: String(20 * 1024 * 1024) }
          : {}),
      };
      const { client, call } = await connectLocalToolsMcp(
        environment,
        onTestFinished,
        { maxBufferSize: 32 * 1024 * 1024 },
      );
      try {
        const response = await call("inspect_pcap_capture", { path });
        expect(JSON.stringify(response).includes(credential)).toBe(false);
        const error = parseMcpToolError(response).error;
        if (direct) verifyOriginalError(error);
        else {
          expect(error.code).toBe("resource_constraint");
          const bundlePath = join(root, "retained-errors.json");
          const exported = await call("export_evidence_bundle", {
            path: bundlePath,
          });
          expect(exported.isError).not.toBe(true);
          const text = await readFile(bundlePath, "utf8");
          expect(text.includes(credential)).toBe(false);
          const bundle = parseEvidenceBundle(JSON.parse(text));
          const retained = bundle.records.find(
            (record) => record.operation === "mcp_tool_error",
          );
          if (retained === undefined)
            throw new Error("Original oversized error was not retained");
          verifyOriginalError(
            z
              .object({ error: analysisErrorProjectionSchema })
              .parse(retained.normalized_result).error,
          );
        }
      } finally {
        await client.close();
      }
    }
  },
  120_000,
);
