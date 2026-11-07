import { expect, it } from "vitest";
import { createEvidence } from "../evidence.js";
import {
  projectAnalysisView,
  type AnalysisViewParent,
} from "./analysisView.js";

const capture = (
  tsharkStderr: string,
  dnsQueries: {
    query: string;
    query_labels_hex?: string[] | null;
    response_addresses: string[];
    response_address_count: number;
  }[] = [],
): AnalysisViewParent => {
  const target = {
    path: "/recordings/input.pcap",
    sha256: "c".repeat(64),
    bytes: 24,
  };
  const report = {
    client: {
      tshark_command: "/usr/bin/tshark",
      tshark_source: "path",
      tshark_version: "4.6.6",
      capinfos_command: "/usr/bin/capinfos",
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
    dns_queries: dnsQueries,
    dns_query_count: dnsQueries.length,
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
    diagnostics: { capinfos_stderr: "", tshark_stderr: tsharkStderr },
  };
  const evidence = createEvidence(
    { ...target, format: "file" },
    { id: "fixture", name: "Fixture", version: "1" },
    {
      operation: "inspect_pcap_capture",
      parameters: { path: target.path },
      result: report,
      confidence: "derived",
      authority: "historical-reference",
    },
  );
  return {
    evidenceId: evidence.evidence_id,
    operation: evidence.operation,
    normalizedResult: report,
    subject: evidence.subject,
    limitations: evidence.limitations,
  };
};

const diagnostics = (offset: number, limit: number) =>
  ({
    kind: "pcap",
    facet: "diagnostics",
    stream: "tshark",
    offset,
    limit,
  }) as const;

it("reads historical capture Evidence without inventing executable identity", () => {
  const result = projectAnalysisView(capture(""), { kind: "summary" });
  if (!result.ok) throw result.error;
  if (result.value.kind !== "summary")
    throw new Error("Expected a packet summary.");
  if (!("client" in result.value.summary))
    throw new Error("Expected packet client facts.");
  expect(result.value.summary.client).toMatchObject({
    tshark_resolved_path: null,
    tshark_sha256: null,
    tshark_identity_status: "unresolved",
    capinfos_resolved_path: null,
    capinfos_sha256: null,
    capinfos_identity_status: "unresolved",
  });
});

it("pages diagnostics without splitting a surrogate pair", () => {
  const parent = capture("ab😀cd");
  expect(projectAnalysisView(parent, diagnostics(3, 2))).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisInputError" },
  });
  const first = projectAnalysisView(parent, diagnostics(0, 3));
  if (!first.ok) throw first.error;
  expect(first.value).toMatchObject({
    page: { facet: "diagnostics", text: "ab", status: "retained" },
    coverage: { examined: 2, total: 6, next_offset: 2 },
  });
  let text = "";
  for (let offset: number | null = 0; offset !== null;) {
    const page = projectAnalysisView(parent, diagnostics(offset, 3));
    if (!page.ok) throw page.error;
    if (page.value.kind !== "pcap" || page.value.page.facet !== "diagnostics")
      throw new Error("Expected a diagnostics page.");
    text += page.value.page.text;
    offset = page.value.coverage.next_offset;
  }
  expect(text).toBe("ab😀cd");
});

it("selects colliding DNS displays by label identity and retains unknown occurrences", () => {
  const parent = capture("", [
    {
      query: "a.b",
      query_labels_hex: ["612e62"],
      response_addresses: ["192.0.2.1"],
      response_address_count: 1,
    },
    {
      query: "a.b",
      query_labels_hex: ["61", "62"],
      response_addresses: ["192.0.2.2"],
      response_address_count: 1,
    },
    {
      query: "a.b",
      query_labels_hex: null,
      response_addresses: ["192.0.2.3"],
      response_address_count: 1,
    },
    {
      query: "a.b",
      query_labels_hex: null,
      response_addresses: ["192.0.2.4"],
      response_address_count: 1,
    },
  ]);
  const view = {
    kind: "pcap",
    facet: "dns-addresses",
    query: "a.b",
    offset: 0,
    limit: 64,
  } as const;
  expect(projectAnalysisView(parent, view)).toMatchObject({ ok: false });
  expect(
    projectAnalysisView(parent, { ...view, query_labels_hex: ["61", "62"] }),
  ).toMatchObject({ ok: true, value: { page: { items: ["192.0.2.2"] } } });
  expect(
    projectAnalysisView(parent, { ...view, query_index: 3 }),
  ).toMatchObject({ ok: true, value: { page: { items: ["192.0.2.4"] } } });
});

it("keeps historical DNS records accessible without inventing label identity", () => {
  const parent = capture("", [
    {
      query: "old.example",
      response_addresses: ["192.0.2.9"],
      response_address_count: 1,
    },
  ]);
  expect(
    projectAnalysisView(parent, {
      kind: "pcap",
      facet: "dns-addresses",
      query: "old.example",
      offset: 0,
      limit: 64,
    }),
  ).toMatchObject({ ok: true, value: { page: { items: ["192.0.2.9"] } } });
});
