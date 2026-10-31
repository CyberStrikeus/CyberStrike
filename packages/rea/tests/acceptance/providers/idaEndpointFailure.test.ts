import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { expect } from "vitest";

import { elf } from "../../../src/domain/binaryTarget.fixture.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { workspaceCliTest as test } from "../../support/cli/workspaceCliFixture.js";

for (const encodedCredential of [false, true])
  test(`preserves the selected IDA endpoint on a real HTTP failure (encoded credential: ${String(encodedCredential)})`, async ({
    cli,
    workspace,
  }) => {
    const server = createServer((_request, response) => {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("fixture-ida-not-found");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    let closed = false;
    try {
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("Missing loopback listener address");
      const base = `HTTP://127.0.0.1:0${address.port}/mcp?cursor=kept`;
      const endpoint = encodedCredential
        ? `${base}&token=fixture%2Dsecret`
        : base;
      const expectedEndpoint = encodedCredential
        ? `${base}&token=[redacted transport credential]`
        : base;
      const target = workspace.path("target.elf");
      const registration = workspace.path("ida.json");
      await writeFile(target, elf(2, 1, 62));
      await writeFile(
        registration,
        JSON.stringify({
          url: endpoint,
          headers: { Authorization: "Bearer fixture-secret" },
        }),
      );
      const result = await cli.run({
        arguments: ["analyze", target, "--provider", "ida", "--json"],
        environment: { REA_IDA_MCP_CONFIG: registration },
      });
      expect(result.exitCode, result.stderr).toBe(1);
      expect(result.json).toMatchObject({
        code: "execution_failure",
        details: { diagnostics: { endpoint: expectedEndpoint } },
      });
      expect(JSON.stringify(result.json)).toContain("fixture-ida-not-found");
      expect(JSON.stringify(result.json)).not.toContain("fixture-secret");
      expect(JSON.stringify(result.json)).not.toContain("fixture%2Dsecret");
      const { call } = await connectLocalToolsMcp({
        REA_IDA_MCP_CONFIG: registration,
      });
      const opened = await call("open_binary", {
        path: target,
        provider_id: "ida",
      });
      if (opened.isError) throw new Error(JSON.stringify(opened));
      const failure = parseMcpToolError(await call("list_procedures", {}));
      expect(failure.error).toMatchObject({
        code: "execution_failure",
        details: { diagnostics: { endpoint: expectedEndpoint } },
      });
      expect(JSON.stringify(failure)).not.toContain("fixture-secret");
      expect(JSON.stringify(failure)).not.toContain("fixture%2Dsecret");
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      closed = true;
      const stopped = await cli.run({
        arguments: ["analyze", target, "--provider", "ida", "--json"],
        environment: { REA_IDA_MCP_CONFIG: registration },
      });
      expect(stopped.exitCode, stopped.stderr).toBe(1);
      expect(stopped.json).toMatchObject({
        code: "execution_failure",
        details: {
          diagnostics: {
            endpoint: expectedEndpoint,
            reason: expect.stringContaining("fetch failed"),
          },
        },
      });
    } finally {
      if (!closed) {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  });
