import { createHash } from "node:crypto";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import { z } from "zod";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { MANAGED_NATIVE_VERIFICATION_EXAMPLE } from "../../../src/contracts/managed/managedWorkflowExamples.js";
import { EMPTY_PROCESS_CAPTURE_EXAMPLE } from "../../../src/domain/process/processCaptureExample.js";
import {
  managedNativeVerificationInputSchema,
  managedNativeVerificationResultSchema,
} from "../../../src/domain/managed/managedNativeVerificationSchemas.js";
import { nativeUiResultSchema } from "../../../src/domain/native/nativeUiObservation.js";
import { nativeLoadImageSchema } from "../../../src/domain/native/nativeLoadImage.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import type { JsonValue } from "../../../src/domain/jsonValue.js";
import { mcpTest } from "../../support/mcp/mcpFixture.js";
import { toolRegistrationOptions } from "../../../src/server/toolRegistrationOptions.js";

import { verifyManagedNativeVerificationSource } from "../../../src/domain/managed/managedNativeVerification.js";
import { readManagedNativeVerificationSource } from "../../../src/domain/managed/managedNativeVerificationSource.js";
import { processCaptureSchema } from "../../../src/domain/process/processCapture.js";
const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Expected a schema object");
  return value as Record<string, unknown>;
};

const schemaNode = (
  root: Record<string, unknown>,
  value: unknown,
): Record<string, unknown> => {
  const schema = record(value);
  if (typeof schema.$ref !== "string") return schema;
  if (!schema.$ref.startsWith("#/"))
    throw new Error("Expected a local advertised schema reference");
  const referenced = schema.$ref
    .slice(2)
    .split("/")
    .reduce<unknown>(
      (parent, key) =>
        record(parent)[key.replaceAll("~1", "/").replaceAll("~0", "~")],
      root,
    );
  return { ...record(referenced), ...schema };
};

it("advertises semantic output invariants and keeps producers aligned with Zod", async () => {
  const contracts = [
    toolContract("capture_native_ui_scenario"),
    toolContract("capture_process_scenario"),
    toolContract("verify_managed_native_boundaries"),
  ];
  const server = new McpServer({
    name: "output-schema-semantics",
    version: "1",
  });
  const client = new Client({ name: "output-schema-semantics", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  for (const contract of contracts)
    server.registerTool(
      contract.name,
      toolRegistrationOptions(contract),
      async () => ({ content: [] }),
    );

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const advertised = new Map(
      (await client.listTools()).tools.map((tool) => [tool.name, tool]),
    );
    const outputResultSchema = (name: (typeof contracts)[number]["name"]) => {
      const tool = advertised.get(name);
      if (tool?.outputSchema === undefined)
        throw new Error(`${name} output schema missing`);
      const outputSchema = record(tool.outputSchema);
      const result = record(record(outputSchema.properties).normalized_result);
      const standaloneResultSchema = z.record(z.string(), z.unknown()).parse({
        ...result,
        ...(typeof outputSchema.$schema === "string"
          ? { $schema: outputSchema.$schema }
          : {}),
        ...(outputSchema.$defs === undefined
          ? {}
          : { $defs: outputSchema.$defs }),
      });
      const node = (value: unknown) =>
        schemaNode(standaloneResultSchema, value);
      return {
        result: node(result),
        node,
        validate: new Ajv2020({
          strict: false,
          validateFormats: false,
        }).compile(standaloneResultSchema),
      };
    };

    const native = outputResultSchema("capture_native_ui_scenario");
    const initial = native.node(record(native.result.properties).initial);
    const screenshotUnion = native.node(record(initial.properties).screenshot);
    const screenshotVariants = screenshotUnion.anyOf;
    if (!Array.isArray(screenshotVariants))
      throw new Error("Expected nullable screenshot schema");
    const screenshotProperties = record(
      native.node(screenshotVariants[0]).properties,
    );
    expect(native.node(screenshotProperties.base64).description).toContain(
      "PNG signature",
    );
    expect(native.node(screenshotProperties.sha256).description).toContain(
      "decoded PNG bytes",
    );
    const pngBytes = Buffer.from("not a PNG");
    const invalidScreenshot = {
      target_sha256: "a".repeat(64),
      initial: {
        window: {
          pid: 1,
          window_id: 1,
          executable: "app",
          launch_time: 0,
          title: "",
        },
        nodes: [],
        truncated: false,
        screenshot: {
          mime_type: "image/png",
          base64: pngBytes.toString("base64"),
          sha256: createHash("sha256").update(pngBytes).digest("hex"),
          width: 1,
          height: 1,
        },
        gaps: [],
      },
      steps: [],
      restore: "leave-as-is",
      limitations: [],
    };
    expect(native.validate(invalidScreenshot)).toBe(true);
    expect(nativeUiResultSchema.safeParse(invalidScreenshot).success).toBe(
      false,
    );

    const process = outputResultSchema("capture_process_scenario");
    expect(process.result.description).toContain("canonical scenario");
    expect(process.result.description).toContain(
      "The event journal is required",
    );
    const validCapture = processCaptureSchema.parse(
      EMPTY_PROCESS_CAPTURE_EXAMPLE,
    );
    expect(validCapture.event_journal).toEqual([]);
    expect(process.validate(validCapture)).toBe(true);
    expect(
      processCaptureSchema.safeParse(EMPTY_PROCESS_CAPTURE_EXAMPLE).success,
    ).toBe(true);
    const invalidCapture = {
      ...validCapture,
      manifest: {
        ...validCapture.manifest,
        full_scenario_sha256: "0".repeat(64),
      },
    };
    expect(process.validate(invalidCapture)).toBe(true);
    expect(processCaptureSchema.safeParse(invalidCapture).success).toBe(false);

    const managed = outputResultSchema("verify_managed_native_boundaries");
    expect(managed.result.description).toContain(
      "accepted plus unsupported equals total",
    );
    const verificationSource = readManagedNativeVerificationSource(
      managedNativeVerificationInputSchema.parse(
        MANAGED_NATIVE_VERIFICATION_EXAMPLE,
      ),
    );
    if (!verificationSource.ok) throw verificationSource.error;
    const validVerification = verifyManagedNativeVerificationSource(
      verificationSource.value,
    );
    expect(managed.validate(validVerification)).toBe(true);
    const invalidVerification = structuredClone(validVerification);
    invalidVerification.summary.verified += 1;
    expect(managed.validate(invalidVerification)).toBe(true);
    expect(
      managedNativeVerificationResultSchema.safeParse(invalidVerification)
        .success,
    ).toBe(false);
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
});

mcpTest(
  "advertises and enforces the observed load-image coordinate grammar",
  async ({ mcp }) => {
    const contract = toolContract("inspect_native_load_image");
    const server = new McpServer({
      name: "load-image-coordinates",
      version: "1",
    });
    const image = {
      status: "unsupported",
      reason: "No format-specific comparison was performed",
      observations: {
        executable_format: "ELF",
        language_id: "AARCH64:LE:64:v8A",
        compiler_spec_id: "default",
        image_base: "ram%2Fbank:0x0000",
        default_address_space: "ram",
        source_files: [],
        mappings: [],
        relocations: [],
        entry_points: ["0x10000000000000001"],
        entry_context: [],
      },
      limitations: [],
    };
    const evidence = (result: JsonValue) =>
      createEvidence(
        undefined,
        { id: "ghidra", name: "Controlled bridge result", version: "12.1.4" },
        { operation: contract.name, parameters: {}, result },
      );
    let reply = evidence(image);
    server.registerTool(
      contract.name,
      toolRegistrationOptions(contract),
      async () => ({
        content: [],
        structuredContent: reply,
      }),
    );
    const client = await mcp.connect(server);
    const advertised = (await client.listTools()).tools.find(
      ({ name }) => name === contract.name,
    );
    if (advertised?.outputSchema === undefined)
      throw new Error("Load-image output schema missing");
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const outputSchema = z
      .record(z.string(), z.unknown())
      .parse(advertised.outputSchema);
    expect(ajv.validateSchema(outputSchema)).toBe(true);
    const validate = ajv.compile(outputSchema);
    expect(nativeLoadImageSchema.parse(image)).toEqual(image);
    expect(validate(reply)).toBe(true);
    const accepted = await client.callTool({
      name: contract.name,
      arguments: {},
    });
    expect(accepted.isError).not.toBe(true);
    expect(accepted.structuredContent).toEqual(reply);

    const malformed = {
      ...image,
      observations: { ...image.observations, image_base: "not-an-address" },
    };
    reply = evidence(malformed);
    expect(nativeLoadImageSchema.safeParse(malformed).success).toBe(false);
    expect(validate(reply)).toBe(false);
    const rejected = await client.callTool({
      name: contract.name,
      arguments: {},
    });
    expect(rejected.isError).toBe(true);
    expect(rejected.structuredContent).toBeUndefined();
  },
);
