import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, vi } from "vitest";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import { NativeMacOSProvider } from "../../../src/native/NativeMacOSProvider.js";
import {
  machoImage,
  rpathCommand,
  CPU,
  fatImage,
} from "../../../src/artifacts/apple/MachoImage.fixture.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { NativeFixtureRunner } from "../../fixtures/nativeCommands.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";

it("keeps a failed snapshot descriptor and root together through MCP close and recovery", async () => {
  const root = await createTestTempDirectory("rea-signature-order-mcp-");
  const path = join(root, "program");
  await writeFile(path, machoImage({}));
  const runner = new NativeFixtureRunner();
  const run = vi.spyOn(runner, "run");
  let created = 0;
  let removed = 0;
  const provider = new NativeMacOSProvider(
    {},
    runner,
    "darwin",
    undefined,
    async () => {
      const path = join(root, `snapshot-${String(++created)}`);
      await mkdir(path, { mode: 0o700 });
      return {
        path,
        close: async () => {
          await rm(path, { recursive: true });
          removed++;
        },
      };
    },
  );
  const server = createServer({
    kind: "session",
    session: createTestBinarySession(provider),
  });
  const client = new Client({ name: "signature-order-test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const original = OwnedFileHandle.prototype.close;
  let blocked: OwnedFileHandle | undefined;
  let allowClose = false;
  let close: ReturnType<typeof vi.spyOn> | undefined;
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    expect(
      (await client.callTool({ name: "open_binary", arguments: { path } }))
        .isError,
    ).not.toBe(true);
    close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(function (this: OwnedFileHandle) {
        blocked ??= this;
        if (this === blocked && !allowClose)
          return Promise.reject(new Error("snapshot descriptor close denied"));
        return original.call(this);
      });
    for (const name of [
      "inspect_signature",
      "inspect_signature",
      "close_binary",
    ]) {
      const reply = await client.callTool({ name, arguments: {} });
      const error = parseMcpToolError(reply).error;
      expect(error.code).toBe("cleanup_incomplete");
      expect(error.details).toMatchObject({
        cleanup: "incomplete",
        resources: expect.arrayContaining([
          join(root, "snapshot-1"),
          join(root, "snapshot-1", "program"),
        ]),
      });
      expect(created).toBe(1);
      expect(removed).toBe(0);
      expect((await lstat(join(root, "snapshot-1"))).isDirectory()).toBe(true);
      expect(run).not.toHaveBeenCalled();
      await client.ping();
    }
    allowClose = true;
    expect(
      (await client.callTool({ name: "close_binary", arguments: {} })).isError,
    ).not.toBe(true);
    expect(removed).toBe(1);
    await expect(lstat(join(root, "snapshot-1"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      (await client.callTool({ name: "open_binary", arguments: { path } }))
        .isError,
    ).not.toBe(true);
    const recovered = await client.callTool({
      name: "inspect_signature",
      arguments: {},
    });
    expect(recovered.isError, JSON.stringify(recovered.content)).not.toBe(true);
    expect(recovered.structuredContent).toMatchObject({
      normalized_result: { signed: true, identifier: "com.example.fixture" },
    });
    expect(created).toBe(2);
    expect(removed).toBe(2);
  } finally {
    allowClose = true;
    try {
      await client.close();
      await server.close();
    } finally {
      close?.mockRestore();
      run.mockRestore();
    }
  }
});

it.each(["mach-o", "mach-o-universal"] as const)(
  "rejects changed %s signature targets through MCP and accepts reopening the new version",
  async (format) => {
    const path = join(
      await createTestTempDirectory("rea-signature-binding-mcp-"),
      "program",
    );
    const image = (commands: readonly Uint8Array[] = []) =>
      format === "mach-o"
        ? machoImage({ commands })
        : fatImage(
            [CPU.arm64, CPU.x86_64].map((cpu) => ({
              cpu,
              bytes: machoImage({ cpu, commands }),
            })),
          );
    await writeFile(path, image());
    const session = createTestBinarySession(
      new NativeMacOSProvider({}, new NativeFixtureRunner(), "darwin"),
    );
    const server = createServer({ kind: "session", session });
    const client = new Client({ name: "signature-binding-test", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const open = () =>
        client.callTool({ name: "open_binary", arguments: { path } });
      const opened = await open();
      expect(opened.isError).not.toBe(true);
      expect(
        toolContract("open_binary").outputSchema.parse(opened.structuredContent)
          .result,
      ).toMatchObject({ format });
      await writeFile(path, image([rpathCommand("new-version")]));
      const changed = await client.callTool({
        name: "inspect_signature",
        arguments: {},
      });
      expect(changed.isError).toBe(true);
      expect(parseMcpToolError(changed)).toMatchObject({
        error: { code: "artifact_changed", details: { path } },
      });
      expect((await open()).isError).not.toBe(true);
      const inspected = await client.callTool({
        name: "inspect_signature",
        arguments: {},
      });
      expect(
        inspected.isError,
        JSON.stringify(inspected.structuredContent),
      ).not.toBe(true);
      expect(inspected.structuredContent).toMatchObject({
        subject: { format },
        normalized_result: { signed: true, identifier: "com.example.fixture" },
      });
    } finally {
      await client.close();
      await server.close();
    }
  },
);
