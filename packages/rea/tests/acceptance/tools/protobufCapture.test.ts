import { z } from "zod";
import { readFile, unlink, writeFile, mkdir, truncate } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { cliTest, runFileCli } from "../../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  protobufCaptureDescriptor,
  protobufHar,
  protobufFrame,
  protobufCaptureBody,
} from "../../fixtures/protobufCapture.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import {
  webNetworkCaptureSchema,
  inspectWebNetworkCaptureInputSchema,
} from "../../../src/domain/webNetworkCapture.js";
import { readEvidenceBundle } from "../../../src/application/EvidenceBundleFiles.js";
import { analysisViewResultSchema } from "../../../src/domain/analysisView/analysisView.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

type CaptureRequest = z.input<typeof inspectWebNetworkCaptureInputSchema>;

// Acceptance files have isolated workers; the file owns one server and each case owns its inputs.
const captureTest = cliTest.extend<{
  $worker: { mcp: Awaited<ReturnType<typeof connectLocalToolsMcp>> };
}>({
  mcp: [
    // oxlint-disable-next-line no-empty-pattern -- Vitest parses fixture dependencies from object destructuring.
    async ({}, use) => {
      let close: (() => Promise<void>) | undefined;
      try {
        const mcp = await connectLocalToolsMcp({}, (cleanup) => {
          close = cleanup;
        });
        await use(mcp);
      } finally {
        await close?.();
      }
    },
    { scope: "worker" },
  ],
});

const retainedCaptureDetailsSchema = z.object({
  partial_observation: z.strictObject({
    kind: z.literal("retained-evidence"),
    evidence_id: z.string(),
  }),
});

async function prepareMcpCapture(
  call: Awaited<ReturnType<typeof connectLocalToolsMcp>>["call"],
) {
  const root = await createTestTempDirectory("rea-protobuf-mcp-");
  const capture = join(root, "capture.har");
  const descriptor = join(root, "capture.pb");
  await writeFile(capture, protobufHar());
  await writeFile(descriptor, protobufCaptureDescriptor());
  const args: CaptureRequest = {
    capture_path: capture,
    format: "har",
    record_ordinals: [0],
    protobuf: {
      schema: {
        descriptor_set_path: descriptor,
        message_type: "capture.Message",
      },
    },
  };
  return { call, args, root, capture, descriptor };
}

captureTest(
  "excludes Protobuf values in text framing and trailer credentials through MCP",
  async ({ mcp }) => {
    const { call, root } = await prepareMcpCapture(mcp.call);
    const textPath = join(root, "text.har");
    await writeFile(
      textPath,
      protobufHar(
        Buffer.from(protobufCaptureBody().toString("base64")),
        "application/grpc-web-text",
      ),
    );
    const textExcluded = await call("inspect_web_network_capture", {
      capture_path: textPath,
      format: "har",
      record_ordinals: [0],
      sensitive_values: ["hello"],
    });
    expect(textExcluded.isError, JSON.stringify(textExcluded)).not.toBe(true);
    const excludedText = webNetworkCaptureSchema.parse(
      parseEvidence(textExcluded.structuredContent).normalized_result,
    );
    expect(excludedText.records[0]?.binary_fields[0]).toMatchObject({
      state: "redacted",
      content_base64: null,
      sha256: null,
    });
    expect(excludedText.records[0]?.reported).toMatchObject({
      response: { content: { text: null } },
    });
    expect(excludedText.records[0]?.protobuf).toBeUndefined();
    const credentialPath = join(root, "trailer.har");
    await writeFile(
      credentialPath,
      protobufHar(
        Buffer.concat([
          protobufFrame(Buffer.from("0a0568656c6c6f", "hex")),
          protobufFrame(
            Buffer.from(
              "grpc-status: 0\r\nauthorization: Bearer fixture-only-credential\r\n",
            ),
            128,
          ),
        ]),
      ),
    );
    const credential = await call("inspect_web_network_capture", {
      capture_path: credentialPath,
      format: "har",
      record_ordinals: [0],
    });
    expect(credential.isError, JSON.stringify(credential)).not.toBe(true);
    const excludedCredential = webNetworkCaptureSchema.parse(
      parseEvidence(credential.structuredContent).normalized_result,
    );
    expect(excludedCredential.records[0]?.binary_fields[0]).toMatchObject({
      state: "redacted",
      content_base64: null,
    });
    expect(excludedCredential.records[0]?.redactions).toContainEqual({
      pointer: "/response/content/text",
      reason: "transport-credential",
    });
    expect(excludedCredential.records[0]?.protobuf).toBeUndefined();
    expect(JSON.stringify(credential)).not.toContain("fixture-only-credential");
  },
);

captureTest(
  "retains partial capture Evidence after schema and capacity failures through MCP",
  async ({ mcp }) => {
    const { call, args, root, descriptor } = await prepareMcpCapture(mcp.call);
    const missing = await call("inspect_web_network_capture", {
      ...args,
      sensitive_values: ["unrelated fixture exclusion"],
      protobuf: {
        schema: {
          descriptor_set_path: descriptor,
          message_type: "capture.Missing",
        },
      },
    });
    const missingError = parseMcpToolError(missing).error;
    expect(missingError.code).toBe("invalid_request");
    expect(missingError.details).toMatchObject({
      issues: [
        {
          path: ["protobuf", "schema", "message_type"],
          reason: "invalid_value",
          message: expect.stringContaining("capture.Missing"),
        },
      ],
    });
    const retainedSource = retainedCaptureDetailsSchema.parse(
      missingError.details,
    ).partial_observation;
    const retainedSummary = await call("inspect_analysis_view", {
      source: retainedSource,
      view: { kind: "summary" },
    });
    expect(retainedSummary.isError, JSON.stringify(retainedSummary)).not.toBe(
      true,
    );
    expect(
      analysisViewResultSchema.parse(
        parseEvidence(retainedSummary.structuredContent).normalized_result,
      ),
    ).toMatchObject({
      summary: {
        protobuf_coverage: { status: "partial", inspected_records: 0 },
      },
    });
    const missingView = await call("inspect_analysis_view", {
      source: retainedSource,
      view: { kind: "protobuf", collection: "fields", offset: 0, limit: 1 },
    });
    expect(missingView.isError, JSON.stringify(missingView)).not.toBe(true);
    expect(
      analysisViewResultSchema.parse(
        parseEvidence(missingView.structuredContent).normalized_result,
      ),
    ).toMatchObject({ source_status: "partial", items: [] });
    const capacityPath = join(root, "capacity.har");
    const repeated = Buffer.alloc(200000);
    for (let index = 0; index < repeated.length; index += 2) {
      repeated[index] = 8;
      repeated[index + 1] = 1;
    }
    await writeFile(capacityPath, protobufHar(protobufFrame(repeated)));
    const capacity = await call("inspect_web_network_capture", {
      capture_path: capacityPath,
      format: "har",
      record_ordinals: [0],
      sensitive_values: ["unrelated fixture exclusion"],
    });
    const capacityError = parseMcpToolError(capacity).error;
    expect(capacityError.code).toBe("resource_constraint");
    expect(capacityError.retryable).toBe(false);
    const capacitySource = retainedCaptureDetailsSchema.parse(
      capacityError.details,
    ).partial_observation;
    const capacitySummary = await call("inspect_analysis_view", {
      source: capacitySource,
      view: { kind: "summary" },
    });
    expect(capacitySummary.isError, JSON.stringify(capacitySummary)).not.toBe(
      true,
    );
    expect(
      analysisViewResultSchema.parse(
        parseEvidence(capacitySummary.structuredContent).normalized_result,
      ),
    ).toMatchObject({
      summary: {
        protobuf_coverage: { status: "partial", inspected_records: 0 },
      },
    });
    expect(JSON.stringify(capacity)).not.toContain("content_base64");
  },
);

captureTest(
  "preflights trailer credentials before parsing and retaining later records through MCP",
  async ({ mcp }) => {
    const { call, root, descriptor } = await prepareMcpCapture(mcp.call);
    const repeated = Buffer.alloc(200000);
    for (let index = 0; index < repeated.length; index += 2) {
      repeated[index] = 8;
      repeated[index + 1] = 1;
    }
    const large = protobufFrame(repeated);
    const credential = protobufFrame(
      Buffer.from(
        "grpc-status: 0\r\nauthorization: fixture-only-trailer-credential\r\n",
      ),
      128,
    );
    const small = protobufFrame(Buffer.from([8, 1]));
    for (const [name, body, mimeType, framing] of [
      [
        "large",
        Buffer.concat([large, credential]),
        "application/grpc-web+proto",
        "auto",
      ],
      [
        "malformed",
        Buffer.concat([
          small,
          protobufFrame(
            Buffer.from(
              "malformed\r\nauthorization: fixture-only-trailer-credential\r\n",
            ),
            128,
          ),
        ]),
        "application/grpc-web+proto",
        "auto",
      ],
      [
        "text-override",
        Buffer.from(Buffer.concat([small, credential]).toString("base64")),
        "application/grpc-web-text",
        "raw",
      ],
    ] as const) {
      const path = join(root, `credential-${name}.har`);
      await writeFile(path, protobufHar(body, mimeType));
      const response = await call("inspect_web_network_capture", {
        capture_path: path,
        format: "har",
        record_ordinals: [0],
        protobuf: { framing },
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      const capture = webNetworkCaptureSchema.parse(
        parseEvidence(response.structuredContent).normalized_result,
      );
      expect(capture.records[0]?.binary_fields[0]).toMatchObject({
        state: "redacted",
        content_base64: null,
        sha256: null,
      });
      expect(capture.records[0]?.protobuf).toBeUndefined();
      expect(capture.protobuf_coverage?.status).toBe("partial");
    }
    const path = join(root, "credential-later-record.har");
    await writeFile(
      path,
      protobufHar(large, "application/grpc-web+proto", [
        Buffer.concat([small, credential]),
      ]),
    );
    for (const schema of [
      undefined,
      { descriptor_set_path: descriptor, message_type: "capture.Missing" },
    ]) {
      const response = await call("inspect_web_network_capture", {
        capture_path: path,
        format: "har",
        record_ordinals: [0, 1],
        sensitive_values: ["unrelated fixture exclusion"],
        ...(schema === undefined ? {} : { protobuf: { schema } }),
      });
      const error = parseMcpToolError(response).error;
      expect(error.code).toBe(
        schema === undefined ? "resource_constraint" : "invalid_request",
      );
      const source = retainedCaptureDetailsSchema.parse(
        error.details,
      ).partial_observation;
      const retained = await call("inspect_analysis_view", {
        source,
        view: { kind: "capture", detail: "complete", offset: 0, limit: 2 },
      });
      expect(retained.isError, JSON.stringify(retained)).not.toBe(true);
      const view = analysisViewResultSchema.parse(
        parseEvidence(retained.structuredContent).normalized_result,
      );
      expect(view).toMatchObject({
        items: [
          expect.anything(),
          {
            binary_fields: [
              { state: "redacted", content_base64: null, sha256: null },
            ],
          },
        ],
      });
    }
  },
);

captureTest(
  "reports descriptor read failures with retained capture Evidence through MCP",
  async ({ mcp }) => {
    const { call, args, root } = await prepareMcpCapture(mcp.call);
    const directory = join(root, "descriptor-directory");
    const oversized = join(root, "oversized.pb");
    await mkdir(directory);
    await writeFile(oversized, "");
    await truncate(oversized, 32 * 1024 * 1024 + 1);
    for (const [path, reason] of [
      [join(root, "missing.pb"), "invalid_value"],
      [directory, "invalid_format"],
      [oversized, "out_of_range"],
    ] as const) {
      const response = await call("inspect_web_network_capture", {
        ...args,
        sensitive_values: ["unrelated fixture exclusion"],
        protobuf: {
          schema: {
            descriptor_set_path: path,
            message_type: "capture.Message",
          },
        },
      });
      const error = parseMcpToolError(response).error;
      expect(error.code).toBe("invalid_request");
      expect(error.details).toMatchObject({
        issues: [
          { path: ["protobuf", "schema", "descriptor_set_path"], reason },
        ],
      });
      expect(
        retainedCaptureDetailsSchema.parse(error.details).partial_observation
          .kind,
      ).toBe("retained-evidence");
    }
  },
);

captureTest(
  "decodes selected capture bytes with a supplied descriptor and pages exported facts after both sources disappear",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-protobuf-cli-");
    const capture = join(root, "capture.har");
    const descriptor = join(root, "capture.pb");
    const bundle = join(root, "evidence.json");
    await writeFile(capture, protobufHar());
    await writeFile(descriptor, protobufCaptureDescriptor());
    const original = await cli.run({
      arguments: ["inspect-web-network-capture", capture, "har", "--json"],
    });
    expect(original.exitCode, original.stderr).toBe(0);
    expect(
      webNetworkCaptureSchema.parse(
        parseEvidence(original.json).normalized_result,
      ).records[0],
    ).not.toHaveProperty("protobuf");
    const decoded = await cli.run({
      arguments: [
        "inspect-web-network-capture",
        capture,
        "har",
        "--record",
        "0",
        "--protobuf-schema",
        descriptor,
        "--protobuf-message",
        "capture.Message",
        "--detail",
        "summary",
        "--evidence_output",
        bundle,
        "--json",
      ],
    });
    expect(decoded.exitCode, decoded.stdout + decoded.stderr).toBe(0);
    const loaded = await readEvidenceBundle(bundle);
    if (!loaded.ok) throw loaded.error;
    const parent = loaded.value.records.find(
      (record) => record.operation === "inspect_web_network_capture",
    );
    if (parent === undefined)
      throw new Error("Complete capture Evidence must be retained");
    const report = webNetworkCaptureSchema.parse(parent.normalized_result);
    expect(report.records[0]?.protobuf?.[0]).toMatchObject({
      status: "complete",
      schema: { message_type: "capture.Message" },
    });
    expect(report.records[0]?.protobuf?.[0]?.fields[0]).toMatchObject({
      schema_name: "sentence",
      schema_value: "hello",
      field_id: "offset:5",
    });
    await unlink(capture);
    await unlink(descriptor);
    const request = join(root, "view.json");
    await writeFile(
      request,
      JSON.stringify({
        source: { kind: "inline", evidence: parent },
        view: {
          kind: "protobuf",
          collection: "fields",
          field_ids: ["offset:5"],
          fields: ["schema_name", "schema_value"],
          offset: 0,
          limit: 1,
        },
      }),
    );
    const viewed = await cli.run({
      arguments: ["inspect-analysis-view", request, "--json"],
    });
    expect(viewed.exitCode, viewed.stdout + viewed.stderr).toBe(0);
    const view = analysisViewResultSchema.parse(
      parseEvidence(viewed.json).normalized_result,
    );
    expect(view).toMatchObject({
      kind: "protobuf",
      parent_evidence_id: parent.evidence_id,
      source_status: "complete",
      coverage: { total: 1, examined: 1, exhausted: true },
      items: [
        {
          record_ordinal: 0,
          body_pointer: "/response/content/text",
          field_id: "offset:5",
          schema_name: "sentence",
          schema_value: "hello",
        },
      ],
    });
    expect(JSON.stringify(view)).not.toContain("content_base64");
    expect((await readFile(bundle)).length).toBeGreaterThan(0);
  },
);

captureTest(
  "uses production MCP schemas, retained pages and CLI-equivalent decoding without reopening sources",
  async ({ cli, mcp }) => {
    const { call, args, capture, descriptor } = await prepareMcpCapture(
      mcp.call,
    );
    const complete = await call("inspect_web_network_capture", args);
    expect(complete.isError, JSON.stringify(complete)).not.toBe(true);
    const parent = parseEvidence(complete.structuredContent);
    const cliResult = await cli.run({
      arguments: [
        "inspect-web-network-capture",
        capture,
        "har",
        "--record",
        "0",
        "--protobuf-schema",
        descriptor,
        "--protobuf-message",
        "capture.Message",
        "--json",
      ],
    });
    expect(cliResult.exitCode, cliResult.stdout + cliResult.stderr).toBe(0);
    expect(parseEvidence(cliResult.json).evidence_id).toBe(parent.evidence_id);
    const redacted = await call("inspect_web_network_capture", {
      ...args,
      sensitive_values: ["hello"],
    });
    expect(redacted.isError, JSON.stringify(redacted)).not.toBe(true);
    const excluded = webNetworkCaptureSchema.parse(
      parseEvidence(redacted.structuredContent).normalized_result,
    );
    expect(excluded.records[0]?.protobuf).toBeUndefined();
    expect(excluded.protobuf_coverage).toMatchObject({
      status: "partial",
      selected_records: 1,
      inspected_records: 1,
    });
    expect(JSON.stringify(redacted)).not.toContain("hello");
    const summary = await call("inspect_web_network_capture", {
      ...args,
      detail: "summary",
    });
    expect(summary.isError, JSON.stringify(summary)).not.toBe(true);
    const result = analysisViewResultSchema.parse(
      parseEvidence(summary.structuredContent).normalized_result,
    );
    expect(result).toMatchObject({
      kind: "summary",
      parent_evidence_id: parent.evidence_id,
    });
    const invalid = await call("inspect_web_network_capture", {
      ...args,
      record_ordinals: undefined,
    });
    expect(invalid.isError).toBe(true);
    expect(parseMcpToolError(invalid).error.code).toBe("invalid_request");
    await unlink(capture);
    await unlink(descriptor);
    const viewed = await call("inspect_analysis_view", {
      source: { kind: "retained-evidence", evidence_id: parent.evidence_id },
      view: {
        kind: "protobuf",
        collection: "fields",
        field_numbers: [2],
        fields: ["schema_name", "schema_value"],
        offset: 0,
        limit: 1,
      },
    });
    expect(viewed.isError, JSON.stringify(viewed)).not.toBe(true);
    expect(
      analysisViewResultSchema.parse(
        parseEvidence(viewed.structuredContent).normalized_result,
      ),
    ).toMatchObject({
      kind: "protobuf",
      items: [{ schema_name: "values", schema_value: '["1","2"]' }],
      coverage: { total: 1, exhausted: true },
    });
  },
);

const trailerCases = [
  ["valid", "grpc-status", "0", "complete"],
  [
    "opaque",
    "grpc-status",
    "0\r\nx-note: caf\u00e9\r\nx-after: kept",
    "partial",
  ],
  ["uppercase", "Grpc-Status", "0", "partial"],
  ["nul", "grpc-status", "0\u0000bad", "partial"],
  ["lf", "grpc-status", "0\nbad", "partial"],
  ["cr", "grpc-status", "0\rbad", "partial"],
  ["vt", "grpc-status", "0\u000bbad", "partial"],
  ["del", "grpc-status", "0\u007fbad", "partial"],
] as const;

captureTest.for(
  (["grpc-web", "grpc-web-text"] as const).flatMap((framing) =>
    trailerCases.map(([name, headerName, value, status]) => ({
      framing,
      name,
      headerName,
      value,
      status,
    })),
  ),
)(
  "preserves $framing trailer case $name through CLI and MCP without changing capture bytes",
  async ({ framing, name, headerName, value, status }, { cli, mcp }) => {
    const root = await createTestTempDirectory("rea-grpc-web-trailers-");
    const path = join(root, `${framing}-${name}.har`);
    const trailer = Buffer.from(
      `${headerName}: ${value}\r\n`,
      name === "opaque" ? "latin1" : "utf8",
    );
    const body = Buffer.concat([
      protobufFrame(Buffer.from([8, 1])),
      protobufFrame(trailer, 128),
    ]);
    const original = protobufHar(
      framing === "grpc-web-text" ? Buffer.from(body.toString("base64")) : body,
      `application/${framing}`,
    );
    await writeFile(path, original);
    const options = {
      arguments: [
        "inspect-web-network-capture",
        path,
        "har",
        "--record",
        "0",
        "--protobuf-framing",
        "auto",
        "--json",
      ],
    };
    const response = await (name === "valid"
      ? cli.run(options)
      : runFileCli(cli, options));
    expect(response.exitCode, response.stdout + response.stderr).toBe(0);
    const evidence = parseEvidence(response.json);
    const report = webNetworkCaptureSchema.parse(evidence.normalized_result);
    expect(report.protobuf_coverage?.status, name).toBe(status);
    expect(report.records[0]?.protobuf?.[0]).toMatchObject({
      status,
      framing,
      examined_bytes: body.length,
      frames: [
        { kind: "data", status: "complete", examined_bytes: 2 },
        { kind: "trailer", status, examined_bytes: trailer.length },
      ],
      fields: [{ number: 1, wire_type: "varint", value: "1" }],
    });
    if (name === "opaque") {
      expect(report.records[0]?.protobuf?.[0]?.frames[1]?.trailers).toEqual([
        { name: "grpc-status", value: "0" },
        { name: "x-after", value: "kept" },
      ]);
    }
    const reply = await mcp.call("inspect_web_network_capture", {
      capture_path: path,
      format: "har",
      record_ordinals: [0],
      protobuf: { framing: "auto" },
    });
    expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
    expect(reply.structuredContent).toEqual(response.json);
    expect(await readFile(path, "utf8")).toBe(original);
  },
);

captureTest(
  "keeps automatic framing partial when a HAR mimeType is excluded through MCP",
  async ({ mcp }) => {
    const root = await createTestTempDirectory("rea-protobuf-mime-");
    const path = join(root, "capture.har");
    await writeFile(path, protobufHar());
    const reply = await mcp.call("inspect_web_network_capture", {
      capture_path: path,
      format: "har",
      record_ordinals: [0],
      sensitive_values: ["grpc-web+proto"],
    });
    expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
    const report = webNetworkCaptureSchema.parse(
      parseEvidence(reply.structuredContent).normalized_result,
    );
    expect(report.records[0]?.redactions).toContainEqual({
      pointer: "/response/content/mimeType",
      reason: "explicit-sensitive-value",
    });
    expect(report.records[0]?.binary_fields[0]).toMatchObject({
      pointer: "/response/content/text",
      state: "retained",
    });
    expect(report.records[0]?.protobuf).toBeUndefined();
    expect(report.records[0]?.limitations).toContainEqual(
      expect.stringMatching(/^Selected body's MIME metadata is excluded/),
    );
    expect(report.protobuf_coverage).toEqual({
      status: "partial",
      selected_records: 1,
      inspected_records: 1,
    });
  },
);
