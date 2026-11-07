import { randomUUID } from "node:crypto";

import { z } from "zod";
import type { Frame, Page } from "playwright-core";

import {
  CDP_CLEANUP_GRACE_MS,
  CDP_DISCOVERY_RESPONSE_TIMEOUT_MS,
  selectedCdpCommandTimeoutMs,
} from "../domain/browserDeadline.js";
import { AnalysisTimeoutError } from "../domain/analysisErrorCore.js";
import { browserObservationEndpointSchema } from "../domain/browserObservation.js";
import { BrowserObservationError } from "../domain/browserObservationError.js";
import { CdpTargetSessionOwner } from "./CdpTargetSessionOwner.js";
import {
  withCdpDiscoveryDeadline,
  type CdpEndpointTarget,
} from "./CdpEndpoint.js";
import { selectCdpDiscoveryTarget } from "./CdpDiscoveryTargets.js";
import {
  attachCdpTargetSession,
  failCdpOpenAfterCleanup,
  openCdpEndpoint,
  type CdpTargetSession,
} from "./CdpTargetSession.js";
import { withPlaywrightExecutionBoundary } from "./PlaywrightExecutionBoundary.js";

const OPERATION = "capture_browser_scenario" as const;
// Restoration performs several sequential CDP mutations before the transport's
// own bounded close. A single round-trip deadline is too short for the complete
// chain on a loaded Windows browser, while retries must still stay bounded.
const POLICY_CLEANUP_CONFIRMATION_TIMEOUT_MS = CDP_CLEANUP_GRACE_MS;
/**
 * First blocked-service-worker registration check, before discovery starts.
 * It keeps the previous fixed 10-second bound. command_timeout_ms does not
 * apply yet, and this timer is not the discovery or attach deadline.
 */
export const SERVICE_WORKER_POLICY_CHECK_TIMEOUT_MS =
  CDP_DISCOVERY_RESPONSE_TIMEOUT_MS;

const serviceWorkerPolicyCheckTimeout = (): AnalysisTimeoutError => {
  const timeoutMs = SERVICE_WORKER_POLICY_CHECK_TIMEOUT_MS;
  return new AnalysisTimeoutError(OPERATION, timeoutMs, {
    userMessage: `Blocked service-worker policy check exceeded its ${String(timeoutMs)} ms deadline before CDP discovery. command_timeout_ms does not apply to this check.`,
    remediationAction: `The ${String(timeoutMs)} ms blocked service-worker policy check stays fixed. This release has no runtime override. command_timeout_ms does not raise it.`,
  });
};

const scriptResponse = z.object({ identifier: z.string() });
const restorationResponse = z.object({
  result: z.object({ value: z.literal("policy_owned").nullable() }),
});
const attachedEvent = z.object({
  sessionId: z.string(),
  targetInfo: z.object({ type: z.string() }),
});
const detachedEvent = z.object({ sessionId: z.string() });
type PolicyTarget = {
  readonly id: string;
  readonly detached: Promise<void>;
  readonly markDetached: () => void;
  ready: Promise<void>;
  identifier?: string;
};

/** Owns only its frame scripts and registration wrappers, never caller-owned workers. */
export class PlaywrightScenarioServiceWorkers {
  readonly #transportOwner = new CdpTargetSessionOwner();
  private readonly marker = JSON.stringify(
    `rea-service-workers-${randomUUID()}`,
  );
  private readonly restoreKey = JSON.stringify(`rea-restore-${randomUUID()}`);
  private readonly secret = JSON.stringify(randomUUID());
  #initialization: Promise<void> | undefined;
  #restoration: Promise<void> | undefined;
  #session: CdpTargetSession | undefined;
  #targets = new Map<string, PolicyTarget>();
  #closed = false;
  #released = false;
  #detached = false;
  #loadingStopped = false;
  #stopRequested = false;
  #stopPromise: Promise<void> | undefined;
  #removeListener: (() => void) | undefined;
  #setup = new AbortController();

  constructor(
    private readonly page: Pick<Page, "frames" | "isClosed" | "mainFrame">,
    private readonly endpoint: string,
    private readonly targetId: string,
    private readonly commandTimeoutMs: number = selectedCdpCommandTimeoutMs(
      undefined,
    ),
  ) {}

  initialize(): Promise<void> {
    return (this.#initialization ??= this.install());
  }

  private async install(): Promise<void> {
    await withPlaywrightExecutionBoundary(
      () => this.assertBlocked(),
      SERVICE_WORKER_POLICY_CHECK_TIMEOUT_MS,
      this.#setup.signal,
      serviceWorkerPolicyCheckTimeout,
    );
    // Discovery stays on its fixed deadline. The following handshake and
    // Target.attachToTarget each use command_timeout_ms.
    const opened = await withCdpDiscoveryDeadline(
      OPERATION,
      this.#setup.signal,
      (signal) =>
        openCdpEndpoint(
          browserObservationEndpointSchema.parse(this.endpoint),
          OPERATION,
          signal,
          undefined,
          this.#transportOwner,
          this.commandTimeoutMs,
        ),
    );
    let target: CdpEndpointTarget;
    try {
      const selected = selectCdpDiscoveryTarget(
        opened.discovery.targets,
        this.targetId,
        OPERATION,
        opened.discovery.ambiguousTargetIds,
      );
      if (selected === undefined)
        throw new BrowserObservationError(OPERATION, "target_not_found");
      target = selected;
    } catch (cause: unknown) {
      if (opened.connection !== undefined)
        return await failCdpOpenAfterCleanup(
          opened.connection,
          cause,
          OPERATION,
          this.#transportOwner,
        );
      throw cause;
    }
    const transport =
      opened.connection ??
      (await this.#transportOwner.connect(
        opened.discovery.webSocket.url,
        OPERATION,
        { signal: this.#setup.signal },
        target.id,
        { commandTimeoutMs: this.commandTimeoutMs },
      ));
    if (this.#closed)
      transport.beginCleanupGrace(POLICY_CLEANUP_CONFIRMATION_TIMEOUT_MS);
    try {
      this.#session = await attachCdpTargetSession(
        transport,
        target,
        OPERATION,
        this.#setup.signal,
        this.#transportOwner,
      );
    } catch (cause: unknown) {
      return await failCdpOpenAfterCleanup(
        transport,
        cause,
        OPERATION,
        this.#transportOwner,
      );
    }
    const connection = this.#session.connection;
    this.#removeListener = connection.onEvent((event) => {
      if (
        event.method === "Target.attachedToTarget" &&
        this.#targets.has(event.sessionId ?? "")
      ) {
        const { sessionId, targetInfo } = attachedEvent.parse(event.params);
        if (targetInfo.type === "iframe") this.addTarget(sessionId);
      } else if (event.method === "Target.detachedFromTarget") {
        const id = detachedEvent.parse(event.params).sessionId;
        this.#targets.get(id)?.markDetached();
        this.#targets.delete(id);
        if (id === this.#session?.sessionId) this.#detached = true;
      }
    });
    const id = this.#session.sessionId;
    if (id === undefined)
      throw new BrowserObservationError(OPERATION, "protocol_error");
    this.addTarget(id);
    await this.settle();
    // CDP returns an identifier even when an init script throws in a realm.
    await withPlaywrightExecutionBoundary(
      () => this.assertBlocked(),
      undefined,
      this.#setup.signal,
    );
  }

  private addTarget(id: string): void {
    this.#targets.get(id)?.markDetached();
    let markDetached: () => void = () => undefined;
    const detached = new Promise<void>((resolve) => {
      markDetached = resolve;
    });
    const target: PolicyTarget = {
      id,
      detached,
      markDetached,
      ready: Promise.resolve(),
    };
    this.#targets.set(id, target);
    const ready = this.initializeTarget(target);
    target.ready = ready;
    void ready.catch(() => undefined);
  }

  private async initializeTarget(target: PolicyTarget): Promise<void> {
    try {
      if (this.#closed) return;
      await this.send(target.id, "Page.enable");
      if (this.#closed) return;
      const added = scriptResponse.parse(
        await this.send(target.id, "Page.addScriptToEvaluateOnNewDocument", {
          runImmediately: true,
          source: `(() => {
          if (!("serviceWorker" in navigator)) return;
          const prototype = ServiceWorkerContainer.prototype;
          const descriptor = Object.getOwnPropertyDescriptor(prototype, "register");
          if (typeof descriptor?.value === "function" && Object.hasOwn(descriptor.value, Symbol.for(${this.marker}))) return;
          const register = () => Promise.reject(new Error("service workers are blocked by scenario policy"));
          Object.defineProperty(register, Symbol.for(${this.marker}), { value: true });
          const secret = ${this.secret};
          Object.defineProperty(globalThis, ${this.restoreKey}, { configurable: true, value: (provided) => {
            if (provided !== secret) return false;
            if (Object.getOwnPropertyDescriptor(prototype, "register")?.value === register) {
              if (descriptor === undefined) delete prototype.register;
              else Object.defineProperty(prototype, "register", descriptor);
            }
            delete globalThis[${this.restoreKey}];
            return true;
          }});
          Object.defineProperty(prototype, "register", { ...descriptor, configurable: true, value: register });
        })()`,
        }),
      );
      target.identifier = added.identifier;
      if (!this.#closed)
        await this.send(target.id, "Target.setAutoAttach", {
          autoAttach: true,
          waitForDebuggerOnStart: true,
          flatten: true,
          filter: [{ type: "iframe", exclude: false }, { exclude: true }],
        });
    } finally {
      // Only this page's iframe targets are attached; unrelated workers/popups
      // are not acquired. Resume a child even if installation or cleanup fails.
      if (
        this.#targets.has(target.id) &&
        target.id !== this.#session?.sessionId
      )
        await this.send(target.id, "Runtime.runIfWaitingForDebugger");
    }
  }

  private send(
    id: string,
    method: string,
    params: Readonly<Record<string, unknown>> = {},
  ): Promise<unknown> {
    if (this.#session === undefined)
      throw new BrowserObservationError(OPERATION, "disconnected");
    return this.#session.connection.send(method, params, id);
  }

  private async settle(): Promise<void> {
    for (;;) {
      const targets = [...this.#targets.values()];
      await Promise.all(targets.map((target) => this.settleTarget(target)));
      if (
        targets.length === this.#targets.size &&
        targets.every((target) => this.#targets.get(target.id) === target)
      )
        return;
    }
  }

  private async settleTarget(target: PolicyTarget): Promise<void> {
    try {
      await Promise.race([target.ready, target.detached]);
    } catch (cause: unknown) {
      if (this.#targets.get(target.id) === target) throw cause;
    }
  }

  private async settleTargetForRestore(target: PolicyTarget): Promise<void> {
    try {
      await Promise.race([target.ready, target.detached]);
    } catch {
      // Setup already reports its own failure. Cleanup must continue from the
      // side effects that were acquired before it failed, such as an init
      // script whose identifier was returned before auto-attach was rejected.
    }
  }

  private restorationScript(): string {
    return `(() => {
      const restore = globalThis[${this.restoreKey}];
      if (typeof restore === "function" && restore(${this.secret}) === true) return null;
      const register = globalThis.ServiceWorkerContainer?.prototype.register;
      return typeof register === "function" && Object.hasOwn(register, Symbol.for(${this.marker}))
        ? "policy_owned"
        : null;
    })()`;
  }

  private async restoreMainFrame(id: string): Promise<void> {
    const { result } = restorationResponse.parse(
      await this.send(id, "Runtime.evaluate", {
        expression: this.restorationScript(),
        returnByValue: true,
      }),
    );
    if (result.value === "policy_owned")
      throw new Error(
        "service-worker policy restoration could not be confirmed",
      );
  }

  private async restorePlaywrightFrame(frame: Frame): Promise<void> {
    try {
      const failure = await frame.evaluate(this.restorationScript());
      if (failure === "policy_owned")
        throw new Error(
          "service-worker policy restoration could not be confirmed",
        );
      if (failure !== null)
        throw new BrowserObservationError(OPERATION, "protocol_error");
    } catch (cause: unknown) {
      if (!this.page.isClosed() && !frame.isDetached()) throw cause;
    }
  }

  private async stopMainFrame(frame: Frame): Promise<void> {
    try {
      await frame.evaluate("globalThis.stop()");
    } catch (cause: unknown) {
      // A closed page no longer has an active navigation to stop. On a live
      // page, including a detached frame, preserve failure so retry can use a
      // fresh main-frame reference.
      if (!this.page.isClosed()) throw cause;
    }
  }

  async assertBlocked(): Promise<void> {
    if (this.#session !== undefined) await this.settle();
    for (const frame of this.page.frames()) {
      let failure: unknown;
      try {
        failure = await frame.evaluate(`(async () => {
          if (!("serviceWorker" in navigator)) return null;
          const serviceWorker = navigator.serviceWorker;
          if (${this.#session !== undefined} &&
              (!Object.hasOwn(serviceWorker.register, Symbol.for(${this.marker})) ||
               typeof globalThis[${this.restoreKey}] !== "function")) return "policy_unprotected";
          if (serviceWorker.controller !== null) return "service_worker_blocked";
          return (await serviceWorker.getRegistrations()).length > 0
            ? "service_worker_blocked"
            : null;
        })()`);
      } catch (cause: unknown) {
        if (frame.isDetached()) continue;
        throw cause;
      }
      if (failure === "policy_unprotected")
        throw new BrowserObservationError(OPERATION, "target_not_allowed");
      if (failure === "service_worker_blocked")
        throw new BrowserObservationError(OPERATION, "service_worker_blocked");
      if (failure !== null)
        throw new BrowserObservationError(OPERATION, "protocol_error");
    }
  }

  close(stopLoading = false): Promise<void> {
    this.#closed = true;
    this.#stopRequested ||= stopLoading;
    // Restoration commands keep the fixed grace even when command_timeout_ms was raised.
    this.#session?.connection.beginCleanupGrace(
      POLICY_CLEANUP_CONFIRMATION_TIMEOUT_MS,
    );
    // Abort discovery/handshakes and reads, never an already-sent page mutation.
    this.#setup.abort();
    const restoration = (this.#restoration ??= this.restore());
    void restoration.then(
      () => {
        if (this.#restoration === restoration) this.#restoration = undefined;
      },
      () => {
        if (this.#restoration === restoration) this.#restoration = undefined;
      },
    );
    // Restoration completion does not discharge a stop request that arrived
    // after that restoration began. Both paths share the owner's stop latch.
    const completion = restoration.then(() => this.fulfillStopRequest());
    return withPlaywrightExecutionBoundary(
      () => completion,
      POLICY_CLEANUP_CONFIRMATION_TIMEOUT_MS,
    );
  }

  private fulfillStopRequest(): Promise<void> {
    if (!this.#stopRequested || this.#loadingStopped) return Promise.resolve();
    if (this.#stopPromise !== undefined) return this.#stopPromise;
    const stopping = (async () => {
      if (this.page.isClosed()) {
        this.#loadingStopped = true;
        return;
      }
      const session = this.#session;
      if (
        !this.#released &&
        !this.#detached &&
        session?.sessionId !== undefined
      ) {
        await this.send(session.sessionId, "Page.stopLoading");
      } else {
        await this.stopMainFrame(this.page.mainFrame());
      }
      this.#loadingStopped = true;
    })();
    this.#stopPromise = stopping;
    void stopping.then(
      () => {
        if (this.#stopPromise === stopping) this.#stopPromise = undefined;
      },
      () => {
        if (this.#stopPromise === stopping) this.#stopPromise = undefined;
      },
    );
    return stopping;
  }

  private async restore(): Promise<void> {
    await this.#initialization?.catch(() => undefined);
    await this.#transportOwner.retryPending();
    this.#session?.connection.beginCleanupGrace(
      POLICY_CLEANUP_CONFIRMATION_TIMEOUT_MS,
    );
    if (this.#released) return;
    const session = this.#session;
    if (session === undefined) {
      await this.#transportOwner.close();
      this.#released = true;
      return;
    }
    if (!this.page.isClosed()) {
      const mainFrame = this.page.mainFrame();
      // This owner exists even with empty storage seeds. Stopped navigation is
      // independent of storage and restoration never waits for a load event.
      await this.fulfillStopRequest();
      await Promise.all(
        [...this.#targets.values()].map((target) =>
          this.settleTargetForRestore(target),
        ),
      );
      for (const target of this.#targets.values()) {
        if (!this.#detached && target.identifier !== undefined) {
          try {
            await this.send(
              target.id,
              "Page.removeScriptToEvaluateOnNewDocument",
              { identifier: target.identifier },
            );
          } catch (cause: unknown) {
            if (this.#targets.get(target.id) === target) throw cause;
          }
          delete target.identifier;
        }
      }
      // Future documents cannot install our wrapper after the removals above.
      // A realm lost to navigation is not assumed restored: retain and retry.
      if (!this.#detached && session.sessionId !== undefined) {
        await this.restoreMainFrame(session.sessionId);
      } else {
        await this.restorePlaywrightFrame(mainFrame);
      }
      for (const frame of this.page.frames()) {
        // The owned CDP session evaluates the selected main realm directly,
        // without Playwright waiting on an in-flight document transition.
        if (frame === mainFrame) continue;
        if (frame.isDetached()) continue;
        // An empty URL has no committed document realm to restore. Future
        // documents cannot install the wrapper after the script removals.
        if (frame.url().length === 0) continue;
        await this.restorePlaywrightFrame(frame);
      }
    }
    // Detaching the exact owned session also releases its iframe auto-attach.
    if (
      !this.page.isClosed() &&
      !this.#detached &&
      session.sessionId !== undefined
    ) {
      await session.connection.send("Target.detachFromTarget", {
        sessionId: session.sessionId,
      });
      this.#detached = true;
    }
    this.#removeListener?.();
    await this.#transportOwner.finish(session.connection);
    await this.#transportOwner.close();
    this.#released = true;
  }
}
