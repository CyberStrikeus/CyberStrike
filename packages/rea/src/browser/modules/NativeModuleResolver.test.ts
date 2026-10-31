import { describe, expect, it, vi } from "vitest";
import { NativeModuleResolver } from "./NativeModuleResolver.js";
import { webModuleResolutionObservationSchema } from "../../domain/webModuleTrace.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";

import { completedModuleResolverLauncher } from "../../../tests/fixtures/webModuleTrace.js";

const input = {
  importerUrl: "https://app.test/main.js",
  importMap: null,
  specifiers: ["./dep.js"],
};
describe("native module resolver cleanup ownership", () => {
  it.each([false, true])(
    "awaits owned cleanup when acquisition is cancelled (cleanup fails: %s)",
    async (cleanupFails) => {
      const controller = new AbortController();
      let closed = false;
      const provider = new NativeModuleResolver(
        { REA_BROWSER_EXECUTABLE: "/browser" },
        () => {
          controller.abort();
          return Promise.resolve({
            version: () => "fixture",
            newContext: () => {
              throw new Error("must not acquire context");
            },
            close: () => {
              closed = true;
              if (cleanupFails)
                return Promise.reject(new Error("fixture cleanup refusal"));
              return Promise.resolve();
            },
          });
        },
      );
      const result = await provider.resolve(input, {
        signal: controller.signal,
      });
      expect(closed).toBe(true);
      if (result.ok) throw new Error("expected cancelled result");
      const projected = projectAnalysisError(result.error);
      expect(projected.code).toBe(
        cleanupFails ? "cleanup_incomplete" : "cancelled",
      );
      if (cleanupFails) {
        expect(projected.details).toMatchObject({
          diagnostics: { primary_error: { code: "cancelled" } },
        });
      }
    },
  );
  it("returns cleanup_incomplete when owned cleanup fails after an engine error", async () => {
    let launches = 0;
    let closes = 0;
    let cleanupAllowed = false;
    const provider = new NativeModuleResolver(
      { REA_BROWSER_EXECUTABLE: "/browser" },
      () => {
        launches += 1;
        return Promise.resolve({
          version: () => "fixture",
          newContext: () =>
            Promise.reject(new Error("fixture context failure")),
          close: async () => {
            closes += 1;
            if (!cleanupAllowed)
              throw new Error("fixture owned cleanup refusal");
          },
        });
      },
    );
    const result = await provider.resolve(input);
    if (result.ok) throw new Error("expected cleanup failure");
    expect(projectAnalysisError(result.error).code).toBe("cleanup_incomplete");
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(projectAnalysisError(result.error).details).toMatchObject({
      diagnostics: {
        primary_error: {
          details: {
            diagnostics: { error_message: "fixture context failure" },
          },
        },
        cleanup_error: {
          details: { diagnostics: { reason: "fixture owned cleanup refusal" } },
        },
      },
    });
    const blocked = await provider.resolve(input);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.cleanupIncomplete).toBe(true);
    expect(launches).toBe(1);
    await expect(provider.close()).rejects.toMatchObject({
      cleanupIncomplete: true,
    });
    cleanupAllowed = true;
    await provider.close();
    await provider.close();
    expect(closes).toBe(4);
    expect(launches).toBe(1);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupResources).toEqual([]);
    if (!blocked.ok) expect(blocked.error.cleanupIncomplete).toBe(false);
  });
  it("awaits acquisition and cleanup while refusing queued work during shutdown", async () => {
    let acquired: () => void = () => {
      throw new Error("acquisition gate missing");
    };
    const acquiring = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    let release: () => void = () => {
      throw new Error("release gate missing");
    };
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let launches = 0;
    let closes = 0;
    const provider = new NativeModuleResolver(
      { REA_BROWSER_EXECUTABLE: "/browser" },
      async () => {
        launches += 1;
        acquired();
        await released;
        return {
          version: () => "fixture",
          newContext: () =>
            Promise.reject(new Error("fixture context failure")),
          close: async () => {
            closes += 1;
          },
        };
      },
    );
    const first = provider.resolve(input);
    await acquiring;
    const queued = provider.resolve(input);
    const closing = provider.close();
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    release();
    await first;
    const blocked = await queued;
    expect(blocked.ok).toBe(false);
    await closing;
    expect(closed).toBe(true);
    expect([launches, closes]).toEqual([1, 1]);
    expect((await provider.resolve(input)).ok).toBe(false);
  });
});

describe("optional native resolution acquisition", () => {
  it("does not load the browser engine when the selected operation lacks its configuration", async () => {
    const provider = new NativeModuleResolver({}, () => {
      throw new Error("must not launch");
    });
    const result = await provider.resolve(input);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "capability_unavailable",
        message: expect.stringContaining("REA_BROWSER_EXECUTABLE"),
      });
  });
  it.each(["relative/chromium", ""])(
    "retains an invalid selected browser path %j without launching",
    async (executable) => {
      const provider = new NativeModuleResolver(
        { REA_BROWSER_EXECUTABLE: executable },
        () => {
          throw new Error("must not launch");
        },
      );
      const result = await provider.resolve(input);
      if (result.ok) throw new Error("expected configuration refusal");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "capability_unavailable",
        details: {
          reason: "invalid_browser_executable",
          diagnostics: { executable },
        },
      });
    },
  );
  it("does not acquire a browser after caller cancellation", async () => {
    const controller = new AbortController();
    const reason = { request: "opaque admission cancellation" };
    controller.abort(reason);
    const provider = new NativeModuleResolver(
      { REA_BROWSER_EXECUTABLE: "/browser" },
      () => {
        throw new Error("must not launch");
      },
    );
    const result = await provider.resolve(input, { signal: controller.signal });
    if (result.ok) throw new Error("expected cancellation");
    expect(result.error._tag).toBe("AnalysisCancelledError");
    expect(result.error.cause).toBe(reason);
  });
  it("retains the selected executable and actual startup diagnostic", async () => {
    const provider = new NativeModuleResolver(
      { REA_BROWSER_EXECUTABLE: "/missing/browser" },
      () => Promise.reject(new Error("spawn EACCES fixture")),
    );
    const result = await provider.resolve(input);
    if (result.ok) throw new Error("expected startup failure");
    expect(projectAnalysisError(result.error).details).toMatchObject({
      diagnostics: {
        executable: "/missing/browser",
        error_message: "spawn EACCES fixture",
      },
    });
  });
});

describe("completed native resolution finalization", () => {
  it.each([false, true])(
    "retains the completed batch when final close is cancelled (close fails: %s)",
    async (cleanupFails) => {
      const controller = new AbortController();
      const reason = { request: "cancelled during final browser close" };
      let allowClose = !cleanupFails;
      let closes = 0;
      const report = {
        importer_url: input.importerUrl,
        entries: [
          {
            specifier: "./dep.js",
            resolution: { state: "resolved", url: "https://app.test/dep.js" },
          },
        ],
      };
      const launcher = completedModuleResolverLauncher(input, async () => {
        closes += 1;
        controller.abort(reason);
        if (!allowClose) throw new Error("controlled close refusal");
      });
      const provider = new NativeModuleResolver(
        { REA_BROWSER_EXECUTABLE: "/browser" },
        launcher,
      );
      const result = await provider.resolve(input, {
        signal: controller.signal,
      });
      if (result.ok) throw new Error("expected cancelled finalization");
      expect(projectAnalysisError(result.error).code).toBe(
        cleanupFails ? "cleanup_incomplete" : "cancelled",
      );
      expect((result.error.cleanupPrimary ?? result.error).cause).toBe(reason);
      expect(
        webModuleResolutionObservationSchema.parse(
          result.error.partialObservation,
        ),
      ).toMatchObject({
        kind: "web-module-resolution",
        request: input,
        batch: {
          engine: { version: "controlled-browser" },
          resolutions: report.entries.map((entry) => entry.resolution),
          rawResult: { native_report: report, executable_path: "/browser" },
        },
      });
      if (cleanupFails) {
        await expect(provider.close()).rejects.toMatchObject({
          cleanupIncomplete: true,
        });
        expect(result.error.cleanupIncomplete).toBe(true);
        allowClose = true;
      }
      await provider.close();
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(result.error.cleanupResources).toEqual([]);
      expect(projectAnalysisError(result.error).code).toBe("cancelled");
      expect(closes).toBe(cleanupFails ? 3 : 1);
    },
  );
});

it.each([
  { stage: "launch", reason: null },
  { stage: "launch", reason: new Error("opaque cancellation reason") },
  { stage: "context", reason: null },
  { stage: "context", reason: new Error("opaque cancellation reason") },
])(
  "preserves an independent $stage rejection when cancellation arrives before catch: $reason",
  async ({ stage, reason }) => {
    const controller = new AbortController();
    const physicalFailure = new Error("controlled SDK EIO");
    let closes = 0;
    const reject = () => {
      const rejected = Promise.reject(physicalFailure);
      queueMicrotask(() => controller.abort(reason));
      return rejected;
    };
    const provider = new NativeModuleResolver(
      { REA_BROWSER_EXECUTABLE: "/browser" },
      () =>
        stage === "launch"
          ? reject()
          : Promise.resolve({
              version: () => "controlled-browser",
              newContext: reject,
              close: async () => {
                closes += 1;
              },
            }),
    );
    const result = await provider.resolve(input, { signal: controller.signal });
    if (result.ok) throw new Error("expected independent rejection");
    expect(result.error).toMatchObject({
      _tag: "ProviderAdapterError",
      cause: physicalFailure,
    });
    expect(projectAnalysisError(result.error).code).not.toBe("cancelled");
    await provider.close();
    expect(closes).toBe(stage === "launch" ? 0 : 1);
  },
);

it.each(["caller", "deadline"] as const)(
  "attributes an in-flight SDK rejection to the owned %s stop",
  async (control) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    try {
      const controller = new AbortController();
      const reason = { request: "cancel active browser operation" };
      let started!: () => void;
      const active = new Promise<void>((resolve) => {
        started = resolve;
      });
      let rejectCall!: (cause: unknown) => void;
      let closes = 0;
      const provider = new NativeModuleResolver(
        { REA_BROWSER_EXECUTABLE: "/browser" },
        async () => ({
          version: () => "controlled-browser",
          newContext: () => {
            started();
            return new Promise((_resolve, reject) => {
              rejectCall = reject;
            });
          },
          close: async () => {
            closes += 1;
            rejectCall(new Error("controlled SDK target closed"));
          },
        }),
      );
      const pending = provider.resolve(input, { signal: controller.signal });
      await active;
      if (control === "caller") controller.abort(reason);
      else await vi.advanceTimersByTimeAsync(20001);
      const result = await pending;
      if (result.ok) throw new Error("expected interrupted active call");
      expect(projectAnalysisError(result.error).code).toBe(
        control === "caller" ? "cancelled" : "provider_timeout",
      );
      if (control === "caller") expect(result.error.cause).toBe(reason);
      expect(result.error.partialObservation).toBeUndefined();
      await provider.close();
      expect(closes).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  },
);
