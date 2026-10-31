import { expect, it } from "vitest";
import { createEvidence } from "../evidence.js";
import { projectAnalysisView } from "./analysisView.js";
import { webNetworkCaptureSchema } from "../webNetworkCapture.js";

const capture = async () => {
  const report = webNetworkCaptureSchema.parse({
    artifact: { path: "/recordings/a.har", bytes: 100, sha256: "b".repeat(64) },
    decoder: {
      id: "projection-fixture",
      name: "Original projection facts",
      version: "1",
    },
    container: {
      reported: null,
      numeric_literals: [],
      redactions: [],
      records_pointer: "/log/entries",
    },
    format: "har",
    total_records: 1,
    runtime_attribution: "unknown",
    limitations: [],
    records: [
      {
        ordinal: 0,
        location: { kind: "json-pointer", pointer: "/log/entries/0" },
        reported: null,
        binary_fields: [],
        numeric_literals: [],
        redactions: [],
        limitations: [],
        protobuf: [
          {
            decoder: "rea-protobuf-wire-v1",
            pointer: "/response/content/text",
            content_type: "application/grpc-web+proto",
            body_sha256: "c".repeat(64),
            framing: "grpc-web",
            offset_basis: "retained-body",
            decoded_bytes: 37,
            status: "complete",
            examined_bytes: 37,
            limitations: [],
            frames: [
              {
                index: 0,
                kind: "data",
                offset: 0,
                payload_offset: 5,
                bytes: 11,
                compressed: false,
                status: "complete",
                examined_bytes: 11,
              },
              {
                index: 1,
                kind: "trailer",
                offset: 16,
                payload_offset: 21,
                bytes: 16,
                compressed: false,
                status: "complete",
                examined_bytes: 16,
              },
            ],
            fields: [
              {
                index: 0,
                frame_index: 0,
                parent_index: null,
                field_id: "offset:5",
                parent_field_id: null,
                number: 1,
                wire_type: "len",
                offset: 5,
                bytes: 7,
                payload_offset: 7,
                payload_bytes: 5,
                text: "hello",
                interpretations: ["utf8-string", "packed-varint", "bytes"],
              },
              {
                index: 1,
                frame_index: 0,
                parent_index: null,
                field_id: "offset:12",
                parent_field_id: null,
                number: 2,
                wire_type: "len",
                offset: 12,
                bytes: 4,
                payload_offset: 14,
                payload_bytes: 2,
              },
            ],
          },
        ],
      },
    ],
  });
  const evidence = createEvidence(
    { ...report.artifact, sha256: "b".repeat(64), format: "file" },
    report.decoder,
    {
      operation: "inspect_web_network_capture",
      parameters: { record_ordinals: [0] },
      result: report,
      confidence: "observed",
      authority: "historical-reference",
    },
  );
  return {
    report,
    parent: {
      evidenceId: evidence.evidence_id,
      operation: evidence.operation,
      normalizedResult: report,
      subject: evidence.subject,
      limitations: evidence.limitations,
    },
  };
};

it("keeps coordinate identity and coverage with empty fields, batch filters and offset paging", async () => {
  const { parent } = await capture();
  const viewed = projectAnalysisView(parent, {
    kind: "protobuf",
    collection: "fields",
    field_ids: ["offset:5", "offset:12"],
    fields: [],
    offset: 1,
    limit: 1,
  });
  if (!viewed.ok) throw viewed.error;
  expect(viewed.value).toMatchObject({
    kind: "protobuf",
    coverage: { total: 2, examined: 1, exhausted: true },
    items: [
      {
        field_id: "offset:12",
        record_ordinal: 0,
        body_pointer: "/response/content/text",
        body_status: "complete",
        offset_basis: "retained-body",
      },
    ],
  });
  const empty = projectAnalysisView(parent, {
    kind: "protobuf",
    collection: "fields",
    field_numbers: [],
    offset: 0,
    limit: 1,
  });
  if (!empty.ok) throw empty.error;
  expect(empty.value).toMatchObject({
    items: [],
    coverage: { total: 0, exhausted: true },
  });
});

it("omits large values by default, returns requested text inline and preserves parser uncertainty", async () => {
  const { parent, report } = await capture();
  const brief = projectAnalysisView(parent, {
    kind: "protobuf",
    collection: "fields",
    offset: 0,
    limit: 1,
  });
  if (!brief.ok) throw brief.error;
  expect(brief.value).toMatchObject({
    items: [{ interpretations: ["utf8-string", "packed-varint", "bytes"] }],
  });
  expect(JSON.stringify(brief.value)).not.toContain('"hello"');
  const preview = projectAnalysisView(parent, {
    kind: "capture",
    detail: "preview",
    offset: 0,
    limit: 1,
  });
  if (!preview.ok) throw preview.error;
  expect(preview.value).toMatchObject({
    items: [
      {
        protobuf_summary: {
          bodies: 1,
          frames: 2,
          fields: 2,
          incomplete_bodies: 0,
        },
      },
    ],
  });
  expect(JSON.stringify(preview.value)).not.toContain('"field_id"');
  report.records[0]!.protobuf![0]!.status = "partial";
  const full = projectAnalysisView(parent, {
    kind: "protobuf",
    collection: "fields",
    fields: ["text"],
    offset: 0,
    limit: 1,
  });
  if (!full.ok) throw full.error;
  expect(full.value).toMatchObject({
    source_status: "partial",
    items: [{ text: "hello", body_status: "partial" }],
  });
  const changedSubject = projectAnalysisView(
    {
      ...parent,
      subject: { ...parent.subject!, digest: { sha256: "e".repeat(64) } },
    },
    { kind: "protobuf", collection: "bodies", offset: 0, limit: 1 },
  );
  expect(changedSubject.ok).toBe(false);
  report.records[0]!.protobuf![0]!.fields[0]!.offset = 1000;
  expect(
    projectAnalysisView(parent, {
      kind: "protobuf",
      collection: "fields",
      offset: 0,
      limit: 1,
    }).ok,
  ).toBe(false);
});
