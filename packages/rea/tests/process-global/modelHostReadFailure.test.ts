import { writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, vi } from "vitest";

const fault = vi.hoisted(() => ({
  path: "",
  stage: "" as "" | "open" | "read",
  cause: undefined as Error | undefined,
  handles: [] as FileHandle[],
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    open: async (...args: Parameters<typeof original.open>) => {
      const selected = String(args[0]) === fault.path;
      if (selected && fault.stage === "open") throw fault.cause;
      const handle = await original.open(...args);
      if (selected) {
        fault.handles.push(handle);
        if (fault.stage === "read")
          handle.read = (async () => {
            throw fault.cause;
          }) as FileHandle["read"];
      }
      return handle;
    },
  };
});

import { ModelArtifactProvider } from "../../src/model/ModelArtifactProvider.js";
import { ModelArtifactService } from "../../src/application/model/ModelArtifactService.js";
import { EvidenceMcpServer } from "../../src/server/EvidenceMcpServer.js";
import { registerModelArtifactTools } from "../../src/server/registerModelArtifactTools.js";
import { createToolResultDelivery } from "../../src/server/toolResult.js";
import { silentLogger } from "../../src/logger.js";
import { ggufFixture, safetensorsFixture } from "../fixtures/model/model.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { mcpTest } from "../support/mcp/mcpFixture.js";

afterEach(() => {
  fault.path = "";
  fault.stage = "";
  fault.cause = undefined;
  fault.handles = [];
});

mcpTest.for(["gguf", "safetensors"] as const)(
  "reports host I/O failures for a valid %s file as execution failures, not unavailable targets",
  async (format, { mcp }) => {
    const root = await createTestTempDirectory("rea-model-host-failure-");
    const path = join(root, `selected.${format}`);
    await writeFile(
      path,
      format === "gguf" ? ggufFixture().bytes : safetensorsFixture().bytes,
    );
    const provider = new ModelArtifactProvider();
    const server = new EvidenceMcpServer(
      { name: "model-host-failure-test", version: "1" },
      {},
      undefined,
      createToolResultDelivery(undefined),
    );
    registerModelArtifactTools(
      server,
      new ModelArtifactService(provider),
      silentLogger,
    );
    const client = await mcp.connect(server);
    const call = (selected = path) =>
      client.callTool({
        name: "inspect_model_artifact",
        arguments: { path: selected, detail: "complete" },
      });
    try {
      expect((await call()).isError).not.toBe(true);
      fault.path = path;
      for (const [stage, code] of [
        ["open", "EMFILE"],
        ["read", "EIO"],
      ] as const) {
        fault.stage = stage;
        fault.cause = Object.assign(
          new Error(`controlled ${stage} failure (${code})`),
          { code },
        );
        const { error } = parseMcpToolError(await call());
        expect(error).toMatchObject({
          code: "execution_failure",
          category: "execution_failure",
          retryable: false,
          details: {
            provider_id: "model-artifact",
            diagnostics: {
              path,
              reason: `controlled ${stage} failure (${code})`,
            },
          },
        });
        expect(error.message).not.toContain("Check that the path exists");
        if (stage === "read") expect(fault.handles.length).toBeGreaterThan(0);
        expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
        fault.stage = "";
        expect((await call()).isError).not.toBe(true);
      }
      // Errors about the selected path itself remain target refusals.
      for (const code of [
        "ENOENT",
        "ENOTDIR",
        "ELOOP",
        "ENAMETOOLONG",
        "EISDIR",
        "ENOTFILE",
        "ESTALE",
      ]) {
        fault.stage = "open";
        fault.cause = Object.assign(new Error(`controlled ${code}`), { code });
        const { error } = parseMcpToolError(await call());
        expect(error, code).toMatchObject({
          code: "target_unavailable",
          category: "unavailable",
        });
      }
      fault.stage = "";
      const { error } = parseMcpToolError(
        await call(join(root, `missing.${format}`)),
      );
      expect(error).toMatchObject({
        code: "target_unavailable",
        category: "unavailable",
      });
    } finally {
      await provider.close();
    }
  },
);
