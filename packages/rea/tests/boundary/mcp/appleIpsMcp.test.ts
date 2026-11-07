import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import { appleIpsSchema } from "../../../src/domain/native/appleIps.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { appleIpsBytes } from "../../fixtures/binaryDiagnostics/appleIps.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
it("advertises and validates IPS facts and failures through production stdio MCP", async () => {
  const { client, call } = await connectLocalToolsMcp();
  const advertised = (await client.listTools()).tools.find(
    (tool) => tool.name === "inspect_apple_ips",
  );
  if (advertised?.outputSchema === undefined)
    throw new Error("Missing advertised IPS output schema");
  const inputSchema: Record<string, unknown> = advertised.inputSchema;
  const outputSchema: Record<string, unknown> = advertised.outputSchema;
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(advertised?.annotations).toMatchObject({
    readOnlyHint: false,
    idempotentHint: true,
  });
  const root = await createTestTempDirectory("rea-apple-ips-mcp-");
  const path = join(root, "report.ips");
  await writeFile(path, appleIpsBytes());
  expect(ajv.validate(inputSchema, { path, max_integer_text_bytes: 1 })).toBe(
    true,
  );
  const constrained = await call("inspect_apple_ips", {
    path,
    max_integer_text_bytes: 1,
  });
  expect(constrained.isError).toBe(true);
  expect(parseMcpToolError(constrained).error).toMatchObject({
    code: "resource_constraint",
    remediation: {
      action: expect.stringContaining(
        "Raise max_integer_text_bytes on the next call",
      ),
    },
    details: {
      reported_limits: { boundary: "integer_text", maximum: 1 },
    },
  });
  const response = await call("inspect_apple_ips", { path });
  expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
  expect(
    ajv.validate(outputSchema, response.structuredContent),
    JSON.stringify(ajv.errors),
  ).toBe(true);
  const evidence = parseEvidence(response.structuredContent);
  const report = appleIpsSchema.parse(evidence.normalized_result);
  expect(evidence.operation).toBe("inspect_apple_ips");
  expect(report.metadata.bug_type).toBe("309");
  expect(report.threads[0]?.registers[0]).toMatchObject({
    name: "x0",
    value: {
      decimal: "9594637537912899908",
      hex: "0x8527000193ed4944",
    },
  });
  expect(report.classification.status).toBe("unclassified");
  const unsupported = {
    ...evidence,
    normalized_result: {
      ...report,
      metadata: { ...report.metadata, bug_type: "288" },
    },
  };
  expect(ajv.validate(outputSchema, unsupported)).toBe(false);
  const match = {
    rule: "watchdog",
    fields: [{ name: "termination.code", value: "2343432205" }],
  };
  for (const [status, matches, accepted] of [
    ["classified", [], false],
    ["classified", [match], true],
    ["unclassified", [match], false],
    ["unclassified", [], true],
  ] as const) {
    expect(
      ajv.validate(outputSchema, {
        ...evidence,
        normalized_result: { ...report, classification: { status, matches } },
      }),
    ).toBe(accepted);
  }

  const whitespacePath = join(root, "non-json-whitespace.ips");
  await writeFile(
    whitespacePath,
    Buffer.concat([appleIpsBytes(), Buffer.from("\f")]),
  );
  const whitespace = await call("inspect_apple_ips", { path: whitespacePath });
  expect(whitespace.isError).toBe(true);
  expect(parseMcpToolError(whitespace).error.code).toBe("invalid_request");

  const malformedPath = join(root, "malformed-uuid.ips");
  await writeFile(malformedPath, appleIpsBytes({ uuid: "malformed/report" }));
  const malformed = await call("inspect_apple_ips", { path: malformedPath });
  expect(malformed.isError, JSON.stringify(malformed.content)).not.toBe(true);
  expect(
    ajv.validate(outputSchema, malformed.structuredContent),
    JSON.stringify(ajv.errors),
  ).toBe(true);
  const partial = appleIpsSchema.parse(
    parseEvidence(malformed.structuredContent).normalized_result,
  );
  expect(partial.coverage.status).toBe("partial");
  expect(partial.coverage.type_mismatches).toEqual([
    {
      path: "body.usedImages[0].uuid",
      expected: "32 hexadecimal UUID digits with optional canonical hyphens",
      observed: "malformed UUID string",
      recorded_value: "malformed/report",
    },
  ]);
  const indexPath = join(root, "unresolved-indexes.ips");
  await writeFile(
    indexPath,
    '{"bug_type":"309"}\n{"faultingThread":5,"threads":[{"frames":[{"imageIndex":-1},{"imageIndex":4294967296}]}],"usedImages":[]}',
  );
  const indexes = await call("inspect_apple_ips", { path: indexPath });
  expect(indexes.isError, JSON.stringify(indexes.content)).not.toBe(true);
  expect(
    ajv.validate(outputSchema, indexes.structuredContent),
    JSON.stringify(ajv.errors),
  ).toBe(true);
  const unresolved = appleIpsSchema.parse(
    parseEvidence(indexes.structuredContent).normalized_result,
  );
  expect(unresolved.faulting_thread).toBe(5);
  expect(unresolved.threads[0]?.frames[0]?.role).toBe("unknown");
  expect(unresolved.coverage.status).toBe("partial");
  expect(
    unresolved.coverage.type_mismatches.map(
      (mismatch) => mismatch.recorded_integer,
    ),
  ).toEqual(["5", "-1", "4294967296"]);
  const relative = await call("inspect_apple_ips", { path: "report.ips" });
  expect(relative.isError).toBe(true);
  expect(parseMcpToolError(relative).error).toMatchObject({
    code: "invalid_request",
    details: { operation: "inspect_apple_ips" },
  });
});
