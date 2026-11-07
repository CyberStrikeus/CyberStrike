import { create, toBinary } from "@bufbuild/protobuf";
import {
  DescriptorProtoSchema,
  FieldDescriptorProtoSchema,
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
  FileOptionsSchema,
} from "@bufbuild/protobuf/wkt";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { z } from "zod";

import { analysisViewResultSchema } from "../../../src/domain/analysisView/analysisView.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { webNetworkCaptureSchema } from "../../../src/domain/webNetworkCapture.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { protobufHar } from "../../fixtures/protobufCapture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const body = Buffer.from("0a020801", "hex"); // Message { payload { value=1 } }
const descriptorDefinition = () =>
  create(FileDescriptorSetSchema, {
    file: [
      {
        name: "shared.proto",
        package: "capture",
        syntax: "proto3",
        messageType: [
          {
            name: "Payload",
            field: [{ name: "value", number: 1, type: 5, label: 1 }],
          },
        ],
      },
      {
        name: "entry.proto",
        package: "entry",
        syntax: "proto3",
        dependency: ["shared.proto"],
        messageType: [
          {
            name: "Message",
            field: [
              {
                name: "payload",
                number: 1,
                type: 11,
                typeName: ".capture.Payload",
                label: 1,
              },
            ],
          },
        ],
      },
    ],
  });

const conflictingFiles = (change: string, reverse: boolean) => {
  const definition = descriptorDefinition();
  const shared = definition.file[0]!;
  const duplicate = structuredClone(shared);
  let captured = body;
  if (change === "declarations") duplicate.messageType[0]!.name = "Other";
  else if (change === "package") duplicate.package = "other";
  else if (change === "imports") {
    definition.file.unshift(
      create(FileDescriptorProtoSchema, { name: "a.proto", syntax: "proto3" }),
      create(FileDescriptorProtoSchema, { name: "b.proto", syntax: "proto3" }),
    );
    shared.messageType = [];
    duplicate.messageType = [];
    shared.dependency = ["a.proto"];
    duplicate.dependency = ["b.proto"];
    definition.file.at(-1)!.messageType[0]!.field[0] = create(
      FieldDescriptorProtoSchema,
      { name: "value", number: 1, type: 5, label: 1 },
    );
    captured = Buffer.from([8, 1]);
  } else if (change === "presence") {
    shared.options = create(FileOptionsSchema);
    duplicate.options = create(FileOptionsSchema, { javaMultipleFiles: false });
  } else if (change === "opaque-file") {
    duplicate.$unknown = [
      { no: 50000, wireType: WireType.Varint, data: Uint8Array.of(1) },
    ];
  } else {
    shared.options = create(FileOptionsSchema);
    duplicate.options = create(FileOptionsSchema);
    shared.options.$unknown = [
      { no: 50000, wireType: WireType.Varint, data: Uint8Array.of(1) },
    ];
    duplicate.options.$unknown = [
      { no: 50000, wireType: WireType.Varint, data: Uint8Array.of(2) },
    ];
  }
  const sharedIndex = definition.file.indexOf(shared);
  definition.file.splice(
    sharedIndex,
    1,
    ...(reverse ? [duplicate, shared] : [shared, duplicate]),
  );
  return { bytes: toBinary(FileDescriptorSetSchema, definition), captured };
};

const retainedDetailsSchema = z.object({
  partial_observation: z.strictObject({
    kind: z.literal("retained-evidence"),
    evidence_id: z.string(),
  }),
});

cliTest(
  "refuses conflicting descriptor file identities before registry import lookup through CLI/MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-protobuf-file-conflicts-");
    const call = await cli.sharedMcpCall!();
    for (const change of [
      "declarations",
      "package",
      "imports",
      "presence",
      "opaque-file",
      "opaque-option",
    ])
      for (const reverse of [false, true]) {
        const { bytes, captured } = conflictingFiles(change, reverse);
        const descriptor = join(root, `${change}-${reverse}.pb`);
        const capture = join(root, `${change}-${reverse}.har`);
        const text = protobufHar(captured, "application/x-protobuf");
        await writeFile(descriptor, bytes);
        await writeFile(capture, text);
        const expected = {
          code: "invalid_request",
          details: {
            issues: [
              {
                path: ["protobuf", "schema", "descriptor_set_path"],
                reason: "invalid_format",
              },
            ],
          },
        };
        if (change === "declarations") {
          const output = await cli.sharedCliRun!({
            arguments: [
              "inspect-web-network-capture",
              capture,
              "har",
              "--record",
              "0",
              "--protobuf-schema",
              descriptor,
              "--protobuf-message",
              "entry.Message",
              "--json",
            ],
          });
          expect(output.exitCode).toBe(1);
          expect(output.json).toMatchObject(expected);
        }
        const response = await call("inspect_web_network_capture", {
          capture_path: capture,
          format: "har",
          record_ordinals: [0],
          protobuf: {
            schema: {
              descriptor_set_path: descriptor,
              message_type: "entry.Message",
            },
          },
        });
        const error = parseMcpToolError(response).error;
        expect(error, `${change}-${reverse}`).toMatchObject(expected);
        if (change === "declarations") {
          const source = retainedDetailsSchema.parse(
            error.details,
          ).partial_observation;
          const retained = await call("inspect_analysis_view", {
            source,
            view: { kind: "summary" },
          });
          expect(retained.isError, JSON.stringify(retained)).not.toBe(true);
          expect(
            analysisViewResultSchema.parse(
              parseEvidence(retained.structuredContent).normalized_result,
            ),
          ).toMatchObject({
            summary: {
              artifact: { path: capture, sha256: sha256(Buffer.from(text)) },
              retained_records: 1,
              protobuf_coverage: { status: "partial", inspected_records: 0 },
            },
          });
        }
        expect(
          Buffer.compare(await readFile(descriptor), Buffer.from(bytes)),
        ).toBe(0);
        expect(await readFile(capture, "utf8")).toBe(text);
      }
  },
);

/** Reorder known FileDescriptorProto fields without changing their facts. */
const reorderedSharedFile = () => {
  const shared = descriptorDefinition().file[0]!;
  return new BinaryWriter()
    .tag(12, WireType.LengthDelimited)
    .string(shared.syntax)
    .tag(4, WireType.LengthDelimited)
    .bytes(toBinary(DescriptorProtoSchema, shared.messageType[0]!))
    .tag(2, WireType.LengthDelimited)
    .string(shared.package)
    .tag(1, WireType.LengthDelimited)
    .string(shared.name)
    .finish();
};

cliTest(
  "coalesces equal descriptor file facts while preserving original descriptor identity through CLI/MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-protobuf-file-repeat-");
    const capture = join(root, "capture.har");
    await writeFile(capture, protobufHar(body, "application/x-protobuf"));
    const call = await cli.sharedMcpCall!();
    for (const mode of ["identical", "reordered", "opaque"]) {
      const definition = descriptorDefinition();
      const shared = definition.file[0]!;
      if (mode === "opaque") {
        shared.options = create(FileOptionsSchema);
        shared.options.$unknown = [
          { no: 50000, wireType: WireType.Varint, data: Uint8Array.of(7) },
        ];
      }
      const duplicate =
        mode === "reordered"
          ? reorderedSharedFile()
          : toBinary(FileDescriptorProtoSchema, shared);
      const writer = new BinaryWriter();
      writer
        .tag(1, WireType.LengthDelimited)
        .bytes(toBinary(FileDescriptorProtoSchema, shared));
      writer.tag(1, WireType.LengthDelimited).bytes(duplicate);
      writer
        .tag(1, WireType.LengthDelimited)
        .bytes(toBinary(FileDescriptorProtoSchema, definition.file[1]!));
      // Repeated imported facts after their consumer must coalesce as well.
      writer.tag(1, WireType.LengthDelimited).bytes(duplicate);
      const bytes = writer.finish();
      const descriptor = join(root, `${mode}.pb`);
      await writeFile(descriptor, bytes);
      const output = await cli.sharedCliRun!({
        arguments: [
          "inspect-web-network-capture",
          capture,
          "har",
          "--record",
          "0",
          "--protobuf-schema",
          descriptor,
          "--protobuf-message",
          "entry.Message",
          "--json",
        ],
      });
      expect(output.exitCode, output.stdout + output.stderr).toBe(0);
      const evidence = parseEvidence(output.json);
      const report = webNetworkCaptureSchema.parse(evidence.normalized_result);
      expect(report.protobuf_coverage?.status).toBe("complete");
      const decoded = report.records[0]?.protobuf?.[0];
      expect(decoded?.schema).toMatchObject({
        descriptor_set_path: descriptor,
        descriptor_set_sha256: sha256(bytes),
        descriptor_set_bytes: bytes.length,
      });
      expect(decoded?.fields).toMatchObject([
        { number: 1, schema_name: "payload", schema_type: "capture.Payload" },
        { number: 1, schema_name: "value", schema_value: "1" },
      ]);
      const response = await call("inspect_web_network_capture", {
        capture_path: capture,
        format: "har",
        record_ordinals: [0],
        protobuf: {
          schema: {
            descriptor_set_path: descriptor,
            message_type: "entry.Message",
          },
        },
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      expect(parseEvidence(response.structuredContent).evidence_id).toBe(
        evidence.evidence_id,
      );
      expect(
        Buffer.compare(await readFile(descriptor), Buffer.from(bytes)),
      ).toBe(0);
    }
  },
);
