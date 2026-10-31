import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { finalizeInspectorCapture } from "./V8InspectorCaptureProjection.js";
import type { CaptureState } from "./V8InspectorProvider.js";

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "rea-inspector-projection-"));
});
afterAll(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

const target = {
  id: "target-1",
  type: "node",
  url: "file:///tmp/target.js",
  attached: false,
  webSocketUrl: "ws://127.0.0.1:9222/target-1",
  location: { kind: "file" as const, file_path: "/tmp/target.js" },
};
const stateFor = (scripts: CaptureState["scripts"]): CaptureState => ({
  scripts,
  contexts: new Map(),
  eventsObserved: scripts.length,
  eventsRetained: scripts.length,
  eventsDropped: 0,
  metadataBytes: 0,
  scriptsObserved: scripts.length,
  invalidScripts: 0,
  parseFailedScripts: 0,
  invalidContexts: 0,
  truncated: false,
  truncationReasons: new Set(),
});
const finalize = (
  state: CaptureState,
  authorizeLocation?: Parameters<
    typeof finalizeInspectorCapture
  >[0]["authorizeLocation"],
) =>
  finalizeInspectorCapture({
    input: {
      inspector_endpoint: "http://127.0.0.1:9222",
      target_id: target.id,
      observation_ms: 100,
    },
    runtime: {
      product: "Node.js/v24.18.0",
      protocol_version: "1.3",
      v8_version: null,
    },
    target,
    state,
    ...(authorizeLocation === undefined ? {} : { authorizeLocation }),
  });

it("authorizes distinct Inspector locations and preserves stable deduplication", async () => {
  const firstPath = join(root, "first.js");
  const secondPath = join(root, "second.js");
  await Promise.all([
    writeFile(firstPath, "void 0;\n"),
    writeFile(secondPath, "void 1;\n"),
  ]);
  const firstUrl = pathToFileURL(firstPath).href;
  const secondUrl = pathToFileURL(secondPath).href;
  const result = await finalize(
    stateFor([
      {
        rawUrl: firstUrl,
        executionContextKey: "1",
        cdpHash: "first",
        length: 7,
        isModule: false,
      },
      {
        rawUrl: firstUrl,
        executionContextKey: "1",
        cdpHash: "first",
        length: 7,
        isModule: false,
      },
      {
        rawUrl: secondUrl,
        executionContextKey: "1",
        cdpHash: "second",
        length: 7,
        isModule: false,
      },
      {
        rawUrl: "ftp://example.test/unapproved.js",
        executionContextKey: null,
        cdpHash: null,
        length: 0,
        isModule: false,
      },
    ]),
  );

  expect(result.scripts.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        location: { kind: "file", file_path: await realpath(firstPath) },
        reported_url: firstUrl,
      }),
      expect.objectContaining({
        location: { kind: "file", file_path: await realpath(secondPath) },
        reported_url: secondUrl,
      }),
    ]),
  );
  expect(result.scripts.items).toHaveLength(2);
  expect(result.scripts.parse_failed_total).toBe(0);
  expect(result.scripts.excluded).toEqual({
    unsupported_location: 1,
    invalid_protocol_value: 0,
  });
});

it("authorizes each unique script location through a bounded worker pool", async () => {
  const drafts = Array.from({ length: 200 }, (_, index) => ({
    rawUrl: `file:///fixture/script-${String(index)}.js`,
    executionContextKey: "1",
    cdpHash: `hash-${String(index)}`,
    length: 7,
    isModule: false,
  }));
  const state = stateFor([
    ...drafts,
    ...drafts.slice(0, 1),
    {
      rawUrl: "ftp://example.test/unapproved.js",
      executionContextKey: null,
      cdpHash: null,
      length: 0,
      isModule: false,
    },
  ]);
  const activeUrls = new Set<string>();
  const authorizedUrls = new Set<string>();
  let maximumActive = 0;
  const result = await finalize(state, async (rawUrl) => {
    activeUrls.add(rawUrl);
    authorizedUrls.add(rawUrl);
    maximumActive = Math.max(maximumActive, activeUrls.size);
    await new Promise((resolve) => setTimeout(resolve, 1));
    activeUrls.delete(rawUrl);
    return rawUrl.startsWith("ftp:")
      ? { allowed: false, reason: "unsupported_url" }
      : { allowed: true, location: { kind: "file", file_path: rawUrl } };
  });

  expect(maximumActive).toBeGreaterThan(1);
  expect(maximumActive).toBeLessThan(authorizedUrls.size);
  expect(authorizedUrls.size).toBe(201);
  expect(activeUrls.size).toBe(0);
  expect(result.scripts.items).toHaveLength(200);
  expect(result.scripts.observed_total).toBe(202);
  expect(result.scripts.parse_failed_total).toBe(0);
  expect(result.scripts.excluded).toEqual({
    unsupported_location: 1,
    invalid_protocol_value: 0,
  });
});

it("preserves raw script facts without authorizing locations in partial projection", async () => {
  const state = stateFor([
    {
      rawUrl: "file:///slow-or-unavailable.js?token=retained",
      executionContextKey: "1",
      cdpHash: "observed",
      length: 7,
      isModule: false,
    },
    {
      rawUrl: "https://example.test/script.js?caller-value=kept",
      executionContextKey: "1",
      cdpHash: "remote",
      length: 12,
      isModule: true,
    },
    {
      rawUrl: "",
      executionContextKey: "1",
      cdpHash: "anonymous",
      length: 0,
      isModule: false,
    },
  ]);
  state.eventsObserved += 1;
  state.eventsRetained += 1;
  state.contexts.set("1", {
    contextKey: "1",
    state: "created",
    name: "main",
    origin: "file:///slow-or-unavailable.js?token=retained",
  });
  const authorizeLocation = vi.fn(async () => {
    throw new Error("must not run after cancellation");
  });

  const result = await finalizeInspectorCapture({
    input: {
      inspector_endpoint: "http://127.0.0.1:9222",
      target_id: target.id,
      observation_ms: 100,
    },
    runtime: {
      product: "Node.js/v24.18.0",
      protocol_version: "1.3",
      v8_version: null,
    },
    target,
    state,
    locationMode: "reported",
    authorizeLocation,
  });

  expect(authorizeLocation).not.toHaveBeenCalled();
  expect(result.capture.events_observed).toBe(4);
  expect(result.capture.events_retained).toBe(4);
  expect(result.scripts.items).toHaveLength(3);
  expect(
    result.scripts.items.find(({ cdp_hash }) => cdp_hash === "observed"),
  ).toMatchObject({
    location: {
      kind: "unresolved",
      reported_url: "file:///slow-or-unavailable.js?token=retained",
      reason: "location-authorization-not-attempted",
    },
    length: 7,
  });
  expect(
    result.scripts.items.find(({ cdp_hash }) => cdp_hash === "remote"),
  ).toMatchObject({
    location: {
      kind: "url",
      origin: "https://example.test",
      sanitized_url: "https://example.test/script.js?caller-value=kept",
    },
    length: 12,
    is_module: true,
  });
  expect(
    result.scripts.items.find(({ cdp_hash }) => cdp_hash === "anonymous"),
  ).toMatchObject({
    location: {
      kind: "unresolved",
      reported_url: "",
      reason: "location-authorization-not-attempted",
    },
    length: 0,
  });
  expect(result.scripts.observed_total).toBe(3);
  expect(result.execution_contexts).toEqual([
    {
      context_key: "1",
      state: "created",
      name: "main",
      origin: "file:///slow-or-unavailable.js?token=retained",
    },
  ]);
  expect(result.unknowns).toContain(
    "2 observed script locations remain unverified; raw URLs and script metadata are retained.",
  );
});

it("counts retained unresolved script locations after deduplication in partial captures", async () => {
  const draft = {
    rawUrl: "file:///fixture/duplicate.js",
    executionContextKey: "1",
    cdpHash: "same",
    length: 7,
    isModule: false,
  };
  const result = await finalizeInspectorCapture({
    input: {
      inspector_endpoint: "http://127.0.0.1:9222",
      target_id: target.id,
      observation_ms: 0,
    },
    runtime: { product: "Node.js", protocol_version: "1.3", v8_version: null },
    target,
    state: stateFor([draft, { ...draft }]),
    locationMode: "reported",
  });
  expect(result.scripts.items).toHaveLength(1);
  expect(result.scripts.observed_total).toBe(2);
  expect(result.unknowns).toContain(
    "1 observed script location remains unverified; raw URLs and script metadata are retained.",
  );
});

it("waits for active authorization workers to settle before returning a failure", async () => {
  const scripts = Array.from({ length: 12 }, (_, index) => ({
    rawUrl: `file:///fixture/failure-${String(index)}.js`,
    executionContextKey: null,
    cdpHash: null,
    length: 0,
    isModule: false,
  }));
  const startedUrls: string[] = [];
  const pending = new Map<
    string,
    { readonly resolve: () => void; readonly reject: (error: Error) => void }
  >();
  const failure = new Error("authorization failed");
  let active = 0;
  let maximumActive = 0;
  let failureInjected = false;

  const finalization = finalize(stateFor(scripts), async (rawUrl) => {
    startedUrls.push(rawUrl);
    if (failureInjected)
      return { allowed: true, location: { kind: "file", file_path: rawUrl } };
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    return new Promise<{
      readonly allowed: true;
      readonly location: { readonly kind: "file"; readonly file_path: string };
    }>((resolve, reject) => {
      pending.set(rawUrl, {
        resolve: () =>
          resolve({
            allowed: true,
            location: { kind: "file", file_path: rawUrl },
          }),
        reject,
      });
    }).finally(() => {
      active -= 1;
    });
  });
  const initialStarted = new Set(startedUrls);
  expect(initialStarted.size).toBeGreaterThan(1);
  expect(maximumActive).toBe(initialStarted.size);
  const failingUrl = startedUrls[0];
  if (failingUrl === undefined)
    throw new Error("Expected at least one active authorization");
  failureInjected = true;
  pending.get(failingUrl)?.reject(failure);
  await Promise.resolve();
  expect(new Set(startedUrls)).toEqual(initialStarted);
  for (const [rawUrl, request] of pending)
    if (rawUrl !== failingUrl) request.resolve();
  await expect(finalization).rejects.toBe(failure);
  expect(new Set(startedUrls)).toEqual(initialStarted);
  expect(active).toBe(0);
});

it("stops finalization when cancellation arrives during location authorization", async () => {
  const controller = new AbortController();
  let authorizationStarted = false;
  const state = stateFor([
    {
      rawUrl: "https://example.test/script.js",
      executionContextKey: null,
      cdpHash: null,
      length: 0,
      isModule: false,
    },
  ]);

  const finalization = finalizeInspectorCapture({
    input: {
      inspector_endpoint: "http://127.0.0.1:9222",
      target_id: target.id,
      observation_ms: 100,
    },
    runtime: {
      product: "Node.js/v24.18.0",
      protocol_version: "1.3",
      v8_version: null,
    },
    target,
    state,
    signal: controller.signal,
    authorizeLocation: async () => {
      authorizationStarted = true;
      controller.abort();
      return {
        allowed: true,
        location: {
          kind: "url",
          origin: "https://example.test",
          sanitized_url: "https://example.test/script.js",
        },
      };
    },
  });

  await expect(finalization).rejects.toBeInstanceOf(AnalysisCancelledError);
  expect(authorizationStarted).toBe(true);
});
