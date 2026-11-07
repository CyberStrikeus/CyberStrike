import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Cli } from "incur";
import { afterEach, describe, expect, test, vi } from "vitest";

import { observeJavaScriptRuntime } from "../../src/application/javascript/JavaScriptRuntimeObservationService.js";
import type { JavaScriptRuntimeObservationPort } from "../../src/application/javascript/JavaScriptRuntimeObservationPort.js";
import { V8InspectorProvider } from "../../src/inspector/V8InspectorProvider.js";
import { observeJavaScriptRuntimeInputSchema } from "../../src/domain/javascript/javascriptRuntimeObservation.js";
import { startFakeV8Inspector } from "../fixtures/inspector/fakeV8Inspector.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { registerJavaScriptRuntimeObservationCommands } from "../../src/cli/javascriptRuntimeCommands.js";
import { ProviderCleanupError } from "../../src/domain/providerCleanupError.js";
import { ok } from "../../src/domain/result.js";
import { silentLogger } from "../../src/logger.js";
import { cliTest } from "../support/cli/cliFixture.js";

const runtimeFactory = vi.hoisted(() => ({
  provider: undefined as JavaScriptRuntimeObservationPort | undefined,
}));

vi.mock("../../src/composition/javascriptRuntimeObservation.js", () => ({
  createJavaScriptRuntimeObservationProvider: () => {
    if (runtimeFactory.provider === undefined)
      throw new Error("No runtime observation provider was configured");
    return runtimeFactory.provider;
  },
}));

const TIMEOUT_MS = 20_000;

describe("JavaScript runtime observation CLI parity", () => {
  const resources: Array<{ close(): Promise<unknown> }> = [];

  afterEach(async () => {
    runtimeFactory.provider = undefined;
    await Promise.all(resources.splice(0).map((item) => item.close()));
  });

  cliTest(
    "returns the same passive Inspector Evidence contracts",
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-v8-cli-");
      const entry = join(root, "entry.js");
      await writeFile(entry, "export const value = 1;\n");
      const inspector = await startFakeV8Inspector({
        targetUrl: pathToFileURL(entry).href,
      });
      resources.push(inspector);
      const environment = { ...process.env };

      const listed = await cli.run({
        arguments: [
          "list-javascript-runtime-targets",
          inspector.endpoint,
          "--json",
        ],
        environment,
      });
      expect(listed.exitCode, listed.stderr).toBe(0);
      expect(listed.json).toMatchObject({
        operation: "list_javascript_runtime_targets",
        provider: { id: "rea-v8-inspector" },
        normalized_result: {
          targets: [{ target_id: inspector.targetId }],
        },
      });

      const observed = await cli.run({
        arguments: [
          "observe-javascript-runtime",
          inspector.endpoint,
          inspector.targetId,
          "--runtime-kind",
          "node",
          "--observation-ms",
          "10",
          "--json",
        ],
        environment,
      });
      expect(observed.exitCode, observed.stderr).toBe(0);
      expect(observed.json).toMatchObject({
        operation: "observe_javascript_runtime",
        provider: { id: "rea-v8-inspector" },
        normalized_result: {
          target: { target_id: inspector.targetId, runtime_kind: "node" },
          scripts: {
            items: [
              expect.objectContaining({
                location: { kind: "file", file_path: entry },
              }),
            ],
          },
        },
      });
      const provider = new V8InspectorProvider();
      try {
        const direct = await observeJavaScriptRuntime(
          provider,
          observeJavaScriptRuntimeInputSchema.parse({
            inspector_endpoint: inspector.endpoint,
            target_id: inspector.targetId,
            runtime_kind: "node",
            observation_ms: 10,
          }),
        );
        expect(direct.ok).toBe(true);
        if (direct.ok)
          expect(evidenceIdFrom(observed.json)).toBe(direct.value.evidence_id);
      } finally {
        await provider.close();
      }
    },
    TIMEOUT_MS,
  );

  test("waits for provider cleanup and retains completed Evidence on failure", async () => {
    let closeAttempts = 0;
    runtimeFactory.provider = {
      identity: () => ({
        id: "rea-v8-inspector",
        name: "V8 Inspector",
        version: "1",
      }),
      listTargets: async () =>
        ok({
          runtime: {
            product: "node.js/v24",
            protocol_version: "1.3",
            v8_version: "13.0",
          },
          targets: [],
          excluded: { unsupported_location: 0, unconnectable: 0 },
          limitations: [],
        }),
      observe: async () => {
        throw new Error("No runtime observation requested");
      },
      close: async () => {
        closeAttempts += 1;
        throw new ProviderCleanupError(
          "rea-v8-inspector",
          ["browser_transport"],
          { reason: "Inspector transport remains retained" },
          { operation: "list_javascript_runtime_targets" },
        );
      },
    };
    const cli = Cli.create("rea-runtime-cleanup-test", { sync: false });
    registerJavaScriptRuntimeObservationCommands(cli, silentLogger, {});
    let stdout = "";
    await cli.serve(
      ["list-javascript-runtime-targets", "http://127.0.0.1:9229", "--json"],
      { exit: () => {}, stdout: (chunk) => (stdout += chunk) },
    );

    expect(closeAttempts, stdout).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        operation: "list_javascript_runtime_targets",
        partial_observation: {
          operation: "list_javascript_runtime_targets",
          normalized_result: {
            runtime: { product: "node.js/v24" },
            targets: [],
          },
        },
      },
    });
  });
});

const evidenceIdFrom = (value: unknown): string => {
  if (typeof value !== "object" || value === null)
    throw new TypeError("Missing CLI Evidence");
  const id = Reflect.get(value, "evidence_id");
  if (typeof id !== "string") throw new TypeError("Missing CLI Evidence ID");
  return id;
};
