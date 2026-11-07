import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { expect, it } from "vitest";

import { createAnalysisExecution } from "../AnalysisProvider.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import { parseEvidence } from "../../domain/evidence.js";
import { pcapResultSchemas } from "../../domain/pcap/pcapAnalysis.js";
import { err, ok } from "../../domain/result.js";

import { PcapAnalysisService } from "./PcapAnalysisService.js";

it("preserves the exact caller reason when pcap admission is already aborted", async () => {
  const reason = Object.freeze({ requested: "stop" });
  const controller = new AbortController();
  controller.abort(reason);
  let calls = 0;
  const service = new PcapAnalysisService({
    inspectAvailability: () => Promise.reject(new Error("unused")),
    close: () => Promise.resolve(),
    execute: () => {
      calls += 1;
      return Promise.reject(new Error("provider must not run"));
    },
  });
  const result = await service.execute(
    "inspect_pcap_client",
    {},
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(result.error.cause).toBe(reason);
  expect(calls).toBe(0);
});

const identity = {
  id: "pcap",
  name: "Packet capture analysis",
  version: "test",
};
const path = "/captures/selected.pcap";
const target = { path, bytes: 24, sha256: "c".repeat(64) };
const client = {
  tshark_command: "/selected/tshark",
  tshark_source: "environment",
  tshark_version: "4.6.6",
  tshark_resolved_path: null,
  tshark_sha256: null,
  tshark_identity_status: "unresolved",
  capinfos_command: "/selected/capinfos",
  capinfos_source: "environment",
  capinfos_version: "4.6.6",
  capinfos_resolved_path: null,
  capinfos_sha256: null,
  capinfos_identity_status: "unresolved",
};
const capture = {
  client,
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
};

it.each(["inspect_pcap_client", "inspect_pcap_capture"] as const)(
  "retains completed %s Evidence if cancellation arrives at application handoff",
  async (operation) => {
    const reason = Object.freeze({
      requested: "stop after completed observation",
    });
    for (const aborted of [false, true]) {
      const controller = new AbortController();
      const execution = createAnalysisExecution(
        operation === "inspect_pcap_client" ? { client } : capture,
        identity,
        {
          ...(operation === "inspect_pcap_capture"
            ? {
                subject: {
                  path,
                  sha256: target.sha256,
                  format: "file" as const,
                },
              }
            : {}),
          limitations: ["Fixture observation; no live tool verification"],
          rawResult: { selected_output: "preserved" },
        },
      );
      const service = new PcapAnalysisService({
        inspectAvailability: () => Promise.reject(new Error("unused")),
        close: async () => {},
        execute: async () => {
          if (aborted) controller.abort(reason);
          return ok(execution);
        },
      });
      const result = await service.execute(
        operation,
        operation === "inspect_pcap_client" ? {} : { path },
        { signal: controller.signal },
      );
      const observation = result.ok
        ? result.value
        : result.error.partialObservation;
      if (aborted) {
        if (result.ok)
          throw new Error("Expected cancellation after provider completion");
        expect(result.error._tag).toBe("AnalysisCancelledError");
        expect(result.error.cause).toBe(reason);
      } else if (!result.ok) throw result.error;
      const evidence = parseEvidence(observation);
      expect(evidence.operation).toBe(operation);
      expect(evidence.provider).toEqual(identity);
      expect(evidence.raw_result).toEqual({ selected_output: "preserved" });
      expect(evidence.limitations).toContain(
        "Fixture observation; no live tool verification",
      );
      expect(evidence.parameters).toEqual(
        operation === "inspect_pcap_client" ? {} : { path },
      );
      expect(evidence.normalized_result).toEqual(
        operation === "inspect_pcap_client" ? { client } : capture,
      );
      expect(evidence.confidence).toBe(
        operation === "inspect_pcap_capture" ? "derived" : "observed",
      );
      if (operation === "inspect_pcap_capture") {
        expect(evidence.authority).toBe("historical-reference");
        expect(evidence.subject).toMatchObject({
          local_path: path,
          digest: { sha256: target.sha256 },
        });
      }
      pcapResultSchemas[operation].parse(evidence.normalized_result);
    }
  },
);

it.each(["inspect_pcap_client", "inspect_pcap_capture"] as const)(
  "preserves the provider's %s failure when cancellation arrives before consumption",
  async (operation) => {
    const controller = new AbortController();
    const failure = new AnalysisOutputError(
      operation,
      "The provider could not decode its output",
      { diagnostics: { provider_detail: "retained" } },
    );
    const service = new PcapAnalysisService({
      inspectAvailability: () => Promise.reject(new Error("unused")),
      close: async () => {},
      execute: async () => {
        controller.abort({ requested: "late cancellation" });
        return err(failure);
      },
    });
    const result = await service.execute(
      operation,
      operation === "inspect_pcap_client" ? {} : { path },
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Expected the provider failure");
    expect(result.error).toBe(failure);
    expect(result.error.diagnostics).toEqual({ provider_detail: "retained" });
  },
);

it("preserves pcap caller field constraints before provider execution", async () => {
  let calls = 0;
  const service = new PcapAnalysisService({
    inspectAvailability: () => Promise.reject(new Error("unused")),
    close: () => Promise.resolve(),
    execute: () => {
      calls++;
      return Promise.reject(new Error("provider must not run"));
    },
  });
  const result = await service.execute("inspect_pcap_capture", { path: "" });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "invalid_request",
    details: {
      issues: [{ path: ["path"], reason: "out_of_range", minimum: 1 }],
    },
  });
  expect(calls).toBe(0);
});
