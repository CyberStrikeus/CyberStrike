import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import {
  createGhidraTestRuntime,
  publishGhidraTestEndpoint,
} from "../../../fixtures/ghidraRuntime.js";
import type { PrivateRuntimeRoot } from "../../../../src/process/PrivateRuntimeRoot.js";

import { observeGhidraEndpoint } from "../../../../src/ghidra/GhidraTransport.js";

const runtimes: PrivateRuntimeRoot[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
});

describe("Ghidra local transport", () => {
  it("observes Unix readiness without interpreting endpoint content", async () => {
    const root = await createTestTempDirectory("rea-ghidra-transport-");
    const path = join(root, "bridge.sock");

    await expect(
      observeGhidraEndpoint({ transport: "unix-socket", path }),
    ).resolves.toEqual({ ok: true, value: null });
    await writeFile(path, "fixture");
    await expect(
      observeGhidraEndpoint({ transport: "unix-socket", path }),
    ).resolves.toEqual({ ok: true, value: { path } });
  });

  it("accepts only an exact IPv4 loopback endpoint record", async () => {
    const root = await createTestTempDirectory("rea-ghidra-transport-");
    const runtime = await createGhidraTestRuntime(root);
    runtimes.push(runtime);
    const path = await publishGhidraTestEndpoint(
      runtime,
      `${JSON.stringify({ host: "127.0.0.1", port: 49152 })}\n`,
    );

    await expect(
      observeGhidraEndpoint({
        transport: "authenticated-loopback-tcp",
        path,
      }),
    ).resolves.toEqual({
      ok: true,
      value: { host: "127.0.0.1", port: 49152 },
    });
  });

  it.each([
    { host: "0.0.0.0", port: 49152 },
    { host: "127.0.0.1", port: 0 },
    { host: "127.0.0.1", port: 49152, token: "leak" },
  ])(
    "rejects an invalid or expanded TCP endpoint: $host:$port",
    async (value) => {
      const root = await createTestTempDirectory("rea-ghidra-transport-");
      const runtime = await createGhidraTestRuntime(root);
      runtimes.push(runtime);
      const path = await publishGhidraTestEndpoint(
        runtime,
        JSON.stringify(value),
      );

      await expect(
        observeGhidraEndpoint({
          transport: "authenticated-loopback-tcp",
          path,
        }),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: "start", message: "Ghidra TCP endpoint is invalid" },
      });
    },
  );
});
