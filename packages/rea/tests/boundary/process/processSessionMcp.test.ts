import { fileURLToPath } from "node:url";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import {
  createCacheProvider,
  createTestBinarySession,
} from "../../fixtures/binarySession.js";
import { createServer } from "../../../src/server/createServer.js";
import { silentLogger } from "../../../src/logger.js";
import { itWithCaptureCapability } from "./processCaptureCapability.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const processFixture = fileURLToPath(
  new URL("../../fixtures/processFidelity.mjs", import.meta.url),
);
const resources: Array<{ close(): Promise<unknown> }> = [];

afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
});

it("rejects oversized initial and resize terminal buffers through MCP before launching", async () => {
  const root = await createTestTempDirectory("rea-terminal-admission-");
  const marker = join(root, "launched");
  const session = createTestBinarySession(() => {
    throw new Error("Terminal admission must not launch a binary provider");
  });
  const server = createServer(
    { kind: "session", session },
    { logger: silentLogger },
  );
  const client = new Client({ name: "terminal-admission", version: "1" });
  resources.push(client, server, session);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  for (const input of [
    { terminal: { columns: 1_000, rows: 1, scrollback: 1_000 } },
    { events: [{ type: "resize", at_ms: 10, columns: 1_000, rows: 1 }] },
  ] as const) {
    const result = await client.callTool({
      name: "capture_process_scenario",
      arguments: {
        executable: process.execPath,
        arguments: [
          "-e",
          "require('node:fs').writeFileSync(process.argv[1], 'launched')",
          marker,
        ],
        ...input,
      },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("1000000"),
      }),
    );
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  }
  await client.ping();
});

itWithCaptureCapability(
  "bounds normalized PTY text and preserves equal-size output through MCP",
  async () => {
    const root = await createTestTempDirectory(
      "rea-process-normalized-budget-",
    );
    const session = createTestBinarySession(createCacheProvider([]));
    const server = createServer(
      { kind: "session", session },
      { logger: silentLogger },
    );
    const client = new Client({
      name: "process-normalized-budget",
      version: "1",
    });
    resources.push(client, server, session);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const capture = async (replacement: string) => {
      const result = await client.callTool({
        name: "capture_process_scenario",
        arguments: {
          executable: process.execPath,
          working_directory: root,
          arguments: ["-e", 'process.stdout.write("a".repeat(100) + "\\n")'],
          limits: { output_bytes: 1_000 },
          normalization: {
            paths: false,
            pids: false,
            ports: false,
            patterns: [{ pattern: "a", replacement }],
          },
          settle_ms: 50,
        },
      });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      return toolContract("capture_process_scenario").outputSchema.parse(
        result.structuredContent,
      ).normalized_result;
    };

    const expanded = await capture("x".repeat(500));
    expect(expanded.frames).toHaveLength(0);
    expect(expanded.truncated).toBe(true);
    expect(expanded.truncation_details.normalized_terminal).toMatchObject({
      budget_bytes: 1_000,
      retained_bytes: 0,
      omitted_frames: expect.any(Number),
    });
    expect(
      expanded.truncation_details.normalized_terminal?.omitted_frames,
    ).toBeGreaterThan(0);
    expect(expanded.truncation_details.raw_terminal).toMatchObject({
      budget_bytes: 1_000,
      observed_bytes: expect.any(Number),
      retained_bytes: 0,
      observed_frames: expect.any(Number),
      retained_frames: 0,
    });
    expect(
      expanded.limitations.some((limitation) =>
        limitation.includes(
          "final normalized sizes for the latter omissions are unknown",
        ),
      ),
    ).toBe(true);
    expect(expanded.cleanup).toMatchObject({
      owned_process_group: "verified",
      temporary_root: "removed",
    });

    const equalSize = await capture("b");
    // This short-lived target can exit before process sampling finishes.
    // Assert the terminal coverage that this normalization control exercises.
    expect(equalSize.truncation_details.raw_terminal).toMatchObject({
      observed_bytes: Buffer.byteLength(`${"a".repeat(100)}\r\n`),
      retained_bytes: Buffer.byteLength(`${"a".repeat(100)}\r\n`),
    });
    expect(equalSize.frames.map(({ data }) => data).join("")).toBe(
      `${"b".repeat(100)}\r\n`,
    );
    expect(equalSize.truncation_details.normalized_terminal).toMatchObject({
      budget_bytes: 1_000,
      retained_bytes: Buffer.byteLength(`${"b".repeat(100)}\r\n`),
      omitted_frames: 0,
    });
    expect(equalSize.cleanup).toMatchObject({
      owned_process_group: "verified",
      temporary_root: "removed",
    });
  },
  30_000,
);

itWithCaptureCapability(
  "records process residuals linked to capture Evidence",
  async () => {
    const session = createTestBinarySession(createCacheProvider([]));
    const server = createServer(
      { kind: "session", session },
      {
        logger: silentLogger,
      },
    );
    const mcp = new Client({ name: "process-unknown", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    resources.push(mcp, server);
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);

    const captured = await mcp.callTool({
      name: "capture_process_scenario",
      arguments: {
        executable: process.execPath,
        arguments: [processFixture, "partial"],
      },
    });
    expect(captured.isError, JSON.stringify(captured.content)).not.toBe(true);
    const contract = toolContract("capture_process_scenario");
    const wire = (await mcp.listTools()).tools.find(
      ({ name }) => name === contract.name,
    );
    if (wire?.outputSchema === undefined)
      throw new Error("Missing process capture output schema");
    expect(
      new Ajv2020({ strict: false, validateFormats: false }).validate(
        z.record(z.string(), z.unknown()).parse(wire.outputSchema),
        captured.structuredContent,
      ),
    ).toBe(true);
    const evidence = contract.outputSchema.parse(captured.structuredContent);
    const listedUnknowns = await mcp.callTool({
      name: "list_unknowns",
      arguments: {},
    });
    expect(
      listedUnknowns.isError,
      JSON.stringify(listedUnknowns.content),
    ).not.toBe(true);
    const listed = z
      .object({
        result: z.object({
          items: z.array(
            z.object({
              question: z.string(),
              domain: z.string(),
            }),
          ),
        }),
      })
      .parse(listedUnknowns.structuredContent).result.items;
    expect(listed).toContainEqual(
      expect.objectContaining({
        question: `Was network behavior fully observed during capture? (Evidence ${evidence.evidence_id})`,
        domain: "process-network",
      }),
    );
  },
);

itWithCaptureCapability(
  "resolves and inherits the server's selected environment through MCP",
  async () => {
    const root = await createTestTempDirectory("rea-process-mcp-env-");
    const bin = join(root, "bin");
    const executable = join(bin, "rea-injected-process-probe");
    await mkdir(bin);
    await writeFile(
      executable,
      [
        "#!/bin/sh",
        'printf "%s|%s\\n" "$REA_CAPTURE_INJECTED_MARKER" "$REA_CAPTURE_SCENARIO_OVERRIDE"',
      ].join("\n"),
    );
    await chmod(executable, 0o755);
    const session = createTestBinarySession(createCacheProvider([]));
    const server = createServer(
      { kind: "session", session },
      {
        logger: silentLogger,
        environment: {
          PATH: bin,
          REA_CAPTURE_INJECTED_MARKER: "injected-value",
          REA_CAPTURE_SCENARIO_OVERRIDE: "host-value",
        },
      },
    );
    const client = new Client({ name: "process-mcp-env", version: "1" });
    resources.push(client, server, session);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "capture_process_scenario",
      arguments: {
        executable: "rea-injected-process-probe",
        working_directory: root,
        environment: { REA_CAPTURE_SCENARIO_OVERRIDE: "scenario-value" },
      },
    });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    const capture = toolContract("capture_process_scenario").outputSchema.parse(
      result.structuredContent,
    ).normalized_result;
    expect(capture.frames.map(({ data }) => data).join("")).toContain(
      "injected-value|scenario-value",
    );
  },
);
