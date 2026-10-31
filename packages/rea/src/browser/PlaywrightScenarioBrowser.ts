import { PLAYWRIGHT_BROWSER_SCENARIO_PROVIDER_IDENTITY } from "./providerIdentities.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import {
  AnalysisCleanupLeaseGroup,
  AnalysisCleanupLease,
} from "../artifacts/AnalysisCleanupLease.js";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  Browser,
  BrowserContext,
  CDPSession,
  ConnectOverCDPOptions,
  Page,
  chromium,
} from "playwright-core";

import type { BrowserScenario } from "../domain/browserScenario.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { isLiteralLoopbackHostname } from "../domain/browserObservation.js";
import { BrowserObservationError } from "../domain/browserObservationError.js";
import {
  withPlaywrightExecutionBoundary,
  PLAYWRIGHT_CLEANUP_CONFIRMATION_TIMEOUT_MS,
} from "./PlaywrightExecutionBoundary.js";
import {
  releaseLateScenarioCommand,
  scenarioCommandPending,
  scenarioCommandTimeoutMs,
  settleScenarioCommand,
  withScenarioCommandDeadline,
} from "./ScenarioCommandDeadline.js";

const OPERATION = "capture_browser_scenario" as const;

const throwIfScenarioCancelled = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted === true)
    throw new BrowserObservationError(OPERATION, "cancelled", {
      cause: signal?.reason,
    });
};

export interface OpenedScenarioBrowser {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly browser: Pick<Browser, "contexts" | "close" | "version">;
  readonly profilePath: string | undefined;
  readonly cleanup: PlaywrightScenarioBrowserCleanupOwner;
}

/** A retryable obligation that must hold before the browser transport closes. */
export interface PlaywrightScenarioBrowserReleaseGate {
  readonly revision: number;
  run(): Promise<void>;
}

/** Provider actions retained until the owned browser and profile are released. */
interface PlaywrightScenarioCleanupResources {
  readonly closeBrowser: (
    disconnectAtBoundary: (disconnect: () => Promise<void>) => Promise<void>,
  ) => Promise<void>;
  readonly removeProfile: (() => Promise<void>) | undefined;
  readonly onSettled?: (browserClosed: boolean) => void;
}

/** Owns one browser connection and optional private profile through cleanup retries. */
export class PlaywrightScenarioBrowserCleanupOwner {
  #browserClosed = false;
  #profileRemoved: boolean;
  #eventFinalizationPromise: Promise<void> | undefined;
  #eventsFinalized = false;
  #releaseGate: PlaywrightScenarioBrowserReleaseGate | undefined;
  readonly cleanupLease: AnalysisCleanupLease;

  /** Keep the narrow provider actions needed to release one opened browser. */
  constructor(private readonly resources: PlaywrightScenarioCleanupResources) {
    this.#profileRemoved = resources.removeProfile === undefined;
    this.cleanupLease = new AnalysisCleanupLease(
      () =>
        this.#closeResources().finally(() =>
          this.resources.onSettled?.(this.#browserClosed),
        ),
      this,
    );
  }

  get browserClosed(): boolean {
    return this.#browserClosed;
  }

  get cleanupResources(): readonly string[] {
    return [
      ...(!this.#eventsFinalized ? ["browser_events"] : []),
      ...(!this.#browserClosed ? ["browser_transport"] : []),
      ...(!this.#profileRemoved ? ["browser_profile"] : []),
    ];
  }

  /** Await actual resource release, including a late browser acknowledgement. */
  release(
    finishEvents?: () => Promise<void>,
    releaseGate?: PlaywrightScenarioBrowserReleaseGate,
  ): Promise<void> {
    this.#prepareEvents(finishEvents);
    if (releaseGate !== undefined) this.#releaseGate = releaseGate;
    return this.cleanupLease.release();
  }

  close(
    finishEvents?: () => Promise<void>,
    releaseGate?: PlaywrightScenarioBrowserReleaseGate,
  ): Promise<void> {
    return this.#awaitCleanup(this.release(finishEvents, releaseGate));
  }

  #prepareEvents(finishEvents?: () => Promise<void>): void {
    this.#eventFinalizationPromise ??= Promise.resolve().then(async () => {
      await finishEvents?.();
      this.#eventsFinalized = true;
    });
  }

  async #awaitCleanup(cleanup: Promise<void>): Promise<void> {
    try {
      await withPlaywrightExecutionBoundary(
        () => cleanup,
        PLAYWRIGHT_CLEANUP_CONFIRMATION_TIMEOUT_MS,
      );
    } catch (cause: unknown) {
      const failure = new BrowserObservationError(OPERATION, "cleanup_failed", {
        cause,
        cleanup: {
          reason: cause instanceof Error ? cause.message : String(cause),
          resources: this.cleanupResources,
        },
      });
      new AnalysisCleanupLeaseGroup(failure, [this.cleanupLease]);
      throw failure;
    }
  }

  async #closeResources(): Promise<void> {
    const failures: unknown[] = [];
    this.#prepareEvents();
    try {
      await this.#eventFinalizationPromise;
    } catch (cause: unknown) {
      // A failed finalization stays failed: the memoized attempt rejects on
      // every retry so cleanup can never report success for unfinalized
      // events.
      failures.push(cause);
    }
    if (!this.#browserClosed) {
      try {
        await this.resources.closeBrowser((disconnect) =>
          this.#runReleaseGate(disconnect),
        );
        this.#browserClosed = true;
      } catch (cause: unknown) {
        failures.push(cause);
      }
    }
    if (
      this.#browserClosed &&
      !this.#profileRemoved &&
      this.resources.removeProfile !== undefined
    ) {
      try {
        await this.resources.removeProfile();
        this.#profileRemoved = true;
      } catch (cause: unknown) {
        failures.push(cause);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, "Browser session cleanup failed");
  }

  async #runReleaseGate(disconnect: () => Promise<void>): Promise<void> {
    for (;;) {
      const gate = this.#releaseGate;
      if (gate === undefined) {
        await disconnect();
        return;
      }
      const revision = gate.revision;
      await gate.run();
      if (this.#releaseGate === gate && gate.revision === revision) {
        // Invoke the physical disconnect in the same continuation that
        // observes a stable stop revision; no await separates the check and
        // the operation start.
        await disconnect();
        return;
      }
    }
  }
}

interface AttachedScenarioWaiter {
  readonly signal: AbortSignal | undefined;
  readonly resolve: (release: () => void) => void;
  readonly reject: (error: BrowserObservationError) => void;
  onAbort: (() => void) | undefined;
}

interface AttachedScenarioAdmission {
  active: boolean;
  readonly waiters: AttachedScenarioWaiter[];
  cleanupOwner: PlaywrightScenarioBrowserCleanupOwner | undefined;
}

interface AttachedScenarioLease {
  readonly admission: AttachedScenarioAdmission;
  readonly release: () => void;
}

const attachedScenarioAdmissions = new Map<string, AttachedScenarioAdmission>();

const releaseAttachedScenario = (
  key: string,
  admission: AttachedScenarioAdmission,
): void => {
  const waiter = admission.waiters.shift();
  if (waiter === undefined) {
    admission.active = false;
    if (
      admission.cleanupOwner === undefined &&
      attachedScenarioAdmissions.get(key) === admission
    )
      attachedScenarioAdmissions.delete(key);
    return;
  }

  if (waiter.onAbort !== undefined)
    waiter.signal?.removeEventListener("abort", waiter.onAbort);
  if (waiter.signal?.aborted === true) {
    waiter.reject(
      new BrowserObservationError(OPERATION, "cancelled", {
        cause: waiter.signal.reason,
      }),
    );
    releaseAttachedScenario(key, admission);
    return;
  }
  waiter.resolve(createAttachedScenarioRelease(key, admission));
};

const createAttachedScenarioRelease = (
  key: string,
  admission: AttachedScenarioAdmission,
): (() => void) => {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseAttachedScenario(key, admission);
  };
};

/** One browser admission. The key is the discovery URL this endpoint already parses. */
export const attachedScenarioLeaseKey = (
  endpoint: string,
  targetId: string,
): string => {
  const discovery = new URL("/json/version", endpoint);
  // One CDP browser serves every loopback stack on one port, so spellings that
  // reach it through 127.0.0.1 or ::1 must share a single admission.
  if (isLiteralLoopbackHostname(discovery.hostname))
    discovery.hostname = "127.0.0.1";
  return JSON.stringify([discovery.href, targetId]);
};

const acquireAttachedScenario = (
  scenario: Extract<BrowserScenario["browser"], { readonly mode: "connect" }>,
  signal: AbortSignal | undefined,
): Promise<AttachedScenarioLease> => {
  if (signal?.aborted === true)
    return Promise.reject(
      new BrowserObservationError(OPERATION, "cancelled", {
        cause: signal?.reason,
      }),
    );

  const key = attachedScenarioLeaseKey(
    scenario.cdp_endpoint,
    scenario.target_id,
  );
  const admission =
    attachedScenarioAdmissions.get(key) ??
    ({
      active: false,
      waiters: [],
      cleanupOwner: undefined,
    } satisfies AttachedScenarioAdmission);
  attachedScenarioAdmissions.set(key, admission);

  return new Promise((resolve, reject) => {
    const grant = (release: () => void): void =>
      resolve({ admission, release });
    if (!admission.active) {
      admission.active = true;
      grant(createAttachedScenarioRelease(key, admission));
      return;
    }

    const waiter: AttachedScenarioWaiter = {
      signal,
      resolve: (release) => grant(release),
      reject,
      onAbort: undefined,
    };
    admission.waiters.push(waiter);
    if (signal !== undefined) {
      const onAbort = (): void => {
        const index = admission.waiters.indexOf(waiter);
        if (index < 0) return;
        admission.waiters.splice(index, 1);
        signal.removeEventListener("abort", onAbort);
        reject(
          new BrowserObservationError(OPERATION, "cancelled", {
            cause: signal?.reason,
          }),
        );
        if (!admission.active && admission.waiters.length === 0)
          releaseAttachedScenario(key, admission);
      };
      waiter.onAbort = onAbort;
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
    }
  });
};

const allowedBrowserEnvironment = (
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> => {
  const allowed = [
    "DBUS_SESSION_BUS_ADDRESS",
    "DISPLAY",
    "HOME",
    "LANG",
    "LD_LIBRARY_PATH",
    "PATH",
    "SystemRoot",
    "TEMP",
    "TMP",
    "TMPDIR",
    "WAYLAND_DISPLAY",
    "XAUTHORITY",
    "XDG_RUNTIME_DIR",
  ];
  const selected = Object.fromEntries(
    allowed
      .map((name) => [name, environment[name]] as const)
      .filter(
        (entry): entry is readonly [string, string] => entry[1] !== undefined,
      ),
  );
  if (process.platform !== "android") return selected;

  // Android rejects execve() for binaries below Termux's application data
  // directory. Termux supplies an exec interceptor that rewrites those calls
  // through the system linker and removes itself for the launched program.
  // Playwright must retain it for its Chromium child process.
  const prefix = environment.PREFIX;
  if (prefix === undefined) return selected;
  return {
    ...selected,
    LD_PRELOAD: `${prefix}/lib/libtermux-exec.so`,
    TERMUX_EXEC__PROC_SELF_EXE: process.execPath,
  };
};
const ownLateScenarioCommand = (
  cause: unknown,
  retainCleanup: ((lease: AnalysisCleanupLease) => void) | undefined,
  resource: string,
  release: () => Promise<void> = () => releaseLateScenarioCommand(cause),
): boolean => {
  if (scenarioCommandPending(cause) === undefined) return false;
  const late = new AnalysisCleanupLease(release, [resource]);
  retainCleanup?.(late);
  void late.release().catch(() => undefined);
  return true;
};

const findConnectedPage = async (
  browser: Pick<Browser, "contexts">,
  targetId: string,
  signal: AbortSignal | undefined,
  commandTimeoutMs: number,
  retainCleanup: ((lease: AnalysisCleanupLease) => void) | undefined,
): Promise<{ readonly context: BrowserContext; readonly page: Page }> => {
  for (const context of browser.contexts())
    for (const page of context.pages()) {
      let session: CDPSession;
      try {
        session = await withScenarioCommandDeadline(
          () => context.newCDPSession(page),
          commandTimeoutMs,
          "command",
          "Target.attachToTarget",
        );
      } catch (cause: unknown) {
        ownLateScenarioCommand(cause, retainCleanup, "browser_transport");
        throw cause;
      }
      try {
        throwIfScenarioCancelled(signal);
        const { targetInfo } = await withScenarioCommandDeadline(
          () => session.send("Target.getTargetInfo"),
          commandTimeoutMs,
          "command",
          "Target.getTargetInfo",
        );
        throwIfScenarioCancelled(signal);
        if (targetInfo.targetId !== targetId) continue;
        return { context, page };
      } finally {
        await withScenarioCommandDeadline(
          () => session.detach(),
          commandTimeoutMs,
          "command",
          "Target.detachFromTarget",
        );
      }
    }
  throw new BrowserObservationError(OPERATION, "target_not_found");
};

/** Owns the target state changed while one scenario uses an attached page. */
class AttachedScenarioEnvironmentOwner {
  #focusOverride = false;
  #mediaOverride = false;
  #deviceMetricsOverride = false;
  #localeOverride = false;
  #timezoneOverride = false;
  #detached = false;
  #application: Promise<void> | undefined;

  private constructor(
    private readonly page: Page,
    private readonly session: CDPSession,
    private readonly commandTimeoutMs: number,
  ) {}

  static async create(
    context: BrowserContext,
    page: Page,
    commandTimeoutMs: number,
    retainCleanup: ((lease: AnalysisCleanupLease) => void) | undefined,
  ): Promise<AttachedScenarioEnvironmentOwner> {
    let session: CDPSession;
    try {
      session = await withScenarioCommandDeadline(
        () => context.newCDPSession(page),
        commandTimeoutMs,
        "command",
        "Target.attachToTarget",
      );
    } catch (cause: unknown) {
      ownLateScenarioCommand(cause, retainCleanup, "browser_transport");
      throw cause;
    }
    return new AttachedScenarioEnvironmentOwner(
      page,
      session,
      commandTimeoutMs,
    );
  }

  get restored(): boolean {
    return (
      !this.#focusOverride &&
      !this.#mediaOverride &&
      !this.#deviceMetricsOverride &&
      !this.#localeOverride &&
      !this.#timezoneOverride
    );
  }

  get targetClosed(): boolean {
    return this.page.isClosed();
  }

  apply(
    environment: BrowserScenario["environment"],
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const application =
      this.#application ?? this.#applyEnvironment(environment, signal);
    this.#application = application;
    return application;
  }

  async #command(work: Promise<unknown>, method: string): Promise<void> {
    await withScenarioCommandDeadline(
      () => work,
      this.commandTimeoutMs,
      "command",
      method,
    );
  }

  async #applyEnvironment(
    environment: BrowserScenario["environment"],
    signal: AbortSignal | undefined,
  ): Promise<void> {
    await this.#command(
      this.page
        .emulateMedia({
          colorScheme: environment.color_scheme,
          reducedMotion: environment.reduced_motion,
        })
        .then(() => {
          this.#mediaOverride = true;
        }),
      "Emulation.setEmulatedMedia",
    );
    throwIfScenarioCancelled(signal);

    // setViewportSize also resizes the external browser window. CDP metrics
    // provide the scenario viewport without changing that caller-owned window.
    await this.#command(
      this.session
        .send("Emulation.setDeviceMetricsOverride", {
          width: environment.viewport.width,
          height: environment.viewport.height,
          deviceScaleFactor: environment.viewport.device_scale_factor,
          mobile: false,
          dontSetVisibleSize: true,
        })
        .then(() => {
          this.#deviceMetricsOverride = true;
        }),
      "Emulation.setDeviceMetricsOverride",
    );
    throwIfScenarioCancelled(signal);

    await this.#command(
      this.session
        .send("Emulation.setLocaleOverride", {
          locale: environment.locale,
        })
        .then(() => {
          this.#localeOverride = true;
        }),
      "Emulation.setLocaleOverride",
    );
    throwIfScenarioCancelled(signal);

    await this.#command(
      this.session
        .send("Emulation.setTimezoneOverride", {
          timezoneId: environment.timezone,
        })
        .then(() => {
          this.#timezoneOverride = true;
        }),
      "Emulation.setTimezoneOverride",
    );
    throwIfScenarioCancelled(signal);

    // Keep scenario actions usable in the selected background page without
    // Playwright's connection-wide focus override on unrelated pages.
    await this.#command(
      this.session
        .send("Emulation.setFocusEmulationEnabled", { enabled: true })
        .then(() => {
          this.#focusOverride = true;
        }),
      "Emulation.setFocusEmulationEnabled",
    );
    throwIfScenarioCancelled(signal);
  }

  async close(): Promise<void> {
    if (this.#detached) return;
    // The execution boundary can report cancellation or a command deadline
    // before a pending CDP command settles. Wait for that producer, including
    // a command that finishes after its deadline, so every successful mutation
    // is recorded before deciding which state this owner must restore.
    try {
      await this.#application;
    } catch (cause: unknown) {
      await settleScenarioCommand(cause);
    }
    const failures: unknown[] = [];
    if (this.#focusOverride) {
      try {
        await this.session.send("Emulation.setFocusEmulationEnabled", {
          enabled: false,
        });
        this.#focusOverride = false;
      } catch (cause: unknown) {
        failures.push(cause);
      }
    }
    if (this.#timezoneOverride) {
      try {
        await this.session.send("Emulation.setTimezoneOverride", {
          timezoneId: "",
        });
        this.#timezoneOverride = false;
      } catch (cause: unknown) {
        failures.push(cause);
      }
    }
    if (this.#localeOverride) {
      try {
        await this.session.send("Emulation.setLocaleOverride", { locale: "" });
        this.#localeOverride = false;
      } catch (cause: unknown) {
        failures.push(cause);
      }
    }
    if (this.#deviceMetricsOverride) {
      try {
        await this.session.send("Emulation.clearDeviceMetricsOverride");
        this.#deviceMetricsOverride = false;
      } catch (cause: unknown) {
        failures.push(cause);
      }
    }
    if (this.#mediaOverride) {
      try {
        await this.page.emulateMedia({
          colorScheme: null,
          reducedMotion: null,
        });
        this.#mediaOverride = false;
      } catch (cause: unknown) {
        failures.push(cause);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        "Attached browser environment restoration failed",
      );
    await this.session.detach();
    this.#detached = true;
  }
}

/** Preserve an operation failure while reporting any incomplete cleanup. */
export const failBrowserScenarioOperation = async (
  cleanup: AnalysisCleanupLease,
  primaryFailure: unknown,
): Promise<never> => {
  try {
    await withPlaywrightExecutionBoundary(
      () => cleanup.release(),
      PLAYWRIGHT_CLEANUP_CONFIRMATION_TIMEOUT_MS,
    );
  } catch (cause: unknown) {
    const primary =
      primaryFailure instanceof AnalysisError
        ? primaryFailure
        : new ProviderAdapterError(
            PLAYWRIGHT_BROWSER_SCENARIO_PROVIDER_IDENTITY.id,
            OPERATION,
            {
              cause: primaryFailure,
            },
          );
    const failure = new BrowserObservationError(OPERATION, "cleanup_failed", {
      cause,
      cleanup: {
        reason: cause instanceof Error ? cause.message : String(cause),
        resources: cleanup.cleanupResources ?? [],
      },
    });
    new AnalysisCleanupLeaseGroup(failure, [cleanup]);
    throw analysisErrorWithCleanupFailure(
      primary,
      failure,
      OPERATION,
    ).bindCleanupDependencies([primary, failure]);
  }
  throw primaryFailure;
};

type ScenarioBrowserLauncher = Pick<
  typeof chromium,
  "launchPersistentContext"
> & {
  readonly connectOverCDP: (
    endpoint: string,
    options?: Pick<ConnectOverCDPOptions, "timeout" | "noDefaults">,
  ) => Promise<Pick<Browser, "contexts" | "close" | "isConnected" | "version">>;
};

type AttachedBrowserRequest = Extract<
  BrowserScenario["browser"],
  { readonly mode: "connect" }
>;

const openAttachedScenarioBrowser = async (
  browserRequest: AttachedBrowserRequest,
  environment: BrowserScenario["environment"],
  launcher: ScenarioBrowserLauncher,
  signal: AbortSignal | undefined,
  retainCleanup: ((lease: AnalysisCleanupLease) => void) | undefined,
  commandTimeoutMs: number,
): Promise<OpenedScenarioBrowser> => {
  const lease = await acquireAttachedScenario(browserRequest, signal);
  let cleanupOwner: PlaywrightScenarioBrowserCleanupOwner | undefined;
  let environmentOwner: AttachedScenarioEnvironmentOwner | undefined;
  try {
    const priorOwner = lease.admission.cleanupOwner;
    if (priorOwner !== undefined) await priorOwner.close();
    throwIfScenarioCancelled(signal);

    const browser = await withScenarioCommandDeadline(
      () =>
        launcher.connectOverCDP(browserRequest.cdp_endpoint, {
          timeout: commandTimeoutMs,
          // Only the selected target's environment owner may apply overrides.
          // Playwright defaults also mutate unrelated external pages and can
          // require context management on an otherwise usable CDP endpoint.
          noDefaults: true,
        }),
      commandTimeoutMs,
      "handshake",
    );
    const cleanup: PlaywrightScenarioBrowserCleanupOwner =
      new PlaywrightScenarioBrowserCleanupOwner({
        closeBrowser: async (disconnectAtBoundary) => {
          let environmentFailure: unknown;
          const ownedEnvironment = environmentOwner;
          if (ownedEnvironment !== undefined) {
            try {
              await ownedEnvironment.close();
              environmentOwner = undefined;
            } catch (cause: unknown) {
              environmentFailure = cause;
              const browserConnected = browser.isConnected();
              if (ownedEnvironment.targetClosed || !browserConnected) {
                // A destroyed target has no remaining emulation state. A lost
                // transport cannot be retained or retried; release its local
                // owner so later discovery can establish current target state.
                environmentOwner = undefined;
                if (!browserConnected) return;
              } else if (!ownedEnvironment.restored) {
                // Keep the live transport and target session for a cleanup
                // retry while any target override remains.
                throw cause;
              }
            }
          }
          try {
            await disconnectAtBoundary(() => browser.close());
            // Once target state is restored, disconnecting the transport is a
            // definitive fallback for an explicit session detach failure.
            environmentOwner = undefined;
          } catch (browserFailure: unknown) {
            if (environmentFailure !== undefined)
              throw new AggregateError(
                [environmentFailure, browserFailure],
                "Attached browser environment cleanup failed",
              );
            throw browserFailure;
          }
        },
        onSettled: (browserClosed) => {
          if (browserClosed && lease.admission.cleanupOwner === cleanup)
            lease.admission.cleanupOwner = undefined;
          lease.release();
        },
        removeProfile: undefined,
      });
    cleanupOwner = cleanup;
    lease.admission.cleanupOwner = cleanup;
    throwIfScenarioCancelled(signal);
    const target = await withPlaywrightExecutionBoundary(
      () =>
        findConnectedPage(
          browser,
          browserRequest.target_id,
          signal,
          commandTimeoutMs,
          retainCleanup,
        ),
      undefined,
      signal,
    );
    throwIfScenarioCancelled(signal);
    const configuredEnvironment = await withPlaywrightExecutionBoundary(
      () =>
        AttachedScenarioEnvironmentOwner.create(
          target.context,
          target.page,
          commandTimeoutMs,
          retainCleanup,
        ),
      undefined,
      signal,
    );
    environmentOwner = configuredEnvironment;
    await withPlaywrightExecutionBoundary(
      () => configuredEnvironment.apply(environment, signal),
      undefined,
      signal,
    );
    return {
      ...target,
      browser,
      profilePath: undefined,
      cleanup,
    };
  } catch (cause: unknown) {
    if (cleanupOwner === undefined) {
      const owned = ownLateScenarioCommand(
        cause,
        retainCleanup,
        "browser_transport",
        async () => {
          await releaseLateScenarioCommand(cause);
          lease.release();
        },
      );
      if (!owned) lease.release();
      throw cause;
    }
    const cleanup = cleanupOwner;
    const recovery = cleanup.cleanupLease;
    try {
      return await failBrowserScenarioOperation(recovery, cause);
    } catch (failure: unknown) {
      if (failure !== cause) retainCleanup?.(recovery);
      throw failure;
    }
  }
};

/** Launch or attach using the caller-selected environment and browser engine. */
export const openPlaywrightScenarioBrowser = async (
  scenario: BrowserScenario,
  environment: Readonly<Record<string, string | undefined>>,
  options: {
    readonly launcher?: ScenarioBrowserLauncher;
    readonly signal?: AbortSignal | undefined;
    readonly retainCleanup?: (lease: AnalysisCleanupLease) => void;
  } = {},
): Promise<OpenedScenarioBrowser> => {
  // Load Playwright only when a scenario opens; MCP startup stays off its module graph.
  const launcher =
    options.launcher ?? (await import("playwright-core")).chromium;
  const commandTimeoutMs = scenarioCommandTimeoutMs(scenario);
  if (scenario.browser.mode === "connect")
    return openAttachedScenarioBrowser(
      scenario.browser,
      scenario.environment,
      launcher,
      options.signal,
      options.retainCleanup,
      commandTimeoutMs,
    );

  const profilePath = await mkdtemp(join(tmpdir(), "rea-browser-scenario-"));
  let context: BrowserContext;
  const executablePath = scenario.browser.executable_path;
  const headless = scenario.browser.headless;
  let launchStarted = false;
  try {
    await chmod(profilePath, 0o700);
    launchStarted = true;
    context = await withScenarioCommandDeadline(
      () =>
        launcher.launchPersistentContext(profilePath, {
          executablePath,
          headless,
          acceptDownloads: false,
          viewport: {
            width: scenario.environment.viewport.width,
            height: scenario.environment.viewport.height,
          },
          deviceScaleFactor: scenario.environment.viewport.device_scale_factor,
          locale: scenario.environment.locale,
          timezoneId: scenario.environment.timezone,
          colorScheme: scenario.environment.color_scheme,
          reducedMotion: scenario.environment.reduced_motion,
          serviceWorkers: scenario.environment.service_workers,
          env: allowedBrowserEnvironment(environment),
          handleSIGHUP: false,
          handleSIGINT: false,
          handleSIGTERM: false,
          timeout: commandTimeoutMs,
          // Termux's Chromium cannot create its renderer process through Android's
          // executable boundary. Single-process mode keeps the browser and page in
          // the Termux-launched process so scenario navigation remains available.
          args:
            process.platform === "android"
              ? ["--no-sandbox", "--single-process"]
              : [],
        }),
      commandTimeoutMs,
      "launch",
      undefined,
      executablePath,
    );
  } catch (cause: unknown) {
    const cleanup = new AnalysisCleanupLease(async () => {
      await releaseLateScenarioCommand(cause);
      await rm(profilePath, { recursive: true, force: true, maxRetries: 3 });
    }, ["browser_profile"]);
    // Preserve Playwright's launch diagnostics before the generic provider
    // boundary discards an untyped error. Keep the original cause for late
    // command cleanup and leave typed timeout/cancellation failures intact.
    const primary =
      launchStarted && !(cause instanceof AnalysisError)
        ? new ProviderAdapterError(
            PLAYWRIGHT_BROWSER_SCENARIO_PROVIDER_IDENTITY.id,
            OPERATION,
            {
              cause,
              userMessage: "The selected browser could not start.",
              remediationAction:
                "Review the selected executable and startup diagnostics, then correct the launch configuration before retrying.",
              diagnostics: {
                executable_path: executablePath,
                startup_error:
                  cause instanceof Error ? cause.message : String(cause),
              },
            },
          )
        : cause;
    try {
      return await failBrowserScenarioOperation(cleanup, primary);
    } catch (failure: unknown) {
      if (failure !== primary) options.retainCleanup?.(cleanup);
      throw failure;
    }
  }
  const cleanup = new PlaywrightScenarioBrowserCleanupOwner({
    closeBrowser: async (disconnectAtBoundary) => {
      await disconnectAtBoundary(() => context.close());
    },
    removeProfile: () =>
      rm(profilePath, { recursive: true, force: true, maxRetries: 3 }),
  });
  try {
    const browser = context.browser();
    if (browser === null)
      throw new BrowserObservationError(OPERATION, "protocol_error");
    const page = context.pages()[0] ?? (await context.newPage());
    return {
      context,
      page,
      browser,
      profilePath,
      cleanup,
    };
  } catch (cause: unknown) {
    const recovery = cleanup.cleanupLease;
    try {
      return await failBrowserScenarioOperation(recovery, cause);
    } catch (failure: unknown) {
      if (failure !== cause) options.retainCleanup?.(recovery);
      throw failure;
    }
  }
};
