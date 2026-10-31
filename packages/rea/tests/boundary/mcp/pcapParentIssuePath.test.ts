import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import type { JsonValue } from "../../../src/domain/jsonValue.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

it("locates malformed pcap parent fields beneath the analysis-view source", async () => {
  const target = { path: "example.pcap", sha256: "a".repeat(64), bytes: 24 };
  const report = {
    client: {
      tshark_command: "tshark",
      tshark_source: "path",
      tshark_version: "4.6.6",
      capinfos_command: "capinfos",
      capinfos_source: "path",
      capinfos_version: "4.6.6",
    },
    target,
    file_type: "pcap",
    encapsulation: "Ethernet",
    packet_count: 0,
    capture_start: null,
    capture_end: null,
    capture_duration_seconds: null,
    snapshot_length: null,
    endpoints: [],
    endpoint_count: 0,
    dns_queries: [],
    dns_query_count: 0,
    tls_sni_values: [],
    tls_sni_count: 0,
    protocol_distribution: [],
    protocol_count: 0,
    http_request_uris: [],
    http_request_uri_count: 0,
    http_uri_redaction_count: 0,
    unattributed_dns_addresses: [],
    unattributed_dns_address_count: 0,
    unattributed_dns_packet_count: 0,
    coverage: "complete",
    diagnostics: { tshark_stderr: "", capinfos_stderr: "" },
  };
  const parent = (result: JsonValue) =>
    createEvidence(
      { ...target, format: "file" },
      {
        id: "historical-pcap",
        name: "Historical packet capture",
        version: "1",
      },
      {
        operation: "inspect_pcap_capture",
        parameters: {},
        result,
        confidence: "derived",
        authority: "historical-reference",
      },
    );
  const session = createTestBinarySession(() => {
    throw new Error("provider must not run");
  });
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "pcap-parent-path-repro", version: "1" });
  try {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const valid = await client.callTool({
      name: "inspect_analysis_view",
      arguments: {
        source: { kind: "inline", evidence: parent(report) },
        view: { kind: "summary" },
      },
    });
    expect(valid.isError).not.toBe(true);
    const malformed = parent({ ...report, target: { ...target, path: 123 } });
    const recorded = session.recordEvidence(malformed);
    if (!recorded.ok) throw recorded.error;
    for (const source of [
      { kind: "inline", evidence: malformed },
      { kind: "retained-evidence", evidence_id: malformed.evidence_id },
    ]) {
      const result = await client.callTool({
        name: "inspect_analysis_view",
        arguments: { source, view: { kind: "summary" } },
      });
      const diagnostic = parseMcpToolError(result);
      expect(result.isError).toBe(true);
      expect(diagnostic).toMatchObject({
        error: {
          code: "invalid_request",
          category: "invalid_input",
          retryable: false,
          recovery: {
            kind: "inspect_input_contract",
            operation: "inspect_analysis_view",
          },
          details: {
            issues: [
              {
                path: ["source", "normalized_result", "target", "path"],
                reason: "invalid_type",
                expected: "string",
              },
            ],
          },
        },
      });
    }
    await client.ping();
  } finally {
    await client.close();
    await server.close();
    await session.close();
  }
});
