import { z } from "zod";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import { BinaryLayoutService } from "../../src/application/binaryDiagnostics/BinaryLayoutService.js";
import { createCli } from "../../src/cli.js";
import * as composition from "../../src/composition/binaryDiagnostics.js";
import { resolvedAnalysisError } from "../../src/domain/analysisErrorBase.js";
import { projectAnalysisError } from "../../src/domain/analysisErrorProjection.js";
import { PwntoolsLayoutProvider } from "../../src/native/pwntools/PwntoolsLayoutProvider.js";
import type { PwntoolsLauncher } from "../../src/native/pwntools/PwntoolsDecoder.js";
import { PWNTOOLS_PROVIDER_IDENTITY } from "../../src/native/pwntools/PwntoolsRelease.js";
import { PrivateRuntimeRoot } from "../../src/process/PrivateRuntimeRoot.js";
import { cleanupOwnedProcessGroup } from "../../src/process/ProcessOwnership.js";
import { prepareProcessOwnershipInspection } from "../../src/process/ProcessOwnershipObservation.js";
import { spawnOwnedProviderProcess } from "../../src/process/ProviderProcess.js";
import {
  waitForProviderProcessReady,
  stopProviderProcessFixture,
} from "../fixtures/providerProcess.js";
import { binaryLayoutFixture } from "../fixtures/binaryDiagnostics/layout.js";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../support/workspace/workspaceFixture.js";

const supportedHost = process.platform !== "win32";
const platform = Object.getOwnPropertyDescriptor(process, "platform");
const architecture = Object.getOwnPropertyDescriptor(process, "arch");
const exitCode = process.exitCode;

beforeAll(() =>
  supportedHost ? prepareProcessOwnershipInspection() : undefined,
);
beforeEach(() => {
  // Prepare the real host inspector first; only decoder availability is simulated.
  Object.defineProperty(process, "platform", { value: "linux" });
  Object.defineProperty(process, "arch", { value: "x64" });
});
afterEach(() => {
  if (platform !== undefined)
    Object.defineProperty(process, "platform", platform);
  if (architecture !== undefined)
    Object.defineProperty(process, "arch", architecture);
  process.exitCode = exitCode;
  vi.restoreAllMocks();
});

const fixture = async (outcome: "decoded" | "failed" = "decoded") => {
  const workspace = await createTestWorkspace("rea-pwntools-finalization-");
  onTestFinished(() => removeTestWorkspace(workspace.root));
  const path = workspace.path("selected.elf");
  await writeFile(path, Buffer.alloc(128));
  const root = await PrivateRuntimeRoot.create({
    parent: workspace.root,
    prefix: "owned-",
  });
  const {
    artifact: _artifact,
    diagnostics: _diagnostics,
    ...payload
  } = binaryLayoutFixture(path);
  const launch: PwntoolsLauncher = async (input) => {
    const request = z
      .object({ reply_path: z.string() })
      .parse(
        JSON.parse(await readFile(join(root.path, "request.json"), "utf8")),
      );
    return spawnOwnedProviderProcess({
      ...input,
      arguments: [
        "-e",
        outcome === "decoded"
          ? 'require("node:fs").writeFileSync(process.argv[1], process.argv[2]); process.stdout.write("decoder output")'
          : 'process.stdout.write("decoder output"); process.exitCode = 2',
        request.reply_path,
        JSON.stringify({
          ok: true,
          profile: PWNTOOLS_PROVIDER_IDENTITY.version,
          value: payload,
        }),
      ],
    });
  };
  return { path, root, launch };
};

const runCli = async (
  provider: PwntoolsLayoutProvider,
  path: string,
): Promise<unknown> => {
  vi.spyOn(composition, "createBinaryLayoutService").mockReturnValue(
    new BinaryLayoutService(provider),
  );
  let stdout = "";
  await createCli({}).serve(["inspect-binary-layout", path, "--json"], {
    env: {},
    stdout: (text) => {
      stdout += text;
    },
    exit: () => undefined,
  });
  return JSON.parse(stdout);
};

it.runIf(supportedHost).each(["decoded", "failed"] as const)(
  "returns the original %s outcome after a successful runtime-removal retry through the CLI",
  async (outcome) => {
    const { path, root, launch } = await fixture(outcome);
    let removals = 0;
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      launch,
      async () => ({
        path: root.path,
        close: async () => {
          if (++removals === 1) throw new Error("transient removal failure");
          await root.close();
        },
      }),
    );
    onTestFinished(() => provider.close());
    const output = await runCli(provider, path);
    if (outcome === "decoded") {
      expect(output).toMatchObject({
        normalized_result: {
          artifact: { path },
          diagnostics: { stdout: "decoder output", truncated: false },
        },
      });
      expect(process.exitCode ?? 0).toBe(0);
    } else {
      expect(output).toMatchObject({
        code: "execution_failure",
        details: {
          diagnostics: {
            exit_code: 2,
            captured_output: { stdout: "decoder output" },
          },
        },
      });
      expect(output).not.toHaveProperty("details.cleanup");
      expect(process.exitCode).toBe(1);
    }
    expect(removals).toBe(2);
    await expect(access(root.path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(supportedHost)(
  "recovers a completed worker reply after terminal process cleanup succeeds",
  async () => {
    const { path, root, launch } = await fixture();
    let stops = 0;
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      async (input) => {
        const launched = await launch(input);
        return {
          ...launched,
          cleanup: () =>
            ++stops < 3
              ? Promise.resolve({
                  cleaned: false as const,
                  reason: "transient process inspection failure",
                })
              : cleanupOwnedProcessGroup(launched.ownership),
        };
      },
      async () => root,
    );
    onTestFinished(() => provider.close());
    expect(await runCli(provider, path)).toMatchObject({
      normalized_result: { artifact: { path } },
    });
    expect(process.exitCode ?? 0).toBe(0);
    expect(stops).toBe(3);
    await expect(access(root.path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(supportedHost)(
  "reports only the runtime still owned after process retirement",
  async () => {
    const { path, root, launch } = await fixture("failed");
    let stops = 0;
    let removalAllowed = false;
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      async (input) => {
        const launched = await launch(input);
        return {
          ...launched,
          cleanup: () =>
            ++stops === 1
              ? Promise.resolve({
                  cleaned: false as const,
                  reason: "transient process inspection failure",
                })
              : cleanupOwnedProcessGroup(launched.ownership),
        };
      },
      async () => ({
        path: root.path,
        close: async () => {
          if (!removalAllowed) throw new Error("runtime removal denied");
          await root.close();
        },
      }),
    );
    onTestFinished(async () => {
      removalAllowed = true;
      await provider.close();
    });
    expect(await runCli(provider, path)).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        resources: [root.path],
        diagnostics: {
          primary_error: { code: "execution_failure" },
          cleanup_error: {
            code: "cleanup_incomplete",
            details: { resources: [root.path] },
          },
        },
      },
    });
    expect(stops).toBe(2);
    await expect(access(root.path)).resolves.toBeUndefined();
  },
);

it.runIf(supportedHost)(
  "preserves the validated report when runtime removal remains denied",
  async () => {
    const { path, root, launch } = await fixture();
    let removalAllowed = false;
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      launch,
      async () => ({
        path: root.path,
        close: async () => {
          if (!removalAllowed) throw new Error("runtime removal denied");
          await root.close();
        },
      }),
    );
    onTestFinished(async () => {
      removalAllowed = true;
      await provider.close();
    });
    expect(await runCli(provider, path)).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        resources: [root.path],
        partial_observation: {
          artifact: { path },
          diagnostics: { stdout: "decoder output", truncated: false },
          sections: binaryLayoutFixture(path).sections,
        },
      },
    });
    expect(process.exitCode).toBe(1);
    await expect(access(root.path)).resolves.toBeUndefined();
  },
);

it.runIf(supportedHost)(
  "preserves cancellation during successful final cleanup",
  async () => {
    const { path, root, launch } = await fixture();
    const controller = new AbortController();
    const reason = { stage: "final cleanup" };
    let removals = 0;
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      launch,
      async () => ({
        path: root.path,
        close: async () => {
          if (++removals === 1) {
            controller.abort(reason);
            throw new Error("transient removal failure");
          }
          await root.close();
        },
      }),
    );
    onTestFinished(() => provider.close());
    const result = await provider.inspectAndClose(
      { path },
      { signal: controller.signal },
    );
    if (result.ok)
      throw new Error("Cancelled inspection must not publish success");
    expect(result.error.cause).toBe(reason);
    expect(result.error.partialObservation).toBeDefined();
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "cancelled",
      details: {
        captured_output: { stdout: "decoder output", truncated: false },
      },
    });
    await expect(access(root.path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(supportedHost).each(["inspect", "inspectAndClose"] as const)(
  "preserves pre-admission reasons without acquiring resources: %s",
  async (method) => {
    const reason = { stage: "pre-admission" };
    const controller = new AbortController();
    controller.abort(reason);
    const provider = new PwntoolsLayoutProvider({});
    onTestFinished(() => provider.close());
    const result = await provider[method](
      { path: "/not-acquired" },
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Expected pre-admission cancellation");
    expect(result.error._tag).toBe("AnalysisCancelledError");
    expect(result.error.cause).toBe(reason);
    const retry = await provider.inspect({ path: "/not-acquired" });
    if (retry.ok) throw new Error("Unconfigured provider must fail");
    expect(retry.error.message).not.toContain("Provider is closing");
  },
);

it.runIf(supportedHost)(
  "normalizes cancellation from the actual snapshot write boundary",
  async () => {
    const { path, root, launch } = await fixture();
    const reason = { stage: "snapshot write" };
    const controller = new AbortController();
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      launch,
      async () => {
        controller.abort(reason);
        return root;
      },
    );
    onTestFinished(() => provider.close());
    const result = await provider.inspect(
      { path },
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Expected snapshot write cancellation");
    expect(result.error._tag).toBe("AnalysisCancelledError");
    expect(result.error.cause).toBe(reason);
    await expect(access(root.path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(supportedHost).each(["AbortError-name", "same-as-reason"])(
  "preserves a physical runtime acquisition failure despite late cancellation: %s",
  async (scenario) => {
    const { path, root, launch } = await fixture();
    onTestFinished(() => root.close());
    const physical = Object.assign(
      new Error("owned runtime acquisition failed"),
      { name: scenario === "AbortError-name" ? "AbortError" : "Error" },
    );
    const controller = new AbortController();
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      launch,
      async () => {
        controller.abort(
          scenario === "same-as-reason" ? physical : { late: true },
        );
        throw physical;
      },
    );
    onTestFinished(() => provider.close());
    const result = await provider.inspect(
      { path },
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Expected runtime acquisition failure");
    expect(result.error._tag).toBe("ProviderAdapterError");
    expect(result.error.cause).toBe(physical);
  },
);

it.runIf(supportedHost)(
  "preserves cancellation across a late owned process handshake",
  async () => {
    const { path, root } = await fixture();
    const controller = new AbortController();
    const reason = { stage: "late owned handshake" };
    let child:
      | Awaited<ReturnType<typeof spawnOwnedProviderProcess>>["process"]
      | undefined;
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      async (input) => {
        const launched = await spawnOwnedProviderProcess({
          ...input,
          arguments: [
            "-e",
            "process.stdout.write('ready\\n'); setInterval(() => {}, 1000)",
          ],
        });
        child = launched.process;
        await waitForProviderProcessReady(launched.process);
        controller.abort(reason);
        return launched;
      },
      async () => root,
    );
    onTestFinished(async () => {
      try {
        await provider.close();
      } finally {
        if (child !== undefined) await stopProviderProcessFixture(child);
      }
    });
    const result = await provider.inspect(
      { path },
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Expected handshake cancellation");
    expect(result.error._tag).toBe("AnalysisCancelledError");
    expect(result.error.cause).toBe(reason);
    expect(child).toBeDefined();
    expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true);
    await expect(access(root.path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(supportedHost)(
  "retains cancellation and decoded facts until failed final cleanup is retried",
  async () => {
    const { path, root, launch } = await fixture();
    const controller = new AbortController();
    const reason = { stage: "failed final cleanup" };
    let removalAllowed = false;
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      launch,
      async () => ({
        path: root.path,
        close: async () => {
          if (!removalAllowed) {
            controller.abort(reason);
            throw new Error("root removal refused");
          }
          await root.close();
        },
      }),
    );
    onTestFinished(async () => {
      removalAllowed = true;
      await provider.close();
    });
    const result = await provider.inspectAndClose(
      { path },
      { signal: controller.signal },
    );
    if (result.ok)
      throw new Error("Expected cancelled finalization with retained cleanup");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "cleanup_incomplete",
      details: { diagnostics: { primary_error: { code: "cancelled" } } },
    });
    expect(result.error.cleanupPrimary?.cause).toBe(reason);
    expect(result.error.partialObservation).toBeDefined();
    expect(result.error.capturedOutput?.stdout).toBe("decoder output");
    expect(result.error.cleanupResources).toEqual([root.path]);
    removalAllowed = true;
    await provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(resolvedAnalysisError(result.error).cause).toBe(reason);
    await expect(access(root.path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
