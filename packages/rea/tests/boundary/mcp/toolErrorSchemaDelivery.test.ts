import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it, onTestFinished } from "vitest";
import { z } from "zod";

import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

it("delivers typed tool failures without violating the advertised success schema over stdio", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-tool-error-schema-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const missing = join(root, "not-present.bin");
  const { client, call } = await connectLocalToolsMcp();
  const tools = (await client.listTools()).tools;
  const failures: string[] = [];
  const requests = [
    { name: "list_documents", arguments: {} },
    { name: "open_binary", arguments: { path: missing } },
    {
      name: "analyze_javascript_application",
      arguments: { input_path: missing },
    },
    { name: "inspect_artifact", arguments: {} },
  ];
  for (const request of requests) {
    const tool = tools.find(({ name }) => name === request.name);
    if (tool?.outputSchema === undefined)
      throw new Error(`${request.name} omitted its output schema`);
    const reply = await client.callTool(request, { toolDefinition: tool });
    const diagnostic = parseMcpToolError(reply);
    expect(diagnostic.error.message, request.name).not.toBe("");
    if ("path" in request.arguments || "input_path" in request.arguments)
      expect(JSON.stringify(diagnostic), request.name).toContain(
        JSON.stringify(missing).slice(1, -1),
      );
    if (reply.structuredContent !== undefined) {
      const validate = new Ajv2020({
        strict: false,
        validateFormats: false,
      }).compile(z.record(z.string(), z.unknown()).parse(tool.outputSchema));
      if (!validate(reply.structuredContent)) failures.push(request.name);
    }
  }
  expect(failures).toEqual([]);
  const successful = await call("get_evidence_bundle", {});
  expect(successful.isError).not.toBe(true);
  expect(successful.structuredContent).toBeDefined();
  await client.ping();
});
