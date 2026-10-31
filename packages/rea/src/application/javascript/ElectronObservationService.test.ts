import { expect, it } from "vitest";

import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../../domain/providerCleanupError.js";
import { parseEvidence } from "../../domain/evidence.js";
import {
  electronPageInspectionSchema,
  electronTargetListSchema,
  inspectElectronPageInputSchema,
} from "../../domain/javascript/electronObservation.js";
import { emptyElectronPageCoverage } from "../../domain/javascript/electronPageInspection.fixture.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { err, ok } from "../../domain/result.js";
import type { ElectronObservationPort } from "./ElectronObservationPort.js";
import {
  inspectElectronPage,
  listElectronTargets,
} from "./ElectronObservationService.js";
import {
  expectDroppedPartial,
  expectKeptPartial,
  expectOwnerError,
} from "../ownerObservationExpectation.fixture.js";

const identity = { id: "electron-fixture", name: "Fixture", version: "1" };
const pageProvider = (failure: AnalysisError): ElectronObservationPort => ({
  identity: () => identity,
  listTargets: async () =>
    err(new AnalysisCancelledError("list_electron_targets")),
  inspectPage: async () => err(failure),
});
const input = inspectElectronPageInputSchema.parse({
  cdp_endpoint: "http://127.0.0.1:9222",
  target_id: "electron-page",
  observation_ms: 0,
});
const inspection = electronPageInspectionSchema.parse({
  browser: {
    product: "Electron",
    protocol_version: "1.3",
    revision: "fixture",
    user_agent: "Electron fixture",
    js_version: "V8 fixture",
  },
  target: {
    target_id: "electron-page",
    type: "page",
    title: "Fixture",
    file_path: "/app/index.html",
    attached: false,
  },
  ...emptyElectronPageCoverage(),
});

it("converts a retained raw Electron inspection into partial Evidence", async () => {
  const failure = new AnalysisCancelledError("inspect_electron_page", {
    partialObservation: {
      kind: "electron-page-observation",
      inspection,
      cleanup: "transport-closed",
    },
  });
  const result = await inspectElectronPage(pageProvider(failure), input);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toBe(failure);
    expect(parseEvidence(result.error.partialObservation)).toMatchObject({
      operation: "inspect_electron_page",
      normalized_result: {
        ...inspection,
        limitations: [
          "REA closed its CDP transport; this does not imply target shutdown.",
        ],
      },
      limitations: expect.arrayContaining([
        "REA closed its CDP transport; this does not imply target shutdown.",
      ]),
    });
  }
});

it("converts a raw inspection retained by provider cleanup failure", async () => {
  const failure = new ProviderCleanupError(
    "rea-cdp-electron",
    ["electron-page"],
    { reason: "target detach failed" },
    {
      operation: "inspect_electron_page",
      partialObservation: {
        kind: "electron-page-observation",
        inspection,
        cleanup: "incomplete",
      },
    },
  );
  const result = await inspectElectronPage(pageProvider(failure), input);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toBe(failure);
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(parseEvidence(result.error.partialObservation)).toMatchObject({
      operation: "inspect_electron_page",
      normalized_result: {
        ...inspection,
        limitations: ["CDP transport cleanup remains incomplete."],
      },
      limitations: expect.arrayContaining([
        "CDP transport cleanup remains incomplete.",
      ]),
    });
  }
});

it("returns a typed output error for malformed Electron target output after abort", async () => {
  const controller = new AbortController();
  const malformed = {
    browser: {
      product: "Electron",
      protocol_version: "1.3",
      revision: "fixture",
      user_agent: "Electron fixture",
      js_version: "V8 fixture",
    },
    targets: [],
    excluded: { unsupported_url: 0, non_page: 0 },
    limitations: [() => undefined],
  } as unknown as ReturnType<typeof electronTargetListSchema.parse>;
  const provider: ElectronObservationPort = {
    identity: () => identity,
    listTargets: async () => {
      controller.abort();
      return { ok: true, value: malformed };
    },
    inspectPage: async () =>
      err(new AnalysisCancelledError("inspect_electron_page")),
  };
  const result = await listElectronTargets(
    provider,
    {
      cdp_endpoint: "http://127.0.0.1:9222",
    },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toBeInstanceOf(AnalysisOutputError);
});

it("retains completed target facts when cancellation arrives before Evidence publication", async () => {
  const controller = new AbortController();
  const targets = electronTargetListSchema.parse({
    browser: inspection.browser,
    targets: [],
    excluded: { unsupported_url: 0, non_page: 0 },
    limitations: [],
  });
  const provider: ElectronObservationPort = {
    identity: () => identity,
    listTargets: async () => {
      controller.abort();
      return ok(targets);
    },
    inspectPage: async () =>
      err(new AnalysisCancelledError("inspect_electron_page")),
  };
  const result = await listElectronTargets(
    provider,
    { cdp_endpoint: input.cdp_endpoint },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(parseEvidence(result.error.partialObservation)).toMatchObject({
      operation: "list_electron_targets",
      normalized_result: targets,
    });
  }
});

it.each(["list", "inspect"] as const)(
  "preserves a pre-abort reason before Electron %s provider work",
  async (kind) => {
    const reason = new Error(`stop Electron ${kind}`);
    const controller = new AbortController();
    controller.abort(reason);
    let providerCalls = 0;
    const provider: ElectronObservationPort = {
      identity: () => identity,
      listTargets: async () => {
        providerCalls += 1;
        return err(new AnalysisCancelledError("list_electron_targets"));
      },
      inspectPage: async () => {
        providerCalls += 1;
        return err(new AnalysisCancelledError("inspect_electron_page"));
      },
    };

    const result =
      kind === "list"
        ? await listElectronTargets(
            provider,
            { cdp_endpoint: input.cdp_endpoint },
            { signal: controller.signal },
          )
        : await inspectElectronPage(provider, input, {
            signal: controller.signal,
          });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(AnalysisCancelledError);
      expect(result.error.cause).toBe(reason);
    }
    expect(providerCalls).toBe(0);
  },
);

it("keeps cancellation when the retained Electron inspection is incomplete", async () => {
  const reason = { requested: "stop before page inspection completed" };
  const partial = {
    kind: "electron-page-observation",
    inspection: { target_id: "electron-page" },
    cleanup: "incomplete",
  };
  const failure = new AnalysisCancelledError("inspect_electron_page", {
    cause: reason,
    partialObservation: partial as never,
  });
  const result = await inspectElectronPage(pageProvider(failure), input);
  expectKeptPartial(expectOwnerError(result, failure, reason), partial);
});

it.each([
  { inspection: { requests: Number.NaN }, cleanup: "incomplete" as const },
  {
    inspection: { scripts: [undefined] },
    cleanup: "transport-closed" as const,
  },
])(
  "drops a non-JSON Electron inspection and keeps cancellation primary",
  async (unsafe) => {
    const reason = { requested: "stop before page inspection completed" };
    const failure = new AnalysisCancelledError("inspect_electron_page", {
      cause: reason,
      partialObservation: {
        kind: "electron-page-observation",
        ...unsafe,
      } as never,
    });
    const result = await inspectElectronPage(pageProvider(failure), input);
    expectDroppedPartial(
      expectOwnerError(result, failure, reason),
      "Electron provider retained a non-JSON incomplete observation.",
    );
  },
);
