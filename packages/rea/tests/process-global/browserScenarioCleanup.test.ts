import { EventEmitter } from "node:events";
import { Cli } from "incur";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";

import type { BrowserScenarioCapturePort } from "../../src/application/BrowserScenarioCapturePort.js";
import { createBrowserScenarioEvidence } from "../../src/application/BrowserScenarioEvidence.js";
import type { BrowserScenarioSessionPort } from "../../src/browser/BrowserScenarioSessionPort.js";
import { PlaywrightBrowserScenarioProvider } from "../../src/browser/PlaywrightBrowserScenarioProvider.js";
import { PlaywrightScenarioSession } from "../../src/browser/PlaywrightScenarioSession.js";
import { PlaywrightScenarioBrowserCleanupOwner } from "../../src/browser/PlaywrightScenarioBrowser.js";
import { registerBrowserScenarioCommands } from "../../src/cliBrowserScenarioCommands.js";
import { sanitizeBrowserUrl } from "../../src/domain/browserObservation.js";
import {
  browserScenarioSchema,
  type BrowserScenario,
} from "../../src/domain/browserScenario.js";
import type { BrowserScenarioAction } from "../../src/domain/browserScenarioValues.js";
import { browserStepArtifactsSchema } from "../../src/domain/browserScenarioCaptureValues.js";
import { silentLogger } from "../../src/logger.js";
import {
  AnalysisCancelledError,
  AnalysisTimeoutError,
} from "../../src/domain/analysisErrorCore.js";
import { BrowserObservationError } from "../../src/domain/browserObservationError.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { jsonObjectSchema } from "../../src/domain/jsonValue.js";
import { ok } from "../../src/domain/result.js";

const state = vi.hoisted(() => ({
  provider: undefined as BrowserScenarioCapturePort | undefined,
  launchPersistentContext: vi.fn(),
}));
vi.mock("playwright-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("playwright-core")>();
  return {
    ...actual,
    chromium: {
      ...actual.chromium,
      launchPersistentContext: state.launchPersistentContext,
    },
  };
});
vi.mock("../../src/composition/browserScenario.js", () => ({
  createBrowserScenarioProvider: () => state.provider,
}));

const scenario = browserScenarioSchema.parse({
  browser: { mode: "launch", executable_path: resolve("/fixture/chromium") },
  start_url: { url: "https://app.example.test/" },
  actions: [{ step_id: "wait", action: "wait_for_timeout", duration_ms: 1 }],
  storage: {},
  capture: { after_each_step: ["url"], at_end: [], events: [] },
});

// Controlled session failures exercise the real provider and cleanup owner;
// this fixture opens no browser process or profile directory.
class RetrySession implements BrowserScenarioSessionPort {
  readonly mode = "launch";
  readonly processOwnership = "provider-owned";
  readonly product = "Fixture Chromium";
  readonly version = "1";
  readonly initialUrl = "https://app.example.test/";
  closeBrowserCalls = 0;
  profileRemovalCalls = 0;
  readonly cleanup = new PlaywrightScenarioBrowserCleanupOwner({
    closeBrowser: async () => {
      this.closeBrowserCalls += 1;
      if (this.closeBrowserCalls <= this.closeFailures)
        throw new Error(`injected close failure ${this.closeBrowserCalls}`);
    },
    removeProfile: async () => {
      expect(this.cleanup.browserClosed).toBe(true);
      this.profileRemovalCalls += 1;
    },
  });

  get cleanupLease() {
    return this.cleanup.cleanupLease;
  }
  constructor(private readonly closeFailures = 1) {}

  currentUrl() {
    return this.initialUrl;
  }
  sanitizeUrl(value: string) {
    return sanitizeBrowserUrl(value);
  }
  setStep(_index: number) {}
  nextEventSequence() {
    return 1;
  }
  lastEventSequence() {
    return 0;
  }
  events() {
    return {
      retained: 0,
      dropped: 0,
      items: [],
      omissions: {
        by_kind: [],
        network_transactions: [],
        network_transaction_range: null,
      },
    };
  }
  async perform(_action: BrowserScenarioAction) {}
  async capture(
    requested: ReadonlySet<
      BrowserScenario["capture"]["after_each_step"][number]
    >,
  ) {
    const artifact = (
      kind: BrowserScenario["capture"]["after_each_step"][number],
    ) =>
      !requested.has(kind)
        ? { state: "not_requested" }
        : kind === "url"
          ? { state: "captured", value: this.sanitizeUrl(this.initialUrl) }
          : { state: "missing", reason: "fixture unavailable" };
    return browserStepArtifactsSchema.parse({
      screenshot: artifact("screenshot"),
      dom: artifact("dom"),
      accessibility: artifact("accessibility"),
      url: artifact("url"),
      history: artifact("history"),
      storage: artifact("storage"),
    });
  }
  async close() {
    await this.cleanup.close();
    return "terminated-owned-process" as const;
  }
  redactError(error: unknown) {
    return error instanceof Error ? error.message : "fixture failure";
  }
}

it("waits for a slow but successful browser close before removing its profile", async () => {
  const stages: string[] = [];
  const cleanup = new PlaywrightScenarioBrowserCleanupOwner({
    closeBrowser: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_250));
      stages.push("browser-closed");
    },
    removeProfile: async () => {
      stages.push("profile-removed");
    },
  });

  await cleanup.close();
  expect(stages).toEqual(["browser-closed", "profile-removed"]);
});

const serveScenario = async () => {
  const cli = Cli.create("browser-cleanup-test", { sync: false });
  registerBrowserScenarioCommands(cli, silentLogger, {});
  let stdout = "";
  let exitCode = 0;
  await cli.serve(
    ["capture-browser-scenario", JSON.stringify(scenario), "--json"],
    {
      env: {},
      exit: (code) => {
        exitCode = code;
      },
      stdout: (text) => {
        stdout += text;
      },
    },
  );
  return {
    output: jsonObjectSchema.parse(JSON.parse(stdout)),
    exitCode,
    processExitCode: process.exitCode,
  };
};

it("retains the completed scenario when cancellation arrives during final close", async () => {
  let announceClose!: () => void;
  const closeStarted = new Promise<void>((resolve) => {
    announceClose = resolve;
  });
  let releaseClose!: () => void;
  const closeBarrier = new Promise<void>((resolve) => {
    releaseClose = resolve;
  });
  class FinalCloseSession extends RetrySession {
    override async close() {
      announceClose();
      await closeBarrier;
      return super.close();
    }
  }

  const session = new FinalCloseSession(0);
  const provider = new PlaywrightBrowserScenarioProvider(async () => session);
  const cancellation = new AbortController();
  try {
    const pending = provider.captureScenario(scenario, {
      signal: cancellation.signal,
    });
    await closeStarted;
    cancellation.abort();
    releaseClose();

    const result = await pending;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.partialObservation).toMatchObject({
      kind: "browser-scenario-observation",
      capture: {
        browser: { cleanup: "terminated-owned-process" },
        steps: [{ step_id: "scenario_start" }, { step_id: "wait" }],
      },
    });
    expect(session.closeBrowserCalls).toBe(1);
    expect(session.profileRemovalCalls).toBe(1);
  } finally {
    releaseClose();
    cancellation.abort();
    await provider.close();
  }
});

it("retries retained browser cleanup before the one-shot CLI releases its provider", async () => {
  const savedExitCode = process.exitCode;
  const session = new RetrySession();
  const provider = new PlaywrightBrowserScenarioProvider(async () => session);
  const close = vi.spyOn(provider, "close");
  state.provider = provider;
  try {
    const result = await serveScenario();
    expect(result.processExitCode).toBe(1);
    expect(result.output).toMatchObject({
      code: "cleanup_incomplete",
      category: "execution_failure",
      details: {
        cleanup: "incomplete",
        resources: ["browser_transport", "browser_profile"],
        partial_observation: {
          capture: { browser: { cleanup: "incomplete" } },
        },
      },
    });
    const details = jsonObjectSchema.parse(result.output.details);
    const partial = jsonObjectSchema.parse(details.partial_observation);
    expect(jsonObjectSchema.parse(partial.capture).steps).toHaveLength(2);
    expect(close).toHaveBeenCalledTimes(1);
    expect(session.closeBrowserCalls).toBe(2);
    expect(session.profileRemovalCalls).toBe(1);
  } finally {
    // The red baseline must also release this controlled owner.
    await provider.close();
    state.provider = undefined;
    process.exitCode = savedExitCode;
  }
});

it("retries a late Playwright open after cancellation before accepting another capture", async () => {
  let finishLateOpen!: (context: unknown) => void;
  const lateOpen = new Promise<unknown>((resolve) => {
    finishLateOpen = resolve;
  });
  let finishFirstClose!: () => void;
  const firstClose = new Promise<void>((resolve) => {
    finishFirstClose = resolve;
  });
  let firstCloseStarted!: () => void;
  const closeStarted = new Promise<void>((resolve) => {
    firstCloseStarted = resolve;
  });
  let launchCount = 0;
  let firstCloseAttempts = 0;
  const makeContext = () => {
    const page = Object.assign(new EventEmitter(), {
      url: () => "https://app.example.test/",
      goto: async () => undefined,
      waitForTimeout: async () => undefined,
    });
    const browser = {
      contexts: () => [],
      close: async () => undefined,
      version: () => "Fixture Chromium",
    };
    return Object.assign(new EventEmitter(), {
      setDefaultTimeout: () => undefined,
      setDefaultNavigationTimeout: () => undefined,
      addCookies: async () => undefined,
      browser: () => browser,
      pages: () => [page],
      newPage: async () => page,
      close: async () => {
        if (launchCount === 1) {
          firstCloseAttempts += 1;
          if (firstCloseAttempts === 1) {
            firstCloseStarted();
            await firstClose;
            throw new Error("injected late browser close failure");
          }
        }
      },
    });
  };
  state.launchPersistentContext.mockImplementation(() => {
    launchCount += 1;
    return launchCount === 1 ? lateOpen : Promise.resolve(makeContext());
  });
  const provider = new PlaywrightBrowserScenarioProvider((input, options) =>
    PlaywrightScenarioSession.open(input, {}, options),
  );
  const cancellation = new AbortController();
  const firstCapture = provider.captureScenario(scenario, {
    signal: cancellation.signal,
  });
  try {
    await vi.waitFor(() => expect(launchCount).toBe(1));
    cancellation.abort();
    const cancelled = await firstCapture;
    if (cancelled.ok) throw new Error("Expected the first capture to cancel.");
    expect(cancelled.error.cleanupIncomplete).toBe(true);
    let primary = cancelled.error.cleanupPrimary;
    while (primary?.cleanupPrimary !== undefined)
      primary = primary.cleanupPrimary;
    expect(primary).toBeInstanceOf(AnalysisCancelledError);
    expect(primary?.cause).toBe(cancellation.signal.reason);

    finishLateOpen(makeContext());
    await closeStarted;
    finishFirstClose();

    const failedRetry = await provider.captureScenario(scenario);
    expect(failedRetry.ok).toBe(false);
    if (!failedRetry.ok) expect(failedRetry.error.cleanupIncomplete).toBe(true);

    const retried = await provider.captureScenario(scenario);
    expect(retried.ok).toBe(true);
    if (retried.ok) expect(retried.value.steps).toHaveLength(2);
    expect(firstCloseAttempts).toBe(2);
    expect(cancelled.error).toMatchObject({
      cleanupIncomplete: false,
      cleanupResources: [],
    });
    expect(launchCount).toBe(2);
    await provider.close();
    expect(launchCount).toBe(2);
  } finally {
    cancellation.abort();
    finishLateOpen(makeContext());
    finishFirstClose();
    try {
      await provider.close();
    } finally {
      state.launchPersistentContext.mockReset();
    }
  }
});

it("preserves the initial partial observation when the provider cleanup retry also fails", async () => {
  const savedExitCode = process.exitCode;
  const session = new RetrySession(2);
  const provider = new PlaywrightBrowserScenarioProvider(async () => session);
  const close = vi.spyOn(provider, "close");
  state.provider = provider;
  try {
    const result = await serveScenario();
    expect(result.output).toMatchObject({ code: "cleanup_incomplete" });
    expect(result.output).toMatchObject({
      details: {
        diagnostics: {
          primary_error: {
            details: {
              diagnostics: {
                primary_error: {
                  details: { cleanup_reason: "injected close failure 1" },
                },
              },
            },
          },
          cleanup_error: {
            details: { diagnostics: { reason: "injected close failure 2" } },
          },
        },
        partial_observation: {
          capture: {
            browser: { cleanup: "incomplete" },
            steps: [{ step_id: "scenario_start" }, { step_id: "wait" }],
          },
        },
      },
    });
    expect(close).toHaveBeenCalledTimes(1);
    expect(session.closeBrowserCalls).toBe(2);
    expect(session.profileRemovalCalls).toBe(0);
    // Retained ownership remains retryable after the command's failed retry.
    await provider.close();
    expect(session.closeBrowserCalls).toBe(3);
    expect(session.profileRemovalCalls).toBe(1);
  } finally {
    await provider.close();
    state.provider = undefined;
    process.exitCode = savedExitCode;
  }
});

it("retains completed Evidence when provider shutdown fails after a successful capture", async () => {
  const savedExitCode = process.exitCode;
  const provider = new PlaywrightBrowserScenarioProvider(
    async () => new RetrySession(0),
  );
  const captured = await provider.captureScenario(scenario);
  if (!captured.ok) throw captured.error;
  const evidence = createBrowserScenarioEvidence(
    scenario,
    captured.value,
    provider.identity(),
  );
  const close = vi.fn().mockRejectedValue(
    new BrowserObservationError("capture_browser_scenario", "cleanup_failed", {
      cleanup: {
        reason: "injected shutdown failure",
        resources: ["browser_profile"],
      },
    }),
  );
  state.provider = {
    identity: () => provider.identity(),
    captureScenario: async () => ok(captured.value),
    close,
  };
  try {
    const result = await serveScenario();
    expect(result.processExitCode).toBe(1);
    expect(result.output).toMatchObject({
      code: "cleanup_incomplete",
      details: { resources: ["browser_profile"] },
    });
    const details = jsonObjectSchema.parse(result.output.details);
    expect(parseEvidence(details.partial_observation)).toEqual(evidence);
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    await provider.close();
    state.provider = undefined;
    process.exitCode = savedExitCode;
  }
});

it("preserves cancellation diagnostics while retrying retained cleanup", async () => {
  const savedExitCode = process.exitCode;
  const session = new RetrySession();
  vi.spyOn(session, "capture").mockRejectedValue(
    new AnalysisCancelledError("capture_browser_scenario"),
  );
  const provider = new PlaywrightBrowserScenarioProvider(async () => session);
  state.provider = provider;
  try {
    const result = await serveScenario();
    expect(result.output).toMatchObject({
      code: "cleanup_incomplete",
      category: "cancelled",
      details: {
        cleanup: "incomplete",
        diagnostics: {
          primary_error: {
            code: "cleanup_incomplete",
            details: {
              diagnostics: {
                primary_error: { code: "cancelled", category: "cancelled" },
              },
            },
          },
        },
        partial_observation: { kind: "browser-scenario-observation" },
      },
    });
    expect(session.closeBrowserCalls).toBe(2);
    expect(session.profileRemovalCalls).toBe(1);
  } finally {
    await provider.close();
    state.provider = undefined;
    process.exitCode = savedExitCode;
  }
});

it("preserves a thrown capture error when provider shutdown also rejects", async () => {
  const savedExitCode = process.exitCode;
  const provider = new PlaywrightBrowserScenarioProvider(
    async () => new RetrySession(0),
  );
  const primary = new AnalysisTimeoutError("capture_browser_scenario", 123);
  const close = vi
    .fn()
    .mockRejectedValue(new Error("secondary shutdown failure"));
  state.provider = {
    identity: () => provider.identity(),
    captureScenario: async () => {
      throw primary;
    },
    close,
  };
  try {
    const result = await serveScenario();
    expect(result.output).toMatchObject({
      code: "cleanup_incomplete",
      category: "timeout",
      details: {
        execution_failure: "provider_timeout",
        diagnostics: {
          primary_error: { code: "provider_timeout", category: "timeout" },
          cleanup_error: {
            details: { diagnostics: { reason: "secondary shutdown failure" } },
          },
        },
      },
    });
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    await provider.close();
    state.provider = undefined;
    process.exitCode = savedExitCode;
  }
});
