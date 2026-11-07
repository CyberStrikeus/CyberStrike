import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, expect, it, vi } from "vitest";
import { withVerifierCleanup } from "../../scripts/lib/verifier-cleanup.mjs";
import { awaitAcknowledgement } from "../../tests/fixtures/lifecycleAcknowledgement.js";

const fileAccess = vi.hoisted(() => ({
  path: undefined as string | undefined,
  extraPath: undefined as string | undefined,
  controller: undefined as AbortController | undefined,
  reason: undefined as unknown,
  abortOnStatCall: undefined as number | undefined,
  statCalls: 0,
  afterAuthorization: undefined as (() => void) | undefined,
  discoveryGate: undefined as
    | { readonly started: () => void; readonly wait: Promise<void> }
    | undefined,
  calls: [] as string[],
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    stat: async (...args: Parameters<typeof actual.stat>) => {
      const result = await actual.stat(...args);
      if (
        String(args[0]) === fileAccess.path ||
        String(args[0]) === fileAccess.extraPath
      ) {
        fileAccess.calls.push("stat");
        fileAccess.statCalls += 1;
        if (fileAccess.abortOnStatCall === fileAccess.statCalls)
          fileAccess.controller?.abort(fileAccess.reason);
      }
      return result;
    },
    realpath: async (...args: Parameters<typeof actual.realpath>) => {
      if (
        String(args[0]) === fileAccess.path ||
        String(args[0]) === fileAccess.extraPath
      )
        fileAccess.calls.push("realpath");
      return await actual.realpath(...args);
    },
  };
});

vi.mock("../browser/CdpEndpoint.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../browser/CdpEndpoint.js")>();
  return {
    ...actual,
    discoverCdpEndpoint: async (
      ...args: Parameters<typeof actual.discoverCdpEndpoint>
    ) => {
      const gate = fileAccess.discoveryGate;
      if (gate !== undefined) {
        fileAccess.discoveryGate = undefined;
        gate.started();
        await gate.wait;
      }
      return await actual.discoverCdpEndpoint(...args);
    },
    hasCdpTargetWebSocket: (
      ...args: Parameters<typeof actual.hasCdpTargetWebSocket>
    ) => {
      const available = actual.hasCdpTargetWebSocket(...args);
      fileAccess.afterAuthorization?.();
      fileAccess.afterAuthorization = undefined;
      return available;
    },
  };
});

import { CdpElectronProvider } from "../browser/CdpElectronProvider.js";
import { authorizedElectronFile } from "../browser/ElectronFileScope.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { listElectronTargetsInputSchema } from "../domain/javascript/electronObservation.js";
import { V8InspectorProvider } from "./V8InspectorProvider.js";
import { startFakeCdpBrowser } from "../../tests/fixtures/fakeCdpBrowser.js";
import { startFakeV8Inspector } from "../../tests/fixtures/inspector/fakeV8Inspector.js";

const roots: string[] = [];
const fixtures: { close(): Promise<void> }[] = [];

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

afterEach(async () => {
  fileAccess.path = undefined;
  fileAccess.extraPath = undefined;
  fileAccess.controller = undefined;
  fileAccess.reason = undefined;
  fileAccess.abortOnStatCall = undefined;
  fileAccess.statCalls = 0;
  fileAccess.afterAuthorization = undefined;
  fileAccess.discoveryGate = undefined;
  fileAccess.calls = [];
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const targetFile = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "rea-inspector-cancel-"));
  roots.push(root);
  const path = join(root, "entry.js");
  await writeFile(path, "// inert target file\n");
  fileAccess.path = path;
  return path;
};

it("stops Inspector target authorization after the current stat settles", async () => {
  const path = await targetFile();
  const extraPath = join(roots[0]!, "second.js");
  await writeFile(extraPath, "// second inert target file\n");
  fileAccess.extraPath = extraPath;
  const fake = await startFakeV8Inspector({
    targetUrl: pathToFileURL(path).href,
    additionalTargetUrl: pathToFileURL(extraPath).href,
    additionalTargetCount: 1,
  });
  fixtures.push(fake);
  const controller = new AbortController();
  const reason = new Error("cancel after target stat");
  fileAccess.reason = reason;
  fileAccess.controller = controller;
  fileAccess.abortOnStatCall = 2;

  const result = await new V8InspectorProvider().listTargets(
    { inspector_endpoint: fake.endpoint },
    { signal: controller.signal },
  );

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected Inspector listing cancellation");
  expect(result.error).toBeInstanceOf(AnalysisCancelledError);
  expect(result.error.cause).toBe(reason);
  expect(result.error.diagnostics).toMatchObject({
    completed_target_inventory: {
      complete: false,
      targets_examined: 1,
      limitations: expect.arrayContaining([
        "Cancellation stopped target authorization; unexamined targets are unknown, not excluded.",
      ]),
    },
  });
  const inventory = record(
    record(result.error.diagnostics)?.completed_target_inventory,
  );
  expect(inventory?.targets_discovered).toBeGreaterThan(0);
  expect(inventory?.targets).toHaveLength(1);
  expect(inventory?.targets_discovered).toBe(3);
  expect(fileAccess.calls).toEqual(["stat", "realpath", "stat"]);
});

it("stops Electron target authorization after the current stat settles", async () => {
  const path = await targetFile();
  const fake = await startFakeCdpBrowser({
    electronFileUrl: pathToFileURL(path).href,
    additionalElectronPageCount: 2,
  });
  fixtures.push(fake);
  const controller = new AbortController();
  const reason = new Error("cancel after Electron target stat");
  fileAccess.reason = reason;
  fileAccess.controller = controller;
  fileAccess.abortOnStatCall = 1;

  const result = await new CdpElectronProvider().listTargets(
    listElectronTargetsInputSchema.parse({ cdp_endpoint: fake.endpoint }),
    { signal: controller.signal },
  );

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected Electron listing cancellation");
  expect(result.error).toBeInstanceOf(AnalysisCancelledError);
  expect(result.error.cause).toBe(reason);
  expect(result.error.diagnostics).toMatchObject({
    completed_prefix: {
      coverage:
        "partial: target authorization stopped; remaining targets are unknown",
    },
  });
  const prefix = record(record(result.error.diagnostics)?.completed_prefix);
  const examined = prefix?.examined_targets;
  const discovered = prefix?.discovered_targets;
  expect(typeof examined).toBe("number");
  expect(typeof discovered).toBe("number");
  if (typeof examined !== "number" || typeof discovered !== "number")
    throw new Error("Expected target-prefix coverage diagnostics");
  expect(examined).toBeGreaterThan(0);
  expect(discovered).toBeGreaterThan(examined);
  expect(fileAccess.calls).toEqual(["stat"]);
});

it("retains a target whose authorization completes before the next abort check", async () => {
  const path = await targetFile();
  const fake = await startFakeCdpBrowser({
    electronFileUrl: pathToFileURL(path).href,
    additionalElectronPageCount: 2,
  });
  fixtures.push(fake);
  const controller = new AbortController();
  const reason = new Error("cancel after complete target authorization");
  fileAccess.afterAuthorization = () => controller.abort(reason);

  const result = await new CdpElectronProvider().listTargets(
    listElectronTargetsInputSchema.parse({ cdp_endpoint: fake.endpoint }),
    { signal: controller.signal },
  );

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected Electron listing cancellation");
  expect(result.error).toBeInstanceOf(AnalysisCancelledError);
  expect(result.error.cause).toBe(reason);
  const prefix = record(record(result.error.diagnostics)?.completed_prefix);
  const allowed = prefix?.allowed_targets;
  expect(Array.isArray(allowed)).toBe(true);
  if (!Array.isArray(allowed))
    throw new Error("Expected completed target authorization fact");
  expect(allowed).toHaveLength(1);
  expect(fileAccess.afterAuthorization).toBeUndefined();
});

it("drains pending Electron discovery before shutdown cleanup completes", async () => {
  const path = await targetFile();
  const fake = await startFakeCdpBrowser({
    electronFileUrl: pathToFileURL(path).href,
  });
  fixtures.push(fake);
  let markStarted: () => void = () => undefined;
  let releaseDiscovery: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const discoveryWait = new Promise<void>((resolve) => {
    releaseDiscovery = resolve;
  });
  fileAccess.discoveryGate = { started: markStarted, wait: discoveryWait };

  const provider = new CdpElectronProvider();
  const listing = provider.listTargets(
    listElectronTargetsInputSchema.parse({ cdp_endpoint: fake.endpoint }),
  );
  let closed = false;
  let closing: Promise<void> | undefined;
  await withVerifierCleanup(async () => {
    await awaitAcknowledgement(started, listing, "Electron discovery");
    closing = provider.close().then(() => {
      closed = true;
    });
    const closedBeforeDiscovery = await Promise.race([
      closing.then(() => true),
      new Promise<boolean>((resolve) => setImmediate(() => resolve(false))),
    ]);
    expect(closedBeforeDiscovery).toBe(false);
    expect(closed).toBe(false);
    releaseDiscovery();

    const [listed] = await Promise.all([listing, closing]);
    expect(closed).toBe(true);
    expect(listed.ok).toBe(true);
    expect(fileAccess.calls).toContain("stat");
    const rejected = await provider.listTargets(
      listElectronTargetsInputSchema.parse({ cdp_endpoint: fake.endpoint }),
    );
    expect(rejected.ok).toBe(false);
    if (rejected.ok)
      throw new Error("Expected closed provider admission failure");
    expect(rejected.error.cleanupIncomplete).toBe(false);
    expect(rejected.error.cleanupResources).toEqual([]);
  }, [
    releaseDiscovery,
    async () => {
      await listing;
    },
    async () => {
      await closing;
    },
    () => provider.close(),
  ]);
});

it("keeps ordinary and malformed file-location authorization unchanged", async () => {
  const path = await targetFile();

  await expect(authorizedElectronFile(pathToFileURL(path).href)).resolves.toBe(
    path,
  );
  await expect(
    authorizedElectronFile("file://remote.example/share/entry.js"),
  ).resolves.toBeUndefined();
  await expect(
    authorizedElectronFile("file:///tmp/encoded%2fseparator.js"),
  ).resolves.toBeUndefined();
});
