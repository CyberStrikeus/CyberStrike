import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { bundleComparisonResultSchema } from "../../src/domain/bundleComparison.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { parseEvidenceBundle } from "../../src/domain/evidenceBundle.js";
import { pcapResultSchemas } from "../../src/domain/pcap/pcapAnalysis.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { offlineHttpCapture } from "../fixtures/pcap/offlineHttpCapture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

it.skipIf(
  process.platform !== "linux" ||
    !existsSync("/usr/bin/tshark") ||
    !existsSync("/usr/bin/capinfos"),
)(
  "admits real TShark Evidence and explicit bundle pairs without losing identity or source bytes",
  async () => {
    const root = await createTestTempDirectory("rea-input-capacity-pcap-");
    const path = join(root, "owned.pcap");
    const uri = "http://example.test/a?value=keep%2Fthis";
    const bytes = offlineHttpCapture(uri);
    const digest = createHash("sha256").update(bytes).digest("hex");
    await writeFile(path, bytes);
    const { client } = await connectLocalToolsMcp(
      {
        HOME: root,
        USERPROFILE: root,
        XDG_CONFIG_HOME: join(root, "config"),
        XDG_CACHE_HOME: join(root, "cache"),
        XDG_DATA_HOME: join(root, "data"),
        REA_TSHARK_COMMAND: "/usr/bin/tshark",
        REA_CAPINFOS_COMMAND: "/usr/bin/capinfos",
        REA_MCP_OUTPUT_SCHEMA_PROFILE: "off",
        NODE_OPTIONS: "--max-old-space-size=3072",
      },
      onTestFinished,
    );
    const captured = await client.callTool({
      name: "inspect_pcap_capture",
      arguments: { path },
    });
    expect(captured.isError).not.toBe(true);
    const record = parseEvidence(captured.structuredContent);
    const facts = pcapResultSchemas.inspect_pcap_capture.parse(
      record.normalized_result,
    );
    expect(facts.http_request_uris).toEqual([uri]);
    expect(facts.target.path).toBe(path);
    const bundlePath = join(root, "recorded.json");
    const exported = await client.callTool({
      name: "export_evidence_bundle",
      arguments: { path: bundlePath },
    });
    expect(exported.isError).not.toBe(true);
    const bundle = parseEvidenceBundle(
      JSON.parse(await readFile(bundlePath, "utf8")),
    );
    expect(
      bundle.records.find((item) => item.evidence_id === record.evidence_id),
    ).toEqual(record);
    const response = await client.callTool({
      name: "compare_bundles",
      arguments: {
        left_bundle_path: bundlePath,
        right_bundle_path: bundlePath,
        record_pairs: [
          {
            left_evidence_id: record.evidence_id,
            right_evidence_id: record.evidence_id,
          },
        ],
      },
    });
    expect(response.isError).not.toBe(true);
    const comparison = bundleComparisonResultSchema.parse(
      parseEvidence(response.structuredContent).normalized_result,
    );
    expect(comparison.summary).toMatchObject({
      records_unchanged: bundle.records.length,
      records_changed: 0,
      records_added: 0,
      records_removed: 0,
    });
    expect(comparison.left_bundle_sha256).toBe(comparison.right_bundle_sha256);
    expect(comparison.changes).toEqual([]);
    expect(
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    ).toBe(digest);
  },
  90_000,
);
