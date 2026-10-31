import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createMcpSchemaValidation } from "../../fixtures/mcpSchemaValidation.js";
import { afterAll, expect, it } from "vitest";
import { pythonPycSchema } from "../../../src/domain/python/pythonPyc.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import {
  marshalCode,
  pythonPycFixture,
  pythonPycHeader,
} from "../../../src/python/PythonPyc.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";

const completePycEvidenceSchema = toolContract(
  "inspect_python_pyc",
).outputSchema.safeExtend({ normalized_result: pythonPycSchema });

const marshalInt64 = (value: bigint): Buffer => {
  const payload = Buffer.alloc(8);
  payload.writeBigInt64LE(value);
  return Buffer.concat([Buffer.from([0x49]), payload]);
};

const marshalInt32 = (value: number): Buffer => {
  const payload = Buffer.alloc(4);
  payload.writeInt32LE(value);
  return Buffer.concat([Buffer.from([0x69]), payload]);
};

const marshalSingleItemTuple = (item: Buffer): Buffer =>
  Buffer.concat([Buffer.from([0x29, 1]), item]);

const schemaValidation = createMcpSchemaValidation();
afterAll(() => schemaValidation.clear());

const connect = () =>
  createApplicationMcpHarness({
    session: createTestBinarySession(() => {
      throw new Error("Python pyc inspection must not start a deep provider");
    }),
    serverOptions: {
      environment: {
        ...process.env,
        REA_MCP_MAX_INPUT_ELEMENTS: process.env.REA_MCP_MAX_INPUT_ELEMENTS,
      },
    },
    schemaValidator: schemaValidation,
  });

it("reads signed TYPE_INT64 constants and rejects a truncated payload", async () => {
  const { client, close } = await connect();
  try {
    const root = await createTestTempDirectory("rea-python-pyc-mcp-int64-");
    for (const [name, value, bits] of [
      ["positive", 42n, 6],
      ["negative", -1n, 1],
      ["minimum", -(1n << 63n), 64],
      ["maximum", (1n << 63n) - 1n, 63],
    ] as const) {
      const path = join(root, `${name}.pyc`);
      await writeFile(
        path,
        Buffer.concat([
          pythonPycHeader(3531),
          marshalCode("py311", {
            constsObject: marshalSingleItemTuple(marshalInt64(value)),
          }),
        ]),
      );
      const response = await client.callTool({
        name: "inspect_python_pyc",
        arguments: { path },
      });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      const evidence = completePycEvidenceSchema.parse(
        response.structuredContent,
      );
      expect(evidence.normalized_result.code_objects[0]?.consts).toContainEqual(
        { kind: "int", bits, value: value.toString() },
      );
    }

    const ordinaryPath = join(root, "ordinary-int.pyc");
    await writeFile(
      ordinaryPath,
      Buffer.concat([
        pythonPycHeader(3531),
        marshalCode("py311", {
          constsObject: marshalSingleItemTuple(marshalInt32(-42)),
        }),
      ]),
    );
    const ordinary = await client.callTool({
      name: "inspect_python_pyc",
      arguments: { path: ordinaryPath },
    });
    expect(ordinary.isError, JSON.stringify(ordinary.content)).not.toBe(true);
    const ordinaryEvidence = completePycEvidenceSchema.parse(
      ordinary.structuredContent,
    );
    expect(
      ordinaryEvidence.normalized_result.code_objects[0]?.consts,
    ).toContainEqual({ kind: "int", bits: 6, value: "-42" });

    const truncatedPath = join(root, "truncated.pyc");
    await writeFile(
      truncatedPath,
      Buffer.concat([
        pythonPycHeader(3531),
        Buffer.from([0x49]),
        Buffer.alloc(7),
      ]),
    );
    const truncated = await client.callTool({
      name: "inspect_python_pyc",
      arguments: { path: truncatedPath },
    });
    expect(truncated.isError).toBe(true);
    expect(parseMcpToolError(truncated).error).toMatchObject({
      code: "invalid_request",
      details: {
        operation: "inspect_python_pyc",
        issues: [
          {
            reason: "invalid_format",
            message: expect.stringContaining("64-bit integer"),
          },
        ],
      },
    });
  } finally {
    await close();
  }
});

it("advertises inspect_python_pyc and reads nested code objects", async () => {
  const { client, close } = await connect();
  try {
    const advertised = (await client.listTools()).tools.find(
      (tool) => tool.name === "inspect_python_pyc",
    );
    expect(advertised?.annotations).toMatchObject({
      readOnlyHint: false,
      idempotentHint: true,
    });
    if (advertised?.outputSchema === undefined)
      throw new Error("Missing inspect_python_pyc output schema");
    const outputSchema: Record<string, unknown> = advertised.outputSchema;
    const ajv = schemaValidation.assertions;
    expect(ajv.validateSchema(outputSchema)).toBe(true);
    const root = await createTestTempDirectory("rea-python-pyc-mcp-");
    const path = join(root, "sample.pyc");
    const nested = marshalCode("py311", {
      name: "inner",
      firstlineno: -7,
    });
    await writeFile(
      path,
      Buffer.concat([
        pythonPycHeader(3531),
        marshalCode("py311", {
          firstlineno: -1,
          consts: [nested],
        }),
      ]),
    );
    const response = await client.callTool({
      name: "inspect_python_pyc",
      arguments: { path },
    });
    expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
    const evidence = completePycEvidenceSchema.parse(
      response.structuredContent,
    );
    expect(
      ajv.validate(outputSchema, response.structuredContent),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    expect(evidence.normalized_result.header.python_version).toBe("3.12");
    expect(evidence.normalized_result.code_objects[0]?.firstlineno).toBe(-1);
    expect(evidence.normalized_result.code_objects[1]?.name).toBe("inner");
    expect(evidence.normalized_result.code_objects[1]?.firstlineno).toBe(-7);
    expect(evidence.normalized_result.code_objects[0]?.consts).toContainEqual({
      kind: "code",
      name: "inner",
      firstlineno: -7,
    });
  } finally {
    await close();
  }
});

it("requires an absolute path for inspect_python_pyc", async () => {
  const { client, close } = await connect();
  try {
    const response = await client.callTool({
      name: "inspect_python_pyc",
      arguments: { path: "sample.pyc" },
    });
    expect(response.isError).toBe(true);
    expect(parseMcpToolError(response).error).toMatchObject({
      code: "invalid_request",
      details: { operation: "inspect_python_pyc" },
    });
  } finally {
    await close();
  }
});

it("advertised pyc output schema preserves historical signed fields", async () => {
  const { client, close } = await connect();
  try {
    const advertised = (await client.listTools()).tools.find(
      (tool) => tool.name === "inspect_python_pyc",
    );
    if (advertised?.outputSchema === undefined)
      throw new Error("Missing inspect_python_pyc output schema");
    const outputSchema: Record<string, unknown> = advertised.outputSchema;
    const ajv = schemaValidation.assertions;
    const root = await createTestTempDirectory("rea-python-pyc-mcp-flags-");
    for (const testCase of [
      {
        name: "legacy-negative",
        magic: 3394,
        layout: "py37" as const,
        fields: { stacksize: 0xffffffff },
        expected: { stacksize: -1, flags: 0 },
      },
      {
        name: "alpha-3401-negative-flags",
        magic: 3401,
        layout: "py37" as const,
        fields: { flags: 0x80000000 },
        expected: { stacksize: 1, flags: -0x80000000 },
      },
      {
        name: "ambiguous-3410-negative-fields",
        magic: 3410,
        layout: "py38" as const,
        fields: { stacksize: 0xffffffff, flags: 0x80000000 },
        expected: { stacksize: -1, flags: -0x80000000 },
      },
      {
        name: "unknown-positive",
        magic: 3531,
        layout: "py311" as const,
        fields: { flags: 0x40000000 },
        expected: { flags: 0x40000000 },
      },
    ]) {
      const path = join(root, `${testCase.name}.pyc`);
      await writeFile(
        path,
        Buffer.concat([
          pythonPycHeader(testCase.magic),
          marshalCode(testCase.layout, testCase.fields),
        ]),
      );
      const response = await client.callTool({
        name: "inspect_python_pyc",
        arguments: { path },
      });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      const evidence = completePycEvidenceSchema.parse(
        response.structuredContent,
      );
      expect(
        ajv.validate(outputSchema, response.structuredContent),
        JSON.stringify(ajv.errors),
      ).toBe(true);
      expect(evidence.normalized_result.code_objects[0]).toMatchObject(
        testCase.expected,
      );
      if (testCase.magic === 3410)
        expect(evidence.normalized_result.limitations).toEqual(
          expect.arrayContaining([
            expect.stringContaining("Magic 3410 is shared"),
          ]),
        );
    }
  } finally {
    await close();
  }
});

it("rejects negative code fields for magics after constructor validation was added", async () => {
  const { client, close } = await connect();
  try {
    const root = await createTestTempDirectory("rea-python-pyc-mcp-signed-");
    for (const { name, fields, message } of [
      {
        name: "negative-stacksize",
        fields: { stacksize: 0xffffffff },
        message: "co_stacksize is negative",
      },
      {
        name: "negative-flags",
        fields: { flags: 0x80000000 },
        message: "co_flags is negative",
      },
    ]) {
      const path = join(root, `${name}.pyc`);
      await writeFile(
        path,
        Buffer.concat([pythonPycHeader(3411), marshalCode("py38", fields)]),
      );
      const response = await client.callTool({
        name: "inspect_python_pyc",
        arguments: { path },
      });
      expect(response.isError).toBe(true);
      expect(parseMcpToolError(response).error).toMatchObject({
        code: "invalid_request",
        details: {
          operation: "inspect_python_pyc",
          issues: [
            {
              reason: "invalid_format",
              message: expect.stringContaining(message),
            },
          ],
        },
      });
    }
  } finally {
    await close();
  }
});

it("reports an unknown pyc magic as unsupported", async () => {
  const { client, close } = await connect();
  try {
    const root = await createTestTempDirectory("rea-python-pyc-mcp-magic-");
    const path = join(root, "unknown.pyc");
    const bytes = pythonPycFixture("py311");
    bytes.writeUInt16LE(1, 0);
    await writeFile(path, bytes);
    const response = await client.callTool({
      name: "inspect_python_pyc",
      arguments: { path },
    });
    expect(response.isError).toBe(true);
    expect(parseMcpToolError(response).error).toMatchObject({
      code: "unsupported_target",
      details: { operation: "inspect_python_pyc" },
    });
  } finally {
    await close();
  }
});
