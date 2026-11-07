import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, onTestFinished } from "vitest";

import type { PcapAnalysisPort } from "../../../src/application/pcap/PcapAnalysisPort.js";
import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import { assertAdvertisedMcpContracts } from "./mcpContractHarness.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { ok } from "../../../src/domain/result.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";

const identity = { id: "pcap", name: "Packet capture analysis", version: null };

const clientIdentity = {
  tshark_command: "/usr/bin/tshark",
  tshark_source: "path",
  tshark_version: "TShark (Wireshark) 4.6.6",
  tshark_resolved_path: null,
  tshark_sha256: null,
  tshark_identity_status: "unresolved",
  capinfos_command: "/usr/bin/capinfos",
  capinfos_source: "path",
  capinfos_version: "Capinfos (Wireshark) 4.6.6",
  capinfos_resolved_path: null,
  capinfos_sha256: null,
  capinfos_identity_status: "unresolved",
};

it("advertises exact valid pcap schemas and records inline evidence through MCP", async () => {
  const provider: PcapAnalysisPort = {
    async inspectAvailability() {
      return { status: "available", code: null, reason: null, diagnostics: {} };
    },
    async close() {},
    async execute(request) {
      if (request.operation === "inspect_pcap_client")
        return ok(
          createAnalysisExecution({ client: clientIdentity }, identity),
        );
      return ok(
        createAnalysisExecution(
          {
            client: clientIdentity,
            target: {
              path: "/captures/session.pcap",
              bytes: 23279,
              sha256: "a".repeat(64),
            },
            file_type: "Wireshark/tcpdump/... - pcap",
            encapsulation: "Linux cooked-mode capture v2",
            packet_count: 50,
            capture_start: "2026-10-11T14:13:40.608505Z",
            capture_end: "2026-10-11T14:13:40.981978Z",
            capture_duration_seconds: 0.373473,
            snapshot_length: 262144,
            endpoints: [
              { address: "192.168.1.100", port: null, packet_count: 30 },
              { address: "8.8.8.8", port: 53, packet_count: 5 },
            ],
            endpoint_count: 2,
            dns_queries: [
              {
                query: "example.com",
                response_addresses: ["93.184.216.34"],
                response_address_count: 1,
              },
            ],
            dns_query_count: 1,
            tls_sni_values: ["example.com"],
            tls_sni_count: 1,
            protocol_distribution: [
              { protocol: "ip:tcp:tls", packet_count: 25 },
              { protocol: "ip:udp:dns", packet_count: 5 },
            ],
            protocol_count: 2,
            http_request_uris: ["http://example.com/api"],
            http_request_uri_count: 1,
            http_uri_redaction_count: 0,
            unattributed_dns_addresses: [],
            unattributed_dns_address_count: 0,
            unattributed_dns_packet_count: 0,
            coverage: "complete",
          },
          identity,
        ),
      );
    },
  };
  const session = createTestBinarySession(() => {
    throw new Error("deep provider must not start");
  });
  const server = createServer(
    { kind: "session", session },
    { pcapAnalysis: provider },
  );
  onTestFinished(() => server.close());
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "pcap-boundary", version: "0.0.0" });
  onTestFinished(() => client.close());
  await client.connect(clientTransport);

  const { tools } = await client.listTools();
  assertAdvertisedMcpContracts(
    ["inspect_pcap_client", "inspect_pcap_capture"],
    tools,
  );

  const inspected = await client.callTool({
    name: "inspect_pcap_capture",
    arguments: { path: "/captures/session.pcap" },
  });
  expect(inspected.isError).not.toBe(true);
  const text = (inspected.content as { readonly text?: string }[])
    .map((part) => part.text ?? "")
    .join("");
  const evidence = parseEvidence(JSON.parse(text));
  expect(evidence.normalized_result).toMatchObject({
    packet_count: 50,
    capture_start: "2026-10-11T14:13:40.608505Z",
    capture_end: "2026-10-11T14:13:40.981978Z",
    tls_sni_values: ["example.com"],
    coverage: "complete",
  });
});
