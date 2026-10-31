import fs from "node:fs";
import { writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { afterEach, expect, vi } from "vitest";

import { ElectronFuseProvider } from "../../src/electron/ElectronFuseProvider.js";
import { ElectronFuseService } from "../../src/application/electron/ElectronFuseService.js";
import { createServer } from "../../src/server/createServer.js";
import { createTestBinarySession } from "../fixtures/binarySession.js";
import { thinFuseImage } from "../fixtures/electron/fuseImage.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { mcpTest } from "../support/mcp/mcpFixture.js";

afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
});

mcpTest(
  "retries the same fuse descriptor before admitting another MCP read and during server close",
  async ({ mcp }) => {
    const root = await createTestTempDirectory("rea-fuse-mcp-close-");
    const path = join(root, "application");
    await writeFile(path, thinFuseImage([0x31]).bytes);
    const originalOpen = fs.promises.open;
    const descriptors: number[] = [];
    const releases: (() => Promise<void>)[] = [];
    let denied = true;
    vi.spyOn(fs.promises, "open").mockImplementation(async (...args) => {
      if (String(args[0]) === path && descriptors.length > 0)
        expect(() => fs.fstatSync(descriptors.at(-1)!)).toThrow();
      const file = await originalOpen(...args);
      if (String(args[0]) !== path) return file;
      descriptors.push(file.fd);
      const close = file.close.bind(file);
      releases.push(close);
      vi.spyOn(file, "close").mockImplementation(async () => {
        if (denied)
          throw Object.assign(new Error("close denied"), { code: "EACCES" });
        await close();
      });
      return file;
    });
    syncBuiltinESMExports();
    const session = createTestBinarySession(() => {
      throw new Error("Unexpected deep provider");
    });
    const service = new ElectronFuseService(new ElectronFuseProvider());
    const server = createServer(
      { kind: "session", session },
      { electronFuses: service },
    );
    try {
      const client = await mcp.connect(server);
      const inspect = () =>
        client.callTool({
          name: "inspect_electron_fuses",
          arguments: { path },
        });
      const first = parseMcpToolError(await inspect());
      expect(first.error).toMatchObject({
        code: "cleanup_incomplete",
        details: { cleanup: "incomplete", resources: [path] },
      });
      expect(fs.fstatSync(descriptors[0]!)).toBeDefined();
      const retry = parseMcpToolError(await inspect());
      expect(retry.error).toMatchObject({
        code: "cleanup_incomplete",
        details: { resources: [path] },
      });
      expect(descriptors).toHaveLength(1);
      denied = false;
      const recovered = await inspect();
      expect(recovered.isError).not.toBe(true);
      expect(descriptors).toHaveLength(2);
      expect(() => fs.fstatSync(descriptors[1]!)).toThrow();
      denied = true;
      parseMcpToolError(await inspect());
      expect(descriptors).toHaveLength(3);
      await expect(server.close()).rejects.toBeInstanceOf(AggregateError);
      expect(fs.fstatSync(descriptors[2]!)).toBeDefined();
      denied = false;
      await server.close();
      expect(() => fs.fstatSync(descriptors[2]!)).toThrow();
    } finally {
      denied = false;
      for (const close of releases) await close();
      await server.close();
      await session.close();
    }
  },
);
