import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect } from "vitest";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { peResourcesSchema } from "../../../src/domain/native/peResources.js";
import { peResourceFixture } from "../../../src/native/pe/PeResources.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import {
  cliTest,
  runFileCli,
  type TestCli,
} from "../../support/cli/cliFixture.js";

type PeResourceCall = (
  arguments_: Record<string, unknown>,
) => ReturnType<Client["callTool"]>;

const expectPeInputFailureAcrossAdapters = async (input: {
  readonly cli: TestCli;
  readonly call: PeResourceCall;
  readonly path: string;
  readonly reason: "invalid_format" | "invalid_value";
}) => {
  const { cli, call, path, reason } = input;
  const result = await runFileCli(cli, {
    arguments: ["inspect-pe-resources", path, "--json"],
  });
  expect(result.exitCode).toBe(1);
  expect(result.json).toMatchObject({
    code: "invalid_request",
    category: "invalid_input",
    details: {
      operation: "inspect_pe_resources",
      issues: [{ path: ["path"], reason }],
    },
  });
  const response = await call({ path });
  expect(response.isError).toBe(true);
  expect(parseMcpToolError(response)).toEqual({ error: result.json });
};

const expectPePaddingFailureAcrossAdapters = async (input: {
  readonly cli: TestCli;
  readonly call: PeResourceCall;
  readonly path: string;
}) => {
  const { cli, call, path } = input;
  const fixture = peResourceFixture();
  const virtualSize = fixture.bytes.readUInt32LE(fixture.sectionAt + 8);
  fixture.bytes.writeUInt32LE(
    0x2000 + virtualSize,
    fixture.dataOffsets[0] ?? 0,
  );
  fixture.bytes.writeUInt32LE(4, (fixture.dataOffsets[0] ?? 0) + 4);
  await writeFile(path, fixture.bytes);
  const cliResult = await cli.run({
    arguments: ["inspect-pe-resources", path, "--json"],
  });
  expect(cliResult.exitCode).not.toBe(0);
  const mcpResult = await call({ path });
  expect(mcpResult.isError).toBe(true);
  expect(peResourcesSchema.safeParse(mcpResult.structuredContent).success).toBe(
    false,
  );
};

const expectPeInputFailuresAcrossAdapters = async (input: {
  readonly cli: TestCli;
  readonly call: PeResourceCall;
  readonly root: string;
}) => {
  const { cli, call, root } = input;
  const malformedPath = join(root, "malformed.exe");
  await writeFile(malformedPath, Buffer.from("not a PE image"));
  for (const [path, reason] of [
    [join(root, "missing.exe"), "invalid_value"],
    [malformedPath, "invalid_format"],
  ] as const)
    await expectPeInputFailureAcrossAdapters({
      cli,
      call,
      path,
      reason,
    });
};

const contract = toolContract("inspect_pe_resources");

const expectPeWordAlignedRecordsAcrossAdapters = async (input: {
  readonly cli: TestCli;
  readonly call: PeResourceCall;
  readonly root: string;
}): Promise<void> => {
  const { cli, call, root } = input;
  for (const plus of [false, true]) {
    for (const [index, identities] of [
      { type: 10, name: 1, language: "AB" },
      { type: "AB", name: 1, language: 1033 },
    ].entries()) {
      const fixture = peResourceFixture(
        plus,
        [{ ...identities, payload: Buffer.from("opaque resource") }],
        65536,
        2,
      );
      const path = join(root, `word-aligned-${plus}-${index}.exe`);
      await writeFile(path, fixture.bytes);
      const result = await runFileCli(cli, {
        arguments: ["inspect-pe-resources", path, "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const evidence = contract.outputSchema.parse(result.json);
      const report = peResourcesSchema.parse(evidence.normalized_result);
      expect(report.coverage).toMatchObject({
        status: "complete",
        resources: 1,
      });
      expect(report.resources[0]?.data_entry_location).toEqual({
        offset: fixture.dataOffsets[0],
        bytes: 16,
      });
      expect(report.resources[0]?.payload.sha256).toBe(
        createHash("sha256").update("opaque resource").digest("hex"),
      );
      const response = await call({ path });
      expect(response.isError).not.toBe(true);
      expect(
        contract.outputSchema.parse(response.structuredContent)
          .normalized_result,
      ).toEqual(evidence.normalized_result);
      expect(Buffer.compare(await readFile(path), fixture.bytes)).toBe(0);
    }
  }
};

const expectPeMappingOwnershipAcrossAdapters = async (
  cli: TestCli,
  call: PeResourceCall,
  root: string,
): Promise<void> => {
  for (const { name, payloadRva, payloadBytes, section, expectedOffset } of [
    {
      name: "empty-header",
      payloadRva: 0x300,
      payloadBytes: 0,
      section: null,
      expectedOffset: 0x300,
    },
    {
      name: "header-section-collision",
      payloadRva: 0x300,
      payloadBytes: 0,
      section: { rva: 0x300, bytes: 4 },
      expectedOffset: null,
    },
    {
      name: "empty-section-in-header",
      payloadRva: 0x300,
      payloadBytes: 4,
      section: { rva: 0x301, bytes: 0 },
      expectedOffset: 0x300,
    },
    {
      name: "empty-section-in-resources",
      payloadRva: null,
      payloadBytes: 4,
      section: { rva: 0x2001, bytes: 0 },
      expectedOffset: "original",
    },
  ]) {
    const fixture = peResourceFixture(false, [
      { type: 10, name: 1, language: 1033, payload: Buffer.from("DATA") },
    ]);
    const data = fixture.dataOffsets[0] ?? 0;
    let bytes = fixture.bytes;
    const originalPayloadOffset = bytes.readUInt32LE(data) - 0x1c00;
    if (payloadRva !== null) bytes.writeUInt32LE(payloadRva, data);
    bytes.writeUInt32LE(payloadBytes, data + 4);
    if (section !== null) {
      bytes.writeUInt16LE(2, 0x86);
      const at = fixture.sectionAt + 40;
      bytes.writeUInt32LE(section.bytes, at + 8);
      bytes.writeUInt32LE(section.rva, at + 12);
      bytes.writeUInt32LE(section.bytes, at + 16);
      bytes.writeUInt32LE(bytes.length, at + 20);
      bytes = Buffer.concat([bytes, Buffer.alloc(section.bytes)]);
    }
    const path = join(root, `${name}.exe`);
    await writeFile(path, bytes);
    if (expectedOffset === null) {
      await expectPeInputFailureAcrossAdapters({
        cli,
        call,
        path,
        reason: "invalid_format",
      });
      continue;
    }
    const result = await runFileCli(cli, {
      arguments: ["inspect-pe-resources", path, "--json"],
    });
    expect(result.exitCode, name).toBe(0);
    const evidence = contract.outputSchema.parse(result.json);
    const response = await call({ path });
    expect(response.isError, name).not.toBe(true);
    const mcp = contract.outputSchema.parse(response.structuredContent);
    expect(mcp.subject).toEqual(evidence.subject);
    expect(mcp.evidence_id).toBe(evidence.evidence_id);
    expect(mcp.normalized_result).toEqual(evidence.normalized_result);
    expect(evidence.normalized_result).toMatchObject({
      coverage: { status: "complete", resources: 1 },
      resources: [
        {
          payload: {
            location: {
              offset:
                expectedOffset === "original"
                  ? originalPayloadOffset
                  : expectedOffset,
              bytes: payloadBytes,
            },
          },
        },
      ],
    });
    expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
  }
};

const expectPeInventoriesAcrossAdapters = async (
  cli: TestCli,
  call: PeResourceCall,
  root: string,
): Promise<void> => {
  for (const [plus, empty] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ]) {
    const fixture = peResourceFixture(plus);
    const virtualSize = fixture.bytes.readUInt32LE(fixture.sectionAt + 8);
    if (empty) {
      fixture.bytes.writeUInt32LE(0x2000 + virtualSize, fixture.dataOffsets[0]);
      fixture.bytes.writeUInt32LE(0, (fixture.dataOffsets[0] ?? 0) + 4);
    }
    const path = join(
      root,
      `resource${plus ? "64" : "32"}${empty ? "-empty" : ""}.exe`,
    );
    await writeFile(path, fixture.bytes);
    const invocation = {
      arguments: ["inspect-pe-resources", path, "--json"],
    };
    // Keep an independent public-wrapper process for both PE32 and PE32+.
    // The empty-payload variants reuse only compiled-command startup.
    const result = await (empty
      ? runFileCli(cli, invocation)
      : cli.run(invocation));
    expect(result.exitCode).toBe(0);
    const evidence = contract.outputSchema.parse(result.json);
    const report = peResourcesSchema.parse(evidence.normalized_result);
    expect(evidence.subject?.digest).toMatchObject({
      sha256: createHash("sha256").update(fixture.bytes).digest("hex"),
    });
    expect(evidence.subject?.architecture).toBe(plus ? "x86_64" : "x86");
    expect(report.coverage).toMatchObject({
      status: "complete",
      resources: 5,
    });
    expect(report.resources[0]?.payload.sha256).toBe(
      createHash("sha256")
        .update(empty ? "" : "ICON")
        .digest("hex"),
    );
    if (empty)
      expect(report.resources[0]?.payload.location).toEqual({
        offset: 0x400 + virtualSize,
        bytes: 0,
      });
    expect(
      report.resources.find(({ name }) => name.kind === "name")?.name,
    ).toMatchObject({ kind: "name", name: "7", utf16le_hex: "3700" });
    expect(report.icon_groups[0]?.images).toMatchObject([
      {
        resource_id: 1,
        candidate_resource_indices: [0, 1],
        same_language_resource_index: 0,
      },
      {
        resource_id: 99,
        candidate_resource_indices: [],
        same_language_resource_index: null,
      },
    ]);
    const response = await call({ path });
    expect(response.isError).not.toBe(true);
    const mcp = contract.outputSchema.parse(response.structuredContent);
    expect(mcp.subject).toEqual(evidence.subject);
    expect(mcp.evidence_id).toBe(evidence.evidence_id);
    expect(mcp.normalized_result).toEqual(evidence.normalized_result);
    const text = response.content.find(({ type }) => type === "text");
    if (text?.type !== "text") throw new Error("Missing MCP text Evidence");
    expect(contract.outputSchema.parse(JSON.parse(text.text)).evidence_id).toBe(
      evidence.evidence_id,
    );
    expect(Buffer.compare(await readFile(path), fixture.bytes)).toBe(0);
  }
};

const expectPeEmptyBranchesAcrossAdapters = async (
  cli: TestCli,
  call: PeResourceCall,
  root: string,
): Promise<void> => {
  for (const shared of [false, true]) {
    const fixture = shared
      ? peResourceFixture(true, [{ type: 10 }, { type: 11 }])
      : peResourceFixture(false, [
          { type: "10" },
          { type: 10 },
          { type: 11 },
          { type: 20, name: "7" },
          { type: 20, name: 7 },
          { type: 99, name: 1, language: 1033, payload: Buffer.from("opaque") },
        ]);
    if (shared) {
      // Two distinct root identities point to exactly the same empty table.
      fixture.bytes.writeUInt32LE(
        fixture.bytes.readUInt32LE(0x400 + 20),
        0x400 + 28,
      );
    }
    const path = join(
      root,
      shared ? "shared-empty64.exe" : "empty-branches32.exe",
    );
    await writeFile(path, fixture.bytes);
    const result = await runFileCli(cli, {
      arguments: ["inspect-pe-resources", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = contract.outputSchema.parse(result.json);
    const response = await call({ path });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const mcp = contract.outputSchema.parse(response.structuredContent);
    expect(mcp.normalized_result).toEqual(evidence.normalized_result);
    expect(mcp.evidence_id).toBe(evidence.evidence_id);
    const report = peResourcesSchema.parse(evidence.normalized_result);
    const paths = report.directories.map((directory) =>
      directory.path.map((identity) =>
        identity.kind === "id" ? identity.id : identity.name,
      ),
    );
    expect(paths).toEqual(
      shared
        ? [[], [10], [11]]
        : [[], ["10"], [10], [11], [20], [20, "7"], [20, 7], [99], [99, 1]],
    );
    expect(report.coverage).toEqual({
      status: "complete",
      examined_entries: shared ? 2 : 9,
      resources: shared ? 0 : 1,
    });
    for (const directory of report.directories)
      expect(directory.entry_locations).toHaveLength(directory.path.length);
    expect(report.directories[0]?.entry_locations).toEqual([]);
    if (shared) {
      expect(report.resources).toEqual([]);
      expect(report.directories[1]?.location).toEqual(
        report.directories[2]?.location,
      );
      expect(report.directories[1]?.entry_locations).toEqual([
        { offset: 0x400 + 16, bytes: 8 },
      ]);
      expect(report.directories[2]?.entry_locations).toEqual([
        { offset: 0x400 + 24, bytes: 8 },
      ]);
    } else {
      expect(report.directories[1]?.path).toEqual([
        {
          kind: "name",
          name: "10",
          utf16le_hex: "31003000",
          location: { offset: 0x400 + 56, bytes: 6 },
        },
      ]);
      expect(report.directories[5]?.path[1]).toMatchObject({
        kind: "name",
        name: "7",
        utf16le_hex: "3700",
      });
      const resource = report.resources[0]!;
      expect(resource.payload.sha256).toBe(
        createHash("sha256").update("opaque").digest("hex"),
      );
      expect(report.directories.at(-1)).toMatchObject({
        path: [resource.type, resource.name],
        entry_locations: resource.entry_locations.slice(0, 2),
      });
    }
    expect(evidence.subject?.digest?.sha256).toBe(
      createHash("sha256").update(fixture.bytes).digest("hex"),
    );
    expect(Buffer.compare(await readFile(path), fixture.bytes)).toBe(0);
  }
};

cliTest(
  "inspects PE32/PE32+ resources through compiled CLI and real stdio MCP without an active target",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-pe-resource-acceptance-");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("scripts/rea.mjs"), "mcp"],
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "", REA_LOG_LEVEL: "silent" },
      stderr: "pipe",
    });
    const client = new Client({ name: "pe-resource-acceptance", version: "1" });
    try {
      await client.connect(transport);
      const inventory = await client.listTools();
      const definition = inventory.tools.find(
        ({ name }) => name === contract.name,
      );
      if (definition === undefined)
        throw new Error("Missing PE resource tool contract");
      expect(inventory.tools).toContainEqual(
        expect.objectContaining({
          name: contract.name,
          annotations: expect.objectContaining({
            readOnlyHint: false,
            openWorldHint: false,
          }),
        }),
      );
      const call: PeResourceCall = (arguments_) =>
        client.callTool(
          { name: definition.name, arguments: arguments_ },
          { toolDefinition: definition },
        );
      const sessionDefinition = inventory.tools.find(
        ({ name }) => name === "binary_session",
      );
      if (sessionDefinition === undefined)
        throw new Error("Missing binary_session tool contract");
      const session = await client.callTool(
        { name: sessionDefinition.name, arguments: {} },
        { toolDefinition: sessionDefinition },
      );
      expect(session.isError, JSON.stringify(session)).not.toBe(true);
      const status = toolContract("binary_session").outputSchema.parse(
        session.structuredContent,
      ).result;
      expect(
        status.tool_availability.groups.find((group) =>
          group.names.includes("inspect_pe_resources"),
        ),
      ).toMatchObject({ available: true });
      await expectPeInventoriesAcrossAdapters(cli, call, root);
      await expectPeEmptyBranchesAcrossAdapters(cli, call, root);
      await expectPeWordAlignedRecordsAcrossAdapters({
        cli,
        call,
        root,
      });
      await expectPeMappingOwnershipAcrossAdapters(cli, call, root);
      await expectPePaddingFailureAcrossAdapters({
        cli,
        call,
        path: join(root, "raw-padding.exe"),
      });
      await expectPeInputFailuresAcrossAdapters({
        cli,
        call,
        root,
      });
      const absent = peResourceFixture();
      absent.bytes.fill(0, absent.directoryAt, absent.directoryAt + 8);
      const path = join(root, "absent.exe");
      await writeFile(path, absent.bytes);
      const empty = await call({ path });
      expect(empty.isError).not.toBe(true);
      expect(
        contract.outputSchema.parse(empty.structuredContent).normalized_result,
      ).toMatchObject({
        directory: null,
        directories: [],
        resources: [],
        coverage: { status: "complete", resources: 0 },
      });
      for (const arguments_ of [
        { path, max_file_bytes: 64 },
        { path: "relative.exe" },
        { path, extra: true },
      ]) {
        const rejected = await call(arguments_);
        expect(rejected.isError).toBe(true);
        expect(
          contract.outputSchema.safeParse(rejected.structuredContent).success,
        ).toBe(false);
      }
      const damaged = peResourceFixture();
      damaged.bytes.writeUInt32LE(17, damaged.directoryAt + 4);
      const badPath = join(root, "damaged.exe");
      await writeFile(badPath, damaged.bytes);
      const rejected = await call({ path: badPath });
      expect(rejected.isError).toBe(true);
      expect(
        contract.outputSchema.safeParse(rejected.structuredContent).success,
      ).toBe(false);
      await client.ping();
    } finally {
      try {
        await client.close();
      } finally {
        await transport.close();
      }
    }
  },
  30_000,
);
