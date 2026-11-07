import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const root = resolve(dirname(process.argv[1]), "..");
const load = (path) => import(pathToFileURL(root + "/dist/" + path).href);
const { PlaywrightBrowserScenarioProvider } = await load(
  "browser/PlaywrightBrowserScenarioProvider.js",
);
const { PlaywrightScenarioBrowserCleanupOwner } = await load(
  "browser/PlaywrightScenarioBrowser.js",
);
const { browserStepArtifactsSchema } = await load(
  "domain/browserScenarioCaptureValues.js",
);
const { sanitizeBrowserUrl } = await load("domain/browserObservation.js");
const { AnalysisCancelledError } = await load("domain/analysisErrorCore.js");

// No Chromium process or profile is created. The real provider and cleanup
// owner manage a controlled session; only the public CLI receives OS signals.
class ControlledSession {
  mode = "launch";
  processOwnership = "provider-owned";
  product = "Controlled fixture";
  version = "1";
  initialUrl = "https://app.example.test/";
  cleanup = new PlaywrightScenarioBrowserCleanupOwner({
    closeBrowser: async () => {
      process.stderr.write("REA_CONTROLLED_CLOSE_CALLBACK\n");
    },
    removeProfile: async () => {
      assert.equal(this.cleanup.browserClosed, true);
      process.stderr.write("REA_CONTROLLED_PROFILE_CALLBACK\n");
    },
  });
  get cleanupLease() {
    return this.cleanup.cleanupLease;
  }
  currentUrl() {
    return this.initialUrl;
  }
  sanitizeUrl(value) {
    return sanitizeBrowserUrl(value);
  }
  setStep() {}
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
  async perform(action, signal) {
    assert.equal(action.action, "wait_for_timeout");
    let timer, abort;
    try {
      await new Promise((resolveWait, reject) => {
        timer = setTimeout(resolveWait, 60000);
        abort = () =>
          reject(
            new AnalysisCancelledError("capture_browser_scenario", {
              cause: signal?.reason,
            }),
          );
        signal?.addEventListener("abort", abort, { once: true });
        process.stderr.write(
          "REA_CONTROLLED_BROWSER_READY signal_present=" +
            Number(signal !== undefined) +
            "\n",
        );
        if (signal?.aborted) abort();
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  async capture(requested) {
    const artifact = (kind) =>
      !requested.has(kind)
        ? { state: "not_requested" }
        : kind === "url"
          ? { state: "captured", value: this.sanitizeUrl(this.initialUrl) }
          : { state: "missing", reason: "controlled fixture unavailable" };
    return browserStepArtifactsSchema.parse(
      Object.fromEntries(
        ["screenshot", "dom", "accessibility", "url", "history", "storage"].map(
          (kind) => [kind, artifact(kind)],
        ),
      ),
    );
  }
  async close() {
    await this.cleanup.close();
    return "terminated-owned-process";
  }
  redactError(error) {
    return error instanceof Error
      ? error.message
      : "controlled fixture failure";
  }
}

export const createBrowserScenarioProvider = () =>
  new PlaywrightBrowserScenarioProvider(async () => new ControlledSession());

const composition = pathToFileURL(
  root + "/dist/composition/browserScenario.js",
).href;
const bundledComposition = pathToFileURL(
  root + "/dist/cli-runtime/composition__browserScenario-",
).href;
registerHooks({
  load(url, context, nextLoad) {
    if (url === composition || url.startsWith(bundledComposition))
      return {
        format: "module",
        shortCircuit: true,
        source:
          "export { createBrowserScenarioProvider } from " +
          JSON.stringify(import.meta.url) +
          ";",
      };
    return nextLoad(url, context);
  },
});
