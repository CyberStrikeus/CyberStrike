import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { z } from "zod";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { evidenceBundleSchema } from "../../../src/domain/evidenceBundle.js";
import { webNetworkCaptureSchema } from "../../../src/domain/webNetworkCapture.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { historicalHar } from "../../fixtures/historicalHar.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

cliTest(
  "retains a 4 MiB canonical HAR body through CLI and MCP evidence export",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-large-base64-har-");
    const path = join(root, "capture.har");
    const body = Buffer.alloc(4 * 1024 * 1024, 0x5a);
    const contentBase64 = body.toString("base64");
    const fixture = historicalHar();
    const entry = fixture.log.entries[0];
    if (entry === undefined) throw new Error("HAR fixture has no entry");
    const original = Buffer.from(
      JSON.stringify({
        log: {
          ...fixture.log,
          entries: [
            {
              ...entry,
              response: {
                ...entry.response,
                content: {
                  size: body.length,
                  mimeType: "application/octet-stream",
                  encoding: "base64",
                  text: contentBase64,
                },
              },
            },
          ],
        },
      }),
    );
    await writeFile(path, original);

    const summarize = (document: unknown) => {
      const evidence = parseEvidence(document);
      const capture = webNetworkCaptureSchema.parse(evidence.normalized_result);
      const record = capture.records[0];
      const binary = record?.binary_fields[0];
      if (record === undefined || binary === undefined)
        throw new Error("HAR evidence omitted its binary sidecar");
      if (binary.state !== "retained")
        throw new Error(`HAR binary sidecar was ${binary.state}`);
      const reported = z
        .object({
          response: z.object({ content: z.object({ text: z.string() }) }),
        })
        .parse(record.reported);
      const retainedBytes = Buffer.from(binary.content_base64, "base64");
      return {
        state: binary.state,
        bytes: binary.bytes,
        sha256: binary.sha256,
        contentBase64Length: binary.content_base64.length,
        contentBase64Sha256: sha256(binary.content_base64),
        decodedLength: retainedBytes.length,
        decodedSha256: sha256(retainedBytes),
        reportedTextLength: reported.response.content.text.length,
        reportedTextSha256: sha256(reported.response.content.text),
      };
    };
    const expected = {
      state: "retained",
      bytes: body.length,
      sha256: sha256(body),
      contentBase64Length: contentBase64.length,
      contentBase64Sha256: sha256(contentBase64),
      decodedLength: body.length,
      decodedSha256: sha256(body),
      reportedTextLength: contentBase64.length,
      reportedTextSha256: sha256(contentBase64),
    };

    const fromCli = await cli.run({
      arguments: ["inspect-web-network-capture", path, "har", "--json"],
      timeoutMs: 120_000,
    });
    expect(fromCli.exitCode).toBe(0);
    const cliSummary = summarize(fromCli.json);

    const { call } = await connectLocalToolsMcp();
    const response = await call("inspect_web_network_capture", {
      capture_path: path,
      format: "har",
    });
    const { evidence_reference: reference } = z
      .object({
        error: z.object({
          code: z.literal("resource_constraint"),
          details: z.object({
            reported_limits: z.object({
              boundary: z.literal("mcp-response"),
              constraint: z.literal("receive-buffer"),
              evidence_reference: z.object({
                kind: z.literal("retained-evidence"),
                evidence_id: z.string(),
              }),
            }),
          }),
        }),
      })
      .parse(parseMcpToolError(response)).error.details.reported_limits;
    const bundlePath = join(root, "evidence.json");
    const exported = await call("export_evidence_bundle", { path: bundlePath });
    expect(exported.isError).not.toBe(true);
    const bundle = evidenceBundleSchema.parse(
      JSON.parse(await readFile(bundlePath, "utf8")),
    );
    const retained = bundle.records.find(
      (record) => record.evidence_id === reference.evidence_id,
    );
    expect(retained).toBeDefined();
    const mcpSummary = summarize(retained);

    expect(cliSummary).toEqual(expected);
    expect(mcpSummary).toEqual(expected);
    const unchanged = await readFile(path);
    expect(unchanged.byteLength).toBe(original.byteLength);
    expect(sha256(unchanged)).toBe(sha256(original));
  },
);
