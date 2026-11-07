import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, vi } from "vitest";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

const fault = vi.hoisted(() => ({
  method: "",
  path: "",
  error: undefined as Error | undefined,
  calls: 0,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const native = await importOriginal<typeof import("node:fs/promises")>();
  const inject = (method: string, path: unknown): void => {
    if (fault.method !== method || String(path) !== fault.path) return;
    fault.calls += 1;
    throw fault.error;
  };
  return {
    ...native,
    lstat: (...args: Parameters<typeof native.lstat>) => {
      inject("lstat", args[0]);
      return native.lstat(...args);
    },
    realpath: (...args: Parameters<typeof native.realpath>) => {
      inject("realpath", args[0]);
      return native.realpath(...args);
    },
    access: (...args: Parameters<typeof native.access>) => {
      inject("access", args[0]);
      return native.access(...args);
    },
  };
});
import { createServer } from "../../src/server/createServer.js";
import { createTestBinarySession } from "../fixtures/binarySession.js";

it.each([
  { method: "lstat", code: "EACCES" },
  { method: "realpath", code: "EIO" },
  { method: "access", code: "EMFILE" },
])(
  "retains selected input and host facts through MCP after $method/$code refusal and accepts a readable retry",
  async ({ method, code }) => {
    const root = await createTestTempDirectory("rea-mcp-js-filesystem-");
    const session = createTestBinarySession(() => {
      throw new Error(
        "Static JavaScript analysis must not start a binary provider",
      );
    });
    const server = createServer({ kind: "session", session });
    const client = new Client({ name: "javascript-filesystem", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      fault.method = method;
      fault.path = root;
      fault.calls = 0;
      fault.error = Object.assign(
        new Error(`${code}: selected ${method} failed at ${root}`),
        { code, path: root, syscall: method },
      );
      const response = await client.callTool({
        name: "analyze_javascript_application",
        arguments: { input_path: root, format: "directory" },
      });
      expect(fault.calls).toBe(1);
      expect(response.isError).toBe(true);
      const text = response.content.find((item) => item.type === "text");
      if (text?.type !== "text")
        throw new Error("Expected structured text error");
      const result = JSON.parse(text.text);
      if (code === "EACCES")
        expect(result.error).toMatchObject({
          code: "access_denied",
          category: "unavailable",
          details: {
            path: root,
            system_code: code,
            boundary: "filesystem-read",
          },
        });
      else
        expect(result.error).toMatchObject({
          code: "artifact_operation_failed",
          details: {
            reason: "io",
            detail: fault.error.message,
            diagnostics: {
              input_path: root,
              path: root,
              system_code: code,
              syscall: method,
            },
          },
        });
      fault.method = "";
      const control = await client.callTool({
        name: "analyze_javascript_application",
        arguments: { input_path: root, format: "directory" },
      });
      expect(control.isError, JSON.stringify(control)).not.toBe(true);
    } finally {
      fault.method = "";
      fault.error = undefined;
      await client.close();
      await server.close();
      await session.close();
    }
  },
);
