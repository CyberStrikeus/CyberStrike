import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

import { chromium } from "playwright-core";

import { PlaywrightScenarioSession } from "../../dist/browser/PlaywrightScenarioSession.js";
import { PlaywrightScenarioServiceWorkers } from "../../dist/browser/PlaywrightScenarioServiceWorkers.js";
import { createBrowserScenarioProvider } from "../../dist/composition/browserScenario.js";
import { browserScenarioSchema } from "../../dist/domain/browserScenario.js";
import { runScenarioCli } from "./browser-scenario-verifier.mjs";
import { verifyScenarioPolicySetup } from "./browser-scenario-service-worker-setup-e2e.mjs";

const diagnosticError = (error) =>
  error instanceof Error
    ? {
        name: error.name,
        message: error.message.slice(0, 1_000),
        reason: error.reason,
        stack: error.stack?.slice(0, 2_000),
        cause:
          error.cause instanceof Error
            ? error.cause.stack?.slice(0, 3_000)
            : typeof error.cause,
      }
    : { kind: typeof error };

const startSite = async () => {
  let otherOrigin;
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/sw.js") {
      response.setHeader("content-type", "application/javascript");
      response.end(`self.addEventListener("install", () => self.skipWaiting());
        self.addEventListener("activate", event => event.waitUntil(clients.claim()));
        self.addEventListener("fetch", event => {
          if (new URL(event.request.url).pathname === "/probe")
            event.respondWith(new Response("worker"));
        });`);
    } else if (path === "/probe") {
      response.end("network");
    } else if (path === "/failed-navigation") {
      response.destroy();
    } else if (path === "/stalled-image.png") {
      response.writeHead(200, { "content-type": "image/png" });
      response.flushHeaders();
    } else if (path === "/pending-image" || path === "/pending-child") {
      response.setHeader("content-type", "text/html");
      response.end(
        '<!doctype html><img id="pending-image" src="/stalled-image.png">',
      );
    } else if (path === "/pending-frame") {
      response.setHeader("content-type", "text/html");
      response.end(
        '<!doctype html><iframe id="pending-frame" src="/pending-child"></iframe>',
      );
    } else {
      response.setHeader("content-type", "text/html");
      response.end(`<!doctype html><p id="state">ready</p>
        <a id="navigate" href="${otherOrigin}/">Navigate</a>
        ${path === "/frame" ? `<iframe src="${otherOrigin}/"></iframe>` : ""}
        ${
          path === "/register"
            ? `<script>
          navigator.serviceWorker.register('/sw.js').then(
            () => document.querySelector('#state').textContent = 'registered',
            () => {
              document.querySelector('#state').textContent = 'blocked';
              document.querySelector('#state').dataset.blocked = 'true';
            });
        </script>`
            : ""
        }`);
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    setOtherOrigin: (origin) => {
      otherOrigin = origin;
    },
    close: async () => {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
};

/** Real attached-page policy checks, with caller-owned workers on a second origin. */
export async function verifyScenarioServiceWorkers(endpoint, targetId) {
  const first = await startSite();
  const second = await startSite();
  first.setOtherOrigin(second.origin);
  second.setOtherOrigin(first.origin);
  const observer = await chromium.connectOverCDP(endpoint);
  console.log("Service-worker fixture browser:", observer.version());
  let provider = createBrowserScenarioProvider(process.env);
  let session;
  let failure;
  try {
    let page;
    for (const context of observer.contexts()) {
      for (const candidate of context.pages()) {
        const cdp = await context.newCDPSession(candidate);
        const { targetInfo } = await cdp.send("Target.getTargetInfo");
        await cdp.detach();
        if (targetInfo.targetId === targetId) page = candidate;
      }
    }
    assert.ok(page, "External fixture page disappeared");
    const scenarioFor = (url, actions = [], policy = "block") =>
      browserScenarioSchema.parse({
        browser: {
          mode: "connect",
          cdp_endpoint: endpoint,
          target_id: targetId,
        },
        start_url: { url },
        environment: { service_workers: policy },
        actions:
          actions.length === 0
            ? [
                {
                  step_id: "settle",
                  action: "wait_for_timeout",
                  duration_ms: 1,
                },
              ]
            : actions,
        capture: { events: [], after_each_step: ["dom"], at_end: ["dom"] },
      });
    const assertRestored = async () => {
      assert.equal(page.isClosed(), false);
      assert.equal(
        await page.evaluate(() =>
          ServiceWorkerContainer.prototype.register
            .toString()
            .includes("[native code]"),
        ),
        true,
      );
    };
    const assertRejected = async (scenario, expectedReason) => {
      const result = await provider.captureScenario(scenario);
      assert.equal(
        result.ok,
        false,
        "Worker-influenced capture unexpectedly succeeded",
      );
      assert.equal(result.error.reason, expectedReason);
      if (expectedReason === "service_worker_blocked")
        assert.match(
          result.error.userMessage,
          /environment\.service_workers to allow/,
        );
      assert.equal(
        result.error.partialObservation.capture.browser.cleanup,
        "disconnected-external",
      );
      await assertRestored();
    };

    // A fresh attached origin blocks registration, then restores both the
    // current document and future documents when its transport disconnects.
    const clean = scenarioFor(`${first.origin}/register`, [
      {
        step_id: "registration-rejected",
        action: "wait_for",
        locator: { kind: "css", selector: "#state[data-blocked='true']" },
        state: "visible",
      },
    ]);
    let cleanCapture;
    try {
      cleanCapture = (await runScenarioCli(clean)).normalized_result;
    } catch (cause) {
      // Retain the original failure. One bounded replay navigates only this
      // verifier-owned target and exposes causes the CLI does not serialize.
      const state = await page
        .locator("#state")
        .evaluate(
          (element) => ({
            text: element.textContent?.slice(0, 100),
            blocked: element.getAttribute("data-blocked"),
            nativeRegister: navigator.serviceWorker.register
              .toString()
              .includes("[native code]"),
          }),
          undefined,
          { timeout: 1_000 },
        )
        .catch((error) => ({ unavailable: String(error).slice(0, 500) }));
      console.error("Service-worker CLI failure state:", {
        url: page.url(),
        state,
      });
      const replay = await provider
        .captureScenario(clean, { signal: AbortSignal.timeout(5_000) })
        .then((result) =>
          result.ok ? { ok: true } : diagnosticError(result.error),
        )
        .catch(diagnosticError);
      console.error(
        "Service-worker diagnostic replay (original CLI failure retained):",
        replay,
      );
      throw cause;
    }
    assert.ok(cleanCapture.steps.every(({ status }) => status === "completed"));
    assert.equal(cleanCapture.browser.cleanup, "disconnected-external");
    await assertRestored();
    await page.reload();
    await page.getByText("registered", { exact: true }).waitFor();
    await page.evaluate(async () => {
      for (const registration of await navigator.serviceWorker.getRegistrations())
        await registration.unregister();
    });
    await page.goto("about:blank");

    // The caller installs a real worker at a different origin, then moves the
    // selected target away before REA attaches. Its registration must survive.
    await page.goto(second.origin);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    assert.equal(
      await page.evaluate(async () => (await fetch("/probe")).text()),
      "worker",
    );
    await page.goto("about:blank");
    await assertRejected(scenarioFor(second.origin), "service_worker_blocked");
    await page.goto("about:blank");
    await assertRejected(
      scenarioFor(first.origin, [
        {
          step_id: "cross-origin",
          action: "goto",
          destination: { url: second.origin },
          wait_until: "load",
        },
      ]),
      "service_worker_blocked",
    );
    await page.goto("about:blank");
    await assertRejected(
      scenarioFor(first.origin, [
        {
          step_id: "link-navigation",
          action: "click",
          locator: { kind: "css", selector: "#navigate" },
        },
        { step_id: "loaded", action: "wait_for_timeout", duration_ms: 100 },
      ]),
      "service_worker_blocked",
    );
    await page.goto("about:blank");
    await assertRejected(
      scenarioFor(`${first.origin}/frame`),
      "service_worker_blocked",
    );

    const allowed = await provider.captureScenario(
      scenarioFor(second.origin, [], "allow"),
    );
    if (!allowed.ok) throw allowed.error;
    assert.ok(
      allowed.value.steps.every(({ status }) => status === "completed"),
    );
    assert.equal(
      await page.evaluate(async () => (await fetch("/probe")).text()),
      "worker",
    );
    assert.equal(
      await page.evaluate(
        async () => (await navigator.serviceWorker.getRegistrations()).length,
      ),
      1,
    );

    // Restoration also runs after navigation failure and active cancellation.
    await page.goto("about:blank");
    const failed = await provider.captureScenario(
      scenarioFor(`${first.origin}/failed-navigation`),
    );
    assert.equal(failed.ok, false);
    // Chromium completes its error-document transition after goto rejects.
    await page.waitForSelector("#main-frame-error", { state: "attached" });
    // A context replacement can defer restoration. Retained cleanup must
    // restore the replacement document before releasing the external page.
    await provider.close();
    provider = createBrowserScenarioProvider(process.env);
    await page.goto(first.origin);
    await assertRestored();
    const cancellation = new AbortController();
    const pending = provider.captureScenario(
      scenarioFor(`${first.origin}/register`, [
        {
          step_id: "wait",
          action: "wait_for",
          locator: { kind: "css", selector: "#absent" },
          state: "visible",
          timeout_ms: 30_000,
        },
      ]),
      { signal: cancellation.signal },
    );
    try {
      const deadline = Date.now() + 10_000;
      while ((await page.locator("#state").textContent()) !== "blocked") {
        assert.ok(
          Date.now() < deadline,
          "Scenario never applied registration policy",
        );
        await delay(25);
      }
    } finally {
      cancellation.abort();
    }
    const cancelled = await pending;
    assert.ok(
      !cancelled.ok ||
        cancelled.value.steps.some(({ status }) => status === "cancelled"),
    );
    await assertRestored();

    // Caller changes made after installation belong to the caller, too.
    session = await PlaywrightScenarioSession.open(
      scenarioFor(first.origin),
      process.env,
      {},
    );
    await page.evaluate(() => {
      ServiceWorkerContainer.prototype.register =
        function callerReplacement() {};
    });
    await session.close();
    session = undefined;
    assert.equal(
      await page.evaluate(() => ServiceWorkerContainer.prototype.register.name),
      "callerReplacement",
    );
    await page.reload();
    await assertRestored();
    await page.evaluate(() => {
      delete ServiceWorkerContainer.prototype.register;
    });
    const policyBrowser = await chromium.connectOverCDP(endpoint);
    try {
      let policyPage;
      for (const context of policyBrowser.contexts()) {
        for (const candidate of context.pages()) {
          const cdp = await context.newCDPSession(candidate);
          const { targetInfo } = await cdp.send("Target.getTargetInfo");
          await cdp.detach();
          if (targetInfo.targetId === targetId) policyPage = candidate;
        }
      }
      assert.ok(policyPage);
      const policy = new PlaywrightScenarioServiceWorkers(
        policyPage,
        endpoint,
        targetId,
      );
      await policy.initialize();
      await policy.close();
    } finally {
      await policyBrowser.close();
    }
    assert.equal(
      await page.evaluate(() =>
        Object.hasOwn(ServiceWorkerContainer.prototype, "register"),
      ),
      false,
    );
    await page.reload();
    await assertRestored();
    const policyCleanup = await verifyPolicyCleanup({
      page,
      endpoint,
      targetId,
      provider,
      scenarioFor,
      origin: first.origin,
    });
    return {
      mocked: false,
      cli: true,
      production_provider: true,
      initial_navigation: true,
      action_navigation: true,
      cross_origin_frame: true,
      allow_preserves_existing_worker: true,
      registration_blocked: true,
      live_document_and_reload_restored: true,
      failure_and_cancellation_cleanup: true,
      caller_replacement_preserved: true,
      caller_original_absence_preserved: true,
      policyCleanup,
      external_target_preserved: true,
    };
  } catch (cause) {
    failure = cause;
    throw cause;
  } finally {
    await session?.close();
    try {
      await provider.close();
    } catch (cleanupFailure) {
      if (failure !== undefined)
        throw new AggregateError([failure, cleanupFailure]);
      throw cleanupFailure;
    } finally {
      await observer.close();
      await first.close();
      await second.close();
    }
  }
}

const verifyPolicyCleanup = async ({
  page,
  endpoint,
  targetId,
  provider,
  scenarioFor,
  origin,
}) => {
  const nativeRegister = async () =>
    page.evaluate(() =>
      navigator.serviceWorker.register.toString().includes("[native code]"),
    );
  for (const path of ["/pending-image", "/pending-frame"]) {
    const cancellation = new AbortController();
    const pending = provider.captureScenario(scenarioFor(`${origin}${path}`), {
      signal: cancellation.signal,
    });
    try {
      await page
        .locator(
          path === "/pending-image" ? "#pending-image" : "#pending-frame",
        )
        .waitFor({ state: "attached" });
      if (path === "/pending-frame") {
        const child = page
          .frames()
          .find((frame) => frame.parentFrame() !== null);
        assert.ok(child);
        await child.waitForURL(`${origin}/pending-child`, {
          waitUntil: "domcontentloaded",
        });
      }
    } finally {
      cancellation.abort();
    }
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(
      result.error.partialObservation.capture.browser.cleanup,
      "disconnected-external",
    );
    assert.equal(await nativeRegister(), true);
    const next = await provider.captureScenario(scenarioFor(origin));
    if (!next.ok) throw next.error;
    assert.equal(next.value.browser.cleanup, "disconnected-external");
  }

  await page.addInitScript("globalThis.reaCallerInitScript = 'preserved'");
  const policy = new PlaywrightScenarioServiceWorkers(page, endpoint, targetId);
  await policy.initialize();
  const exposure = await page.evaluate(async () => {
    const register = navigator.serviceWorker.register;
    const originals = Object.getOwnPropertySymbols(register).map(
      (symbol) => register[symbol],
    );
    const restore = Object.getOwnPropertyNames(globalThis).find((name) =>
      name.startsWith("rea-restore-"),
    );
    const denied = globalThis[restore]("not-the-session-secret");
    let blocked = false;
    try {
      await navigator.serviceWorker.register("/sw.js");
    } catch {
      blocked = true;
    }
    return {
      exposesOriginal: originals.some(
        (value) => typeof value?.value === "function",
      ),
      denied,
      blocked,
      registrations: (await navigator.serviceWorker.getRegistrations()).length,
    };
  });
  assert.deepEqual(exposure, {
    exposesOriginal: false,
    denied: false,
    blocked: true,
    registrations: 0,
  });

  // Crossing the renderer boundary must not layer a wrapper over an earlier
  // wrapper in a surviving realm, or leave an OOPIF unprotected.
  const crossSite = `${origin.replace("127.0.0.1", "localhost")}/register`;
  await page.evaluate((url) => {
    const child = document.createElement("iframe");
    child.id = "cross-site";
    child.src = url;
    document.body.append(child);
  }, crossSite);
  const child = page.frames().find((frame) => frame.parentFrame() !== null);
  assert.ok(child);
  await child.waitForURL(crossSite, { waitUntil: "load" });
  assert.equal(await child.locator("#state").textContent(), "blocked");
  await page.locator("#cross-site").evaluate((frame, url) => {
    frame.src = url;
  }, `${origin}/register`);
  await child.waitForURL(`${origin}/register`, { waitUntil: "load" });
  assert.equal(await child.locator("#state").textContent(), "blocked");

  // Gate one real frame evaluation to force a new main document between live
  // frame restorations. Browser replies and navigation remain real.
  const originalEvaluate = child.evaluate.bind(child);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  child.evaluate = async (...args) => {
    entered();
    await gate;
    return originalEvaluate(...args);
  };
  const closing = policy.close();
  void closing.catch(() => undefined);
  try {
    await started;
    await page.goto(origin);
  } finally {
    release();
    child.evaluate = originalEvaluate;
  }
  await closing;
  assert.equal(await nativeRegister(), true);
  await page.reload();
  assert.equal(await nativeRegister(), true);
  assert.equal(
    await page.evaluate(() => globalThis.reaCallerInitScript),
    "preserved",
  );
  assert.equal(
    await page.evaluate(() =>
      Object.getOwnPropertyNames(globalThis).some((name) =>
        name.startsWith("rea-restore-"),
      ),
    ),
    false,
  );
  await verifyRejectedPolicyInstallation(page.context(), endpoint, origin);
  const setup = await verifyScenarioPolicySetup(
    endpoint,
    targetId,
    origin,
    page,
  );
  return {
    stalled_image_cancelled: true,
    stalled_frame_cancelled: true,
    target_reused_after_cancel: true,
    private_original_descriptor: true,
    wrong_restore_token_rejected: true,
    renderer_transition: true,
    navigation_during_restoration: true,
    caller_init_script_preserved: true,
    failed_main_installation_rejected: true,
    failed_accessor_installation_rejected: true,
    failed_iframe_installation_rejected: true,
    replaced_iframe_policy_rejected: true,
    setup,
  };
};

const verifyRejectedPolicyInstallation = async (context, endpoint, origin) => {
  for (const realm of ["main", "accessor", "existing-iframe", "new-iframe"]) {
    const page = await context.newPage();
    let policy;
    try {
      await page.goto(origin);
      const cdp = await context.newCDPSession(page);
      const { targetInfo } = await cdp.send("Target.getTargetInfo");
      await cdp.detach();
      policy = new PlaywrightScenarioServiceWorkers(
        page,
        endpoint,
        targetInfo.targetId,
      );
      if (realm === "new-iframe") await policy.initialize();
      let frame = page.mainFrame();
      if (realm === "existing-iframe" || realm === "new-iframe") {
        const crossSite = origin.replace("127.0.0.1", "localhost");
        await page.evaluate((url) => {
          const child = document.createElement("iframe");
          child.src = url;
          document.body.append(child);
        }, crossSite);
        frame = page
          .frames()
          .find((candidate) => candidate.parentFrame() !== null);
        assert.ok(frame);
        await frame.waitForURL(crossSite, { waitUntil: "load" });
      }
      await frame.evaluate((kind) => {
        const prototype = ServiceWorkerContainer.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(
          prototype,
          "register",
        );
        if (kind === "accessor") {
          const original = descriptor.value;
          Object.defineProperty(prototype, "register", {
            configurable: true,
            enumerable: descriptor.enumerable,
            get: () => original,
          });
          return;
        }
        Object.defineProperty(prototype, "register", {
          ...descriptor,
          configurable: false,
          ...(kind === "new-iframe"
            ? { value: function callerReplacement() {} }
            : {}),
        });
      }, realm);
      await assert.rejects(
        realm === "new-iframe" ? policy.assertBlocked() : policy.initialize(),
        (error) => error.reason === "target_not_allowed",
      );
      await policy.close();
      assert.equal(
        await frame.evaluate((replaced) => {
          const register = navigator.serviceWorker.register;
          return replaced
            ? register.name === "callerReplacement"
            : register.toString().includes("[native code]");
        }, realm === "new-iframe"),
        true,
      );
    } finally {
      try {
        await policy?.close();
      } finally {
        await page.close();
      }
    }
  }
};
