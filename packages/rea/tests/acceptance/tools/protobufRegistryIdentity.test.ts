import { create, toBinary } from "@bufbuild/protobuf";
import {
  DescriptorProtoSchema,
  EnumDescriptorProtoSchema,
  FileDescriptorSetSchema,
  ServiceDescriptorProtoSchema,
} from "@bufbuild/protobuf/wkt";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { webNetworkCaptureSchema } from "../../../src/domain/webNetworkCapture.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { protobufHar } from "../../fixtures/protobufCapture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const scalarMessage = (name: string, fieldName: string) =>
  create(DescriptorProtoSchema, {
    name,
    field: [{ name: fieldName, number: 1, type: 5, label: 1 }],
  });
const descriptorDefinition = () =>
  create(FileDescriptorSetSchema, {
    file: [
      {
        name: "identity.proto",
        package: "capture",
        syntax: "proto3",
        messageType: [scalarMessage("Message", "alpha")],
      },
    ],
  });

const collidingDescriptor = (scope: string, reverse: boolean) => {
  const definition = descriptorDefinition();
  const file = definition.file[0]!;
  let messageType = "capture.Message";
  if (scope === "same-file") {
    file.messageType.push(scalarMessage("Message", "beta"));
    if (reverse) file.messageType.reverse();
  } else if (["across-files", "enum", "service"].includes(scope)) {
    const other = structuredClone(file);
    other.name = "other.proto";
    if (scope === "enum") {
      other.messageType = [];
      other.enumType.push(
        create(EnumDescriptorProtoSchema, {
          name: "Message",
          value: [{ name: "ZERO", number: 0 }],
        }),
      );
    } else if (scope === "service") {
      other.messageType = [];
      other.service.push(
        create(ServiceDescriptorProtoSchema, { name: "Message" }),
      );
    } else other.messageType[0]!.field[0]!.name = "beta";
    definition.file.push(other);
    if (reverse) definition.file.reverse();
  } else {
    const alternative =
      scope === "map-entry"
        ? create(DescriptorProtoSchema, {
            name: "Message",
            options: { mapEntry: true },
            field: [
              { name: "key", number: 1, type: 9, label: 1 },
              { name: "value", number: 2, type: 5, label: 1 },
            ],
          })
        : scalarMessage("Message", "beta");
    const children = [file.messageType[0]!, alternative];
    if (reverse) children.reverse();
    file.messageType = [
      create(DescriptorProtoSchema, { name: "Outer", nestedType: children }),
    ];
    messageType = "capture.Outer.Message";
  }
  return { bytes: toBinary(FileDescriptorSetSchema, definition), messageType };
};

cliTest(
  "refuses ambiguous registry identities independently of declaration order through CLI/MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-protobuf-registry-identity-",
    );
    const capture = join(root, "capture.har");
    const text = protobufHar(Buffer.from([8, 1]), "application/x-protobuf");
    await writeFile(capture, text);
    const call = await cli.sharedMcpCall!();
    for (const scope of [
      "same-file",
      "across-files",
      "nested",
      "enum",
      "service",
      "map-entry",
    ])
      for (const reverse of [false, true]) {
        const { bytes, messageType } = collidingDescriptor(scope, reverse);
        const descriptor = join(root, `${scope}-${reverse}.pb`);
        await writeFile(descriptor, bytes);
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
        // Both orders cross the actual CLI adapter; other geometries reuse
        // the production MCP session and the same application workflow.
        if (scope === "same-file") {
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
              messageType,
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
              message_type: messageType,
            },
          },
        });
        expect(
          parseMcpToolError(response).error,
          `${scope}-${reverse}`,
        ).toMatchObject(expected);
        expect(
          Buffer.compare(await readFile(descriptor), Buffer.from(bytes)),
        ).toBe(0);
      }
    expect(await readFile(capture, "utf8")).toBe(text);
  },
);

cliTest(
  "keeps empty-package, package, parent and case-sensitive registry identities distinct",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-protobuf-registry-scopes-");
    const capture = join(root, "capture.har");
    const descriptor = join(root, "scopes.pb");
    const definition = create(FileDescriptorSetSchema, {
      file: [
        {
          name: "root.proto",
          syntax: "proto3",
          messageType: [
            scalarMessage("Message", "root_value"),
            scalarMessage("message", "case_value"),
            create(DescriptorProtoSchema, {
              name: "Outer",
              nestedType: [scalarMessage("Message", "nested_value")],
            }),
          ],
        },
        {
          name: "package.proto",
          package: "capture",
          syntax: "proto3",
          messageType: [scalarMessage("Message", "package_value")],
        },
      ],
    });
    const bytes = toBinary(FileDescriptorSetSchema, definition);
    await writeFile(
      capture,
      protobufHar(Buffer.from([8, 1]), "application/x-protobuf"),
    );
    await writeFile(descriptor, bytes);
    const call = await cli.sharedMcpCall!();
    for (const [messageType, fieldName] of [
      ["Message", "root_value"],
      ["message", "case_value"],
      ["Outer.Message", "nested_value"],
      ["capture.Message", "package_value"],
    ] as const) {
      const response = await call("inspect_web_network_capture", {
        capture_path: capture,
        format: "har",
        record_ordinals: [0],
        protobuf: {
          schema: {
            descriptor_set_path: descriptor,
            message_type: messageType,
          },
        },
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      const report = webNetworkCaptureSchema.parse(
        parseEvidence(response.structuredContent).normalized_result,
      );
      expect(report.protobuf_coverage?.status).toBe("complete");
      expect(report.records[0]?.protobuf?.[0]?.fields).toMatchObject([
        { number: 1, schema_name: fieldName, schema_value: "1" },
      ]);
    }
    expect(Buffer.compare(await readFile(descriptor), Buffer.from(bytes))).toBe(
      0,
    );
  },
);
