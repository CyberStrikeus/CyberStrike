import { create, toBinary } from "@bufbuild/protobuf";
import {
  FieldDescriptorProtoSchema,
  FileDescriptorSetSchema,
  OneofDescriptorProtoSchema,
} from "@bufbuild/protobuf/wkt";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { z } from "zod";

import { analysisViewResultSchema } from "../../../src/domain/analysisView/analysisView.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { webNetworkCaptureSchema } from "../../../src/domain/webNetworkCapture.js";
import { protobufHar } from "../../fixtures/protobufCapture.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const sha256 = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
// Two occurrences of first=1, second=3, then child { value=4 }.
const body = Buffer.from("0801080210031a020804", "hex");
const descriptorDefinition = () =>
  create(FileDescriptorSetSchema, {
    file: [
      {
        name: "identity.proto",
        package: "capture",
        syntax: "proto3",
        messageType: [
          {
            name: "Message",
            field: [
              { name: "first", number: 1, type: 5, label: 3 },
              { name: "second", number: 2, type: 5, label: 1 },
              {
                name: "child",
                number: 3,
                type: 11,
                typeName: ".capture.Message.Child",
                label: 1,
              },
            ],
            nestedType: [
              {
                name: "Child",
                field: [{ name: "value", number: 1, type: 5, label: 1 }],
              },
            ],
          },
        ],
      },
    ],
  });

const invalidFieldNumbers: Readonly<Record<string, number>> = {
  "missing-number": 0,
  "negative-number": -1,
  "reserved-first": 19000,
  "reserved-last": 19999,
  "excessive-number": 536870912,
};

const retainedDetailsSchema = z.object({
  partial_observation: z.strictObject({
    kind: z.literal("retained-evidence"),
    evidence_id: z.string(),
  }),
});

cliTest.for([
  "forward",
  "reverse",
  "nested",
  "oneof",
  "name-forward",
  "name-reverse",
  "nested-name",
  ...Object.keys(invalidFieldNumbers),
])(
  "refuses ambiguous descriptor field identities through CLI/MCP while retaining source Evidence: %s",
  async (variant, { cli }) => {
    const root = await createTestTempDirectory("rea-protobuf-field-identity-");
    const capture = join(root, "capture.har");
    const text = protobufHar(body, "application/x-protobuf");
    await writeFile(capture, text);
    const call = await cli.sharedMcpCall!();
    const definition = descriptorDefinition();
    const message = definition.file[0]!.messageType[0]!;
    if (variant in invalidFieldNumbers) {
      message.field[1]!.number = invalidFieldNumbers[variant]!;
    } else if (variant === "name-forward" || variant === "name-reverse") {
      message.field[1]!.name = message.field[0]!.name;
      if (variant === "name-reverse") message.field.reverse();
    } else if (variant === "nested-name") {
      message.nestedType[0]!.field.push(
        create(FieldDescriptorProtoSchema, {
          name: "value",
          number: 2,
          type: 5,
          label: 1,
        }),
      );
    } else if (variant === "nested") {
      message.nestedType[0]!.field.push(
        create(FieldDescriptorProtoSchema, {
          name: "alias",
          number: 1,
          type: 5,
          label: 1,
        }),
      );
    } else if (variant === "oneof") {
      message.oneofDecl.push(
        create(OneofDescriptorProtoSchema, { name: "choice" }),
      );
      message.field.push(
        create(FieldDescriptorProtoSchema, {
          name: "alias",
          number: 1,
          type: 5,
          label: 1,
          oneofIndex: 0,
        }),
      );
    } else {
      message.field[1]!.number = 1;
      if (variant === "reverse") message.field.reverse();
    }
    const descriptor = join(root, `${variant}.pb`);
    const bytes = toBinary(FileDescriptorSetSchema, definition);
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
        "capture.Message",
        "--json",
      ],
    });
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
    expect(output.exitCode, variant).toBe(1);
    expect(output.json, variant).toMatchObject(expected);
    const response = await call("inspect_web_network_capture", {
      capture_path: capture,
      format: "har",
      record_ordinals: [0],
      protobuf: {
        schema: {
          descriptor_set_path: descriptor,
          message_type: "capture.Message",
        },
      },
    });
    const error = parseMcpToolError(response).error;
    expect(error, variant).toMatchObject(expected);
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
        artifact: {
          path: capture,
          bytes: Buffer.byteLength(text),
          sha256: sha256(text),
        },
        retained_records: 1,
        protobuf_coverage: { status: "partial", inspected_records: 0 },
      },
    });
    expect(Buffer.compare(await readFile(descriptor), Buffer.from(bytes))).toBe(
      0,
    );
    expect(await readFile(capture, "utf8")).toBe(text);
  },
);

cliTest(
  "keeps repeated wire occurrences and message-local number reuse through CLI/MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-protobuf-field-control-");
    const capture = join(root, "capture.har");
    const descriptor = join(root, "valid.pb");
    const valid = descriptorDefinition();
    valid.file[0]!.messageType[0]!.nestedType[0]!.field[0]!.name = "first";
    for (const [name, number] of [
      ["before_reserved", 18999],
      ["after_reserved", 20000],
      ["last_legal", 536870911],
    ] as const) {
      valid.file[0]!.messageType[0]!.field.push(
        create(FieldDescriptorProtoSchema, { name, number, type: 5, label: 1 }),
      );
    }
    const definition = toBinary(FileDescriptorSetSchema, valid);
    await writeFile(capture, protobufHar(body, "application/x-protobuf"));
    await writeFile(descriptor, definition);
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
        "capture.Message",
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
      descriptor_set_sha256: sha256(definition),
      descriptor_set_bytes: definition.length,
      message_type: "capture.Message",
    });
    expect(decoded?.fields).toMatchObject([
      {
        field_id: "offset:0",
        number: 1,
        schema_name: "first",
        schema_value: "1",
      },
      {
        field_id: "offset:2",
        number: 1,
        schema_name: "first",
        schema_value: "2",
      },
      {
        field_id: "offset:4",
        number: 2,
        schema_name: "second",
        schema_value: "3",
      },
      {
        field_id: "offset:6",
        number: 3,
        schema_name: "child",
        schema_type: "capture.Message.Child",
      },
      {
        field_id: "offset:8",
        number: 1,
        schema_name: "first",
        schema_value: "4",
      },
    ]);
    expect(decoded?.fields).toHaveLength(5);
    const call = await cli.sharedMcpCall!();
    const response = await call("inspect_web_network_capture", {
      capture_path: capture,
      format: "har",
      record_ordinals: [0],
      protobuf: {
        schema: {
          descriptor_set_path: descriptor,
          message_type: "capture.Message",
        },
      },
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    expect(parseEvidence(response.structuredContent).evidence_id).toBe(
      evidence.evidence_id,
    );
    expect(
      Buffer.compare(await readFile(descriptor), Buffer.from(definition)),
    ).toBe(0);
  },
);
