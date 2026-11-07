#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { CdpBrowserProvider } from "../dist/browser/CdpBrowserProvider.js";
import { startRuntimeFixtureBrowser } from "./lib/browser-runtime-fixture-lifecycle.mjs";

import { createBrowserScenarioProvider } from "../dist/composition/browserScenario.js";
import {
  inspectWebPageInputSchema,
  listBrowserTargetsInputSchema,
} from "../dist/domain/browserObservation.js";
import { observeWebSessionInputSchema } from "../dist/domain/browserSession.js";
import { compareWebCapturesInputSchema } from "../dist/domain/webCaptureDiffSchemas.js";
import {
  captureWebScreenshotInputSchema,
  compareWebScreenshotsInputSchema,
} from "../dist/domain/webScreenshot.js";
import { startBrowserVerifierSite } from "./fixtures/browser-verifier-site.mjs";
import { startPageCdpProxy } from "./fixtures/page-cdp-proxy.mjs";
import {
  assertBundleAnalysis,
  assertObservation,
  assertSensitiveShapes,
} from "./lib/browser-verifier-assertions.mjs";
import {
  assertScenarioCapture,
  browserScenario,
  runScenarioCli,
  scenarioProfiles,
  verifyScenarioFailureEvidence,
} from "./lib/browser-scenario-verifier.mjs";
import { completeVerifierRun, createVerifierRun } from "./lib/verifier-run.mjs";
import { withVerifierCleanup } from "./lib/verifier-cleanup.mjs";
import { requireOrdinaryWindowsVerifierCaller } from "./lib/windows-ordinary-user-verifier.mjs";
import { verifyLargeScreenshotE2e } from "./lib/browser-screenshot-e2e.mjs";
import { verifyViewportScreenshotE2e } from "./lib/browser-viewport-screenshot-e2e.mjs";
import { verifyPopupEventCoverage } from "./lib/browser-popup-e2e.mjs";
import { verifyBrowserNetworkEvidence } from "./lib/browser-network-e2e.mjs";
import { verifyBrowserScriptExport } from "./lib/browser-script-export-e2e.mjs";
import { verifyBrowserModules } from "./lib/browser-module-e2e.mjs";
import { verifyBrowserDomDestinations } from "./lib/browser-dom-destinations-e2e.mjs";
import { verifyBrowserSocketTransport } from "./lib/browser-socket-e2e.mjs";
import { verifyBrowserCaptureMetadataBudget } from "./lib/browser-capture-metadata-budget-e2e.mjs";
import { artifactCliEvidence, artifactMcpResult } from "./lib/artifact-e2e.mjs";
import { verifyScenarioEnvironment } from "./lib/browser-scenario-environment-e2e.mjs";
import { verifyScenarioStorage } from "./lib/browser-scenario-storage-e2e.mjs";
import { verifyScenarioStorageFingerprints } from "./lib/browser-scenario-storage-fingerprints-e2e.mjs";
import { verifyScenarioServiceWorkers } from "./lib/browser-scenario-service-workers-e2e.mjs";
import { verifyBrowserUrlUserInfo } from "./lib/browser-url-userinfo-e2e.mjs";

const SCENARIO_SECRET_VALUE = "rea-browser-verifier-secret";
const SCENARIO_URL_SECRET_VALUE = "rea-browser-url-verifier-secret";
process.env.REA_BROWSER_VERIFIER_SECRET = SCENARIO_SECRET_VALUE;
process.env.REA_BROWSER_VERIFIER_URL = SCENARIO_URL_SECRET_VALUE;
const verifierRun = createVerifierRun();

await requireOrdinaryWindowsVerifierCaller();
const executable = await browserExecutable();
let site;
let browser;
let pageProxy;
let report;
await withVerifierCleanup(async () => {
  site = await startBrowserVerifierSite();
  browser = await startRuntimeFixtureBrowser(
    executable,
    `${site.origin}/app?startup=browser-secret-value`,
  );
  const endpoint = `http://127.0.0.1:${String(browser.port)}`;
  const provider = new CdpBrowserProvider();
  const target = await pageTarget(provider, endpoint);
  const observed = await provider.inspectPage(
    inspectWebPageInputSchema.parse({
      cdp_endpoint: endpoint,
      allowed_origins: [site.origin],
      target_id: target,
      observation_ms: 1_000,
      include_storage_keys: true,
      include_storage_fingerprints: true,
    }),
  );
  if (!observed.ok) throw observed.error;
  assertObservation(observed.value, site.origin);
  const domDestinations = await verifyBrowserDomDestinations({
    cdp_endpoint: endpoint,
    target_id: target,
  });
  const serialized = JSON.stringify(observed.value);
  if (
    !observed.value.target.url.includes("startup=browser-secret-value") ||
    !observed.value.network.requests.some((request) =>
      request.url.includes("token=network-secret-value"),
    )
  )
    throw new Error(
      "Passive browser result did not preserve ordinary URL queries",
    );
  for (const secret of [
    "request-secret-value",
    "request-body-secret-value",
    "response-secret-value",
    "storage-secret-value",
    "websocket-secret-value",
  ])
    if (serialized.includes(secret))
      throw new Error(
        `Passive browser result included unselected structured data: ${secret}`,
      );

  const sourceCaptureInput = inspectWebPageInputSchema.parse({
    cdp_endpoint: endpoint,
    allowed_origins: [site.origin],
    target_id: target,
    observation_ms: 1_000,
    include_accessibility_text: true,
    include_script_sources: true,
    include_console_text: true,
    include_json_body_shapes: true,
    include_websocket_shapes: true,
  });
  const withSource = await provider.inspectPage(sourceCaptureInput);
  if (!withSource.ok) throw withSource.error;
  const source = withSource.value.scripts.items.find(
    (script) =>
      script.source.included &&
      script.source.artifact.text.includes("reaSourceMarker"),
  );
  if (source === undefined)
    throw new Error(
      "Real Chrome did not return explicitly approved script source",
    );
  if (
    !withSource.value.accessibility.nodes.some((node) =>
      node.name?.includes("ax-private-label-value"),
    )
  )
    throw new Error(
      "Real Chrome did not return independently approved accessibility text",
    );
  assertSensitiveShapes(withSource.value);

  const bundle = await verifyPublicBundle(endpoint, target, site.origin);

  // Equality needs the same selected facts on both sides. The earlier passive
  // capture deliberately omits source, so it cannot establish source equality.
  const repeatedSource = await provider.inspectPage(sourceCaptureInput);
  if (!repeatedSource.ok) throw repeatedSource.error;
  const captureDiff = await provider.compareCaptures(
    compareWebCapturesInputSchema.parse({
      before: { inspection: withSource.value },
      after: { inspection: repeatedSource.value },
    }),
  );
  if (!captureDiff.ok) throw captureDiff.error;
  if (
    captureDiff.value.dimensions.dom_structure.status !== "unchanged" ||
    captureDiff.value.dimensions.scripts.status !== "unchanged"
  )
    throw new Error(
      `Real Chrome stable capture identities did not reconcile: ${JSON.stringify(
        {
          dom_structure: captureDiff.value.dimensions.dom_structure,
          scripts: captureDiff.value.dimensions.scripts,
          before_completeness: withSource.value.completeness,
          after_completeness: repeatedSource.value.completeness,
        },
      )}`,
    );

  const screenshot = await provider.captureScreenshot(
    captureWebScreenshotInputSchema.parse({
      cdp_endpoint: endpoint,
      allowed_origins: [site.origin],
      target_id: target,
    }),
  );
  if (!screenshot.ok) throw screenshot.error;
  if (
    screenshot.value.viewport.width < 1 ||
    screenshot.value.viewport.height < 1 ||
    screenshot.value.artifact.bytes < 1
  )
    throw new Error("Real Chrome screenshot artifact was empty");
  const screenshotDiff = await provider.compareScreenshots(
    compareWebScreenshotsInputSchema.parse({
      before: screenshot.value.artifact,
      after: screenshot.value.artifact,
    }),
  );
  if (!screenshotDiff.ok) throw screenshotDiff.error;
  if (
    screenshotDiff.value.status !== "identical" ||
    screenshotDiff.value.changed_pixels !== 0
  )
    throw new Error("Real Chrome PNG artifact did not compare identically");

  const sessionPromise = provider.observeSession(
    observeWebSessionInputSchema.parse({
      cdp_endpoint: endpoint,
      allowed_origins: [site.origin],
      target_id: target,
      observation_ms: 1_500,
    }),
  );
  await delay(250);
  site.triggerSessionNavigation();
  const session = await sessionPromise;
  if (!session.ok) throw session.error;
  if (
    !session.value.timeline.some(
      ({ type }) => type === "same_document_navigation",
    ) ||
    !session.value.target.final_url?.includes("/app/session-1")
  )
    throw new Error("Real Chrome same-origin SPA timeline was missing");

  pageProxy = await startPageCdpProxy(endpoint);
  await verifyPageScopedTransport(provider, pageProxy, site.origin);
  const browserSocketTransport = await verifyBrowserSocketTransport({
    provider,
    profile: browser.profile,
    endpoint,
    target,
    origin: site.origin,
  });
  const attachedScenarioInput = browserScenario(
    {
      mode: "connect",
      cdp_endpoint: endpoint,
      target_id: target,
    },
    site.origin,
  );
  let attachedScenario;
  try {
    attachedScenario = await runScenarioCli(attachedScenarioInput);
  } catch (cliError) {
    const direct = await createBrowserScenarioProvider(
      process.env,
    ).captureScenario(attachedScenarioInput);
    if (!direct.ok) {
      const underlying = direct.error.cause;
      const details =
        underlying instanceof Error
          ? `${underlying.name}: ${underlying.message}`
          : String(underlying ?? direct.error.message);
      throw new Error(
        `Attached browser scenario failed through both CLI and provider: ${details}`,
        { cause: cliError },
      );
    }
    throw new Error(
      "Attached browser scenario failed through CLI, but direct provider capture succeeded",
      { cause: cliError },
    );
  }
  if (
    attachedScenario.normalized_result?.browser?.cleanup !==
      "disconnected-external" ||
    attachedScenario.normalized_result?.browser?.process_ownership !==
      "external"
  )
    throw new Error(
      "Scenario CLI did not report external disconnect ownership",
    );
  const versionResponse = await fetch(`${endpoint}/json/version`);
  if (!versionResponse.ok || browser.process.exitCode !== null)
    throw new Error("Scenario attachment terminated its external browser");

  const profilesBefore = await scenarioProfiles();
  process.stderr.write("Browser verifier: scenario environment\n");
  const scenarioEnvironment = await verifyScenarioEnvironment(
    endpoint,
    target,
    site.origin,
  );
  process.stderr.write("Browser verifier: scenario storage\n");
  const scenarioStorage = await verifyScenarioStorage({
    executable,
    endpoint,
    targetId: target,
  });
  process.stderr.write("Browser verifier: scenario storage fingerprints\n");
  const scenarioStorageFingerprints = await verifyScenarioStorageFingerprints(
    executable,
    site.origin,
  );
  process.stderr.write("Browser verifier: scenario service workers\n");
  const scenarioServiceWorkers = await verifyScenarioServiceWorkers(
    endpoint,
    target,
  );
  const launchedScenario = await createBrowserScenarioProvider(
    process.env,
  ).captureScenario(
    browserScenario(
      {
        mode: "launch",
        executable_path: executable,
      },
      site.origin,
    ),
  );
  if (!launchedScenario.ok) throw launchedScenario.error;
  if (
    launchedScenario.value.browser.cleanup !== "terminated-owned-process" ||
    launchedScenario.value.browser.process_ownership !== "provider-owned"
  )
    throw new Error("Scenario launch did not report owned-process cleanup");
  const profilesAfter = await scenarioProfiles();
  if ([...profilesAfter].some((entry) => !profilesBefore.has(entry)))
    throw new Error("Scenario launch retained a temporary browser profile");
  assertScenarioCapture(launchedScenario.value);
  const scenarioFailure = await verifyScenarioFailureEvidence(
    executable,
    site.origin,
  );
  const scenarioResults = JSON.stringify([
    attachedScenario,
    launchedScenario.value,
  ]);
  for (const retainedValue of [
    "token=network-secret-value",
    "token=websocket-url-secret",
    "authorization=Bearer console-secret-value",
    "websocket-secret-value",
  ])
    if (!scenarioResults.includes(retainedValue))
      throw new Error(
        `Browser scenario did not preserve selected value: ${retainedValue}`,
      );
  for (const unselectedValue of [
    SCENARIO_SECRET_VALUE,
    SCENARIO_URL_SECRET_VALUE,
    "request-secret-value",
    "request-body-secret-value",
    "response-secret-value",
    "storage-secret-value",
  ])
    if (scenarioResults.includes(unselectedValue))
      throw new Error(
        `Browser scenario included unselected structured value: ${unselectedValue}`,
      );

  process.stderr.write("Browser verifier: large screenshot\n");
  const largeScreenshot = await verifyLargeScreenshotE2e(endpoint, site.origin);
  process.stderr.write("Browser verifier: visual viewport screenshot\n");
  const viewportScreenshot = await verifyViewportScreenshotE2e(
    endpoint,
    site.origin,
  );
  process.stderr.write("Browser verifier: popup coverage\n");
  const popupEvents = await verifyPopupEventCoverage(executable);
  const networkEvidence = await verifyBrowserNetworkEvidence(
    executable,
    undefined,
    { cdp_endpoint: endpoint, target_id: target },
  );
  const scriptExport = await verifyBrowserScriptExport(executable, undefined, {
    cdp_endpoint: endpoint,
    target_id: target,
  });
  const moduleTrace = await verifyBrowserModules(executable);
  const captureMetadata = await verifyBrowserCaptureMetadataBudget(endpoint);
  const urlUserInfo = await verifyBrowserUrlUserInfo(endpoint, site.origin);
  report = {
    browser: observed.value.browser.product,
    endpoint,
    target,
    domNodes: observed.value.dom.nodes.length,
    accessibilityNodes: observed.value.accessibility.nodes.length,
    scripts: observed.value.scripts.items.length,
    networkRequests: observed.value.network.requests.length,
    consoleEvents: observed.value.console.events.length,
    websocketConnections: observed.value.network.websocket_connections.length,
    websocketFrames: observed.value.network.websocket_connections.reduce(
      (total, connection) => total + connection.events.length,
      0,
    ),
    bundleScripts: bundle.capture.scripts_analyzed,
    sourceMaps: bundle.observations.source_maps.processed,
    bundle_cli_and_stdio_mcp: true,
    sessionEvents: session.value.timeline.length,
    pageScopedTransport: true,
    browserSocketTransport,
    screenshotBytes: screenshot.value.artifact.bytes,
    largeScreenshot,
    popupEvents,
    networkEvidence,
    scriptExport,
    moduleTrace,
    captureMetadata,
    urlUserInfo,
    domDestinations,
    browserScenarioCli: true,
    browserScenarioAttachCleanup: "disconnected-external",
    browserScenarioLaunchCleanup: "terminated-owned-process",
    scenarioFailure,
    scenarioEnvironment,
    scenarioStorage,
    scenarioStorageFingerprints,
    scenarioServiceWorkers,
    viewportScreenshot,
    verified: true,
  };
}, [
  async () => {
    if (pageProxy !== undefined) {
      process.stderr.write("Browser verifier cleanup: closing page proxy\n");
      await pageProxy.close();
    }
  },
  async () => {
    if (browser !== undefined) {
      process.stderr.write("Browser verifier cleanup: stopping owned Chrome\n");
      await browser.close();
    }
  },
  async () => {
    if (site !== undefined) {
      process.stderr.write("Browser verifier cleanup: closing fixture site\n");
      await site.close();
    }
  },
]);
process.stdout.write(
  `${JSON.stringify({
    verifier_run: await completeVerifierRun(verifierRun),
    ...report,
  })}\n`,
);

async function verifyPublicBundle(endpoint, target, origin) {
  const evidence = await artifactCliEvidence("analyze-web-bundle", endpoint, [
    target,
    "--allowed-origins",
    origin,
    "--fetch-source-maps",
    "--observation-ms",
    "200",
  ]);
  assertBundleAnalysis(evidence.normalized_result);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("./rea.mjs", import.meta.url)), "mcp"],
    env: { PATH: process.env.PATH ?? "", REA_LOG_LEVEL: "silent" },
    stderr: "pipe",
  });
  const client = new Client({ name: "browser-bundle-e2e", version: "1" });
  try {
    await client.connect(transport);
    const result = await artifactMcpResult(client, "analyze_web_bundle", {
      cdp_endpoint: endpoint,
      target_id: target,
      allowed_origins: [origin],
      fetch_source_maps: true,
      observation_ms: 200,
    });
    assertBundleAnalysis(result);
  } finally {
    try {
      await client.close();
    } finally {
      await transport.close();
    }
  }
  return evidence.normalized_result;
}

async function verifyPageScopedTransport(provider, proxy, origin) {
  const target = await pageTarget(provider, proxy.endpoint);
  const input = inspectWebPageInputSchema.parse({
    cdp_endpoint: proxy.endpoint,
    allowed_origins: [origin],
    target_id: target,
    observation_ms: 100,
  });
  const observed = await provider.inspectPage(input);
  if (!observed.ok) throw observed.error;
  if (observed.value.dom.nodes.length < 1)
    throw new Error("Page-scoped CDP transport returned no DOM nodes");

  const controller = new AbortController();
  const cancelledPromise = provider.inspectPage(
    { ...input, observation_ms: 5_000 },
    { signal: controller.signal },
  );
  await delay(100);
  controller.abort();
  const cancelled = await cancelledPromise;
  if (
    cancelled.ok ||
    cancelled.error._tag !== "AnalysisCancelledError" ||
    cancelled.error.operation !== "inspect_web_page"
  )
    throw new Error(
      "Page-scoped CDP cancellation lost its operation semantics",
    );

  const disconnectedPromise = provider.observeSession(
    observeWebSessionInputSchema.parse({
      cdp_endpoint: proxy.endpoint,
      allowed_origins: [origin],
      target_id: target,
      observation_ms: 5_000,
    }),
    {
      progress: {
        report(event) {
          if (event.phase === "browser_observation" && event.completed === 1)
            proxy.disconnectClients();
          return Promise.resolve();
        },
      },
    },
  );
  const disconnected = await disconnectedPromise;
  if (
    !disconnected.ok ||
    disconnected.value.window.end_reason !== "transport_disconnected" ||
    !disconnected.value.timeline.some(
      ({ type }) => type === "transport_disconnected",
    ) ||
    disconnected.value.timeline.some(({ type }) => type === "target_terminated")
  )
    throw new Error(
      "Page-scoped CDP disconnect must report transport loss without claiming a target crash",
    );
  const remaining = await provider.listTargets(
    listBrowserTargetsInputSchema.parse({ cdp_endpoint: proxy.endpoint }),
  );
  if (!remaining.ok) throw remaining.error;
  if (!remaining.value.targets.some(({ target_id }) => target_id === target))
    throw new Error("Page-scoped CDP disconnect removed its live target");
}

async function browserExecutable() {
  const candidates = [
    process.env.REA_BROWSER_EXECUTABLE,
    process.argv[2],
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(
    (candidate) => typeof candidate === "string" && candidate.length > 0,
  );
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through explicit and platform-default candidates.
    }
  }
  throw new Error(
    "No Chrome-family executable found; set REA_BROWSER_EXECUTABLE to run real-browser verification",
  );
}

async function pageTarget(provider, endpoint) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const listed = await provider.listTargets(
      listBrowserTargetsInputSchema.parse({
        cdp_endpoint: endpoint,
      }),
    );
    if (listed.ok && listed.value.targets[0] !== undefined)
      return listed.value.targets[0].target_id;
    await delay(25);
  }
  throw new Error("Real Chrome did not expose the local test page target");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
