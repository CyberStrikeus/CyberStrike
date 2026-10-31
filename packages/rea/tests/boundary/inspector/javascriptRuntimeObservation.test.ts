import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, test } from "vitest";

import { createJavaScriptRuntimeObservationEvidence } from "../../../src/application/javascript/JavaScriptRuntimeObservationEvidence.js";
import { createBrowserEvidence } from "../../../src/application/BrowserEvidence.js";
import {
  listJavaScriptRuntimeTargets,
  observeJavaScriptRuntime,
} from "../../../src/application/javascript/JavaScriptRuntimeObservationService.js";
import { reconcileJavaScriptRuntimeEvidence } from "../../../src/application/javascript/JavaScriptRuntimeReconciliationService.js";
import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { V8_INSPECTOR_PROVIDER_IDENTITY } from "../../../src/inspector/providerIdentity.js";
import { V8InspectorProvider } from "../../../src/inspector/V8InspectorProvider.js";
import { JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE } from "../../../src/contracts/javascript/javascriptRuntimeReconciliationExample.js";
import type {
  JavaScriptRuntimeObservation,
  ObserveJavaScriptRuntimeInput,
} from "../../../src/domain/javascript/javascriptRuntimeObservation.js";
import {
  javascriptRuntimeObservationSchema,
  observeJavaScriptRuntimeInputSchema,
} from "../../../src/domain/javascript/javascriptRuntimeObservation.js";
import { inspectWebPageInputSchema } from "../../../src/domain/browserObservation.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import { javascriptRuntimeReconciliationResultSchema } from "../../../src/domain/javascript/javascriptRuntimeReconciliationSchemas.js";
import { parseRuntimeCaptures } from "../../../src/domain/javascript/javascriptRuntimeReconciliationCaptureParsing.js";
import { startFakeV8Inspector } from "../../fixtures/inspector/fakeV8Inspector.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

test("reports static-layer Evidence digest failure at its caller path", () => {
  const layer = JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE.static_layers[0];
  if (layer === undefined) throw new Error("Expected a static layer example");
  const runtime = createJavaScriptRuntimeObservationEvidence(
    "observe_javascript_runtime",
    {
      inspector_endpoint: "http://127.0.0.1:9229",
      target_id: "example-v8-target",
      runtime_kind: "electron-main",
      observation_ms: 100,
    },
    runtimeObservation("/tmp/index.html", "/tmp/main.js"),
    V8_INSPECTOR_PROVIDER_IDENTITY,
  );
  const result = reconcileJavaScriptRuntimeEvidence({
    static_layers: [
      {
        ...layer,
        analysis: { ...layer.analysis, evidence_id: `ev_${"0".repeat(64)}` },
      },
    ],
    runtime_observations: [runtime],
  });
  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisInputError",
      issues: [
        {
          path: ["static_layers", 0, "analysis", "evidence_id"],
          reason: "invalid_value",
          message: "Evidence semantic identifier does not match its record",
        },
      ],
    },
  });
});

test("reports browser origin scope mismatch at the caller parameter path", async () => {
  const browser = await startFakeCdpBrowser();
  try {
    const provider = new CdpBrowserProvider();
    const input = inspectWebPageInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 0,
    });
    const observed = await provider.inspectPage(input);
    if (!observed.ok) throw observed.error;
    const evidence = createBrowserEvidence(
      "inspect_web_page",
      input,
      observed.value,
      provider.identity(),
    );
    const invalidEvidence = createEvidence(undefined, evidence.provider, {
      predicateType: evidence.predicate_type,
      operation: evidence.operation,
      parameters: { ...evidence.parameters, allowed_origins: [] },
      result: evidence.normalized_result,
      confidence: evidence.confidence,
      authority: evidence.authority,
      environment: evidence.environment,
      limitations: evidence.limitations,
    });
    const result = reconcileJavaScriptRuntimeEvidence({
      static_layers: JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE.static_layers,
      runtime_observations: [invalidEvidence],
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisInputError",
        issues: [
          {
            path: ["runtime_observations", 0, "parameters", "allowed_origins"],
            reason: "invalid_value",
            message:
              "Browser Evidence target is outside its recorded origin scope",
          },
        ],
      },
    });
  } finally {
    await browser.close();
  }
});

describe("Inspector execution-context lifecycle metadata", () => {
  test.each([
    [
      "Runtime.executionContextDestroyed",
      { executionContextId: 1 },
      "destroyed",
    ],
    ["Runtime.executionContextsCleared", {}, "cleared"],
  ] as const)(
    "preserves observed context metadata after %s",
    async (method, params, state) => {
      const fixture = await runtimeFixture();
      const fake = await startFakeV8Inspector({
        targetUrl: pathToFileURL(fixture.entry).href,
        runtimeEvents: [
          {
            method: "Runtime.executionContextCreated",
            params: {
              context: {
                id: 1,
                origin: "https://context.example",
                name: "worker#one",
              },
            },
          },
          { method, params },
        ],
      });
      try {
        const result = await new V8InspectorProvider().observe(
          observeInput(fake.endpoint, fake.targetId, "node"),
        );
        if (!result.ok) throw result.error;
        expect(result.value.execution_contexts).toEqual([
          {
            context_key: "1",
            state,
            name: "worker#one",
            origin: "https://context.example",
          },
        ]);
      } finally {
        await fake.close();
      }
    },
  );

  test("replaces context metadata only when a new context creation is observed", async () => {
    const fixture = await runtimeFixture();
    const fake = await startFakeV8Inspector({
      targetUrl: pathToFileURL(fixture.entry).href,
      runtimeEvents: [
        {
          method: "Runtime.executionContextCreated",
          params: {
            context: {
              id: 1,
              origin: "https://old.example",
              name: "old context",
            },
          },
        },
        {
          method: "Runtime.executionContextDestroyed",
          params: { executionContextId: 1 },
        },
        {
          method: "Runtime.executionContextCreated",
          params: { context: { id: 1, origin: "", name: "" } },
        },
        {
          method: "Runtime.executionContextDestroyed",
          params: { executionContextId: 2 },
        },
      ],
    });
    try {
      const result = await new V8InspectorProvider().observe(
        observeInput(fake.endpoint, fake.targetId, "node"),
      );
      if (!result.ok) throw result.error;
      expect(result.value.execution_contexts).toEqual([
        { context_key: "1", state: "created", name: "", origin: "" },
        { context_key: "2", state: "destroyed", name: null, origin: null },
      ]);
    } finally {
      await fake.close();
    }
  });

  test.each([
    ["malformed", "2", "1"],
    ["valid", 2, 1],
  ] as const)(
    "accounts for %s context IDs in lifecycle events",
    async (mode, createdId, destroyedId) => {
      const fixture = await runtimeFixture();
      const fake = await startFakeV8Inspector({
        targetUrl: pathToFileURL(fixture.entry).href,
        runtimeEvents: [
          {
            method: "Runtime.executionContextCreated",
            params: { context: { id: 1, name: "main", origin: "" } },
          },
          {
            method: "Runtime.executionContextCreated",
            params: { context: { id: createdId, name: "worker", origin: "" } },
          },
          {
            method: "Runtime.executionContextDestroyed",
            params: { executionContextId: destroyedId },
          },
        ],
        scriptEvents: [],
      });
      try {
        const result = await new V8InspectorProvider().observe(
          observeInput(fake.endpoint, fake.targetId, "node"),
        );
        if (!result.ok) throw result.error;
        const invalidContextUnknowns = result.value.unknowns.filter((text) =>
          text.includes("malformed execution-context ID"),
        );
        expect(result.value.capture).toMatchObject({
          events_observed: 3,
          events_retained: 3,
          events_dropped: 0,
          truncated: false,
        });
        if (mode === "malformed") {
          expect(result.value.execution_contexts).toEqual([
            { context_key: "1", state: "created", name: "main", origin: "" },
          ]);
          expect(invalidContextUnknowns).toEqual([
            "2 execution-context lifecycle events with a missing or malformed execution-context ID were excluded; the affected contexts' lifecycle state is unknown.",
          ]);
          return;
        }
        expect(result.value.execution_contexts).toEqual([
          { context_key: "1", state: "destroyed", name: "main", origin: "" },
          { context_key: "2", state: "created", name: "worker", origin: "" },
        ]);
        expect(invalidContextUnknowns).toEqual([]);
      } finally {
        await fake.close();
      }
    },
  );
});

test("rejects unknown runtime observation fields", () => {
  expect(
    observeJavaScriptRuntimeInputSchema.safeParse({
      inspector_endpoint: "http://127.0.0.1:9229",
      target_id: "target-1",
      unknown_field: true,
    }).success,
  ).toBe(false);
});

test("returns every target exposed by the selected Inspector endpoint inline", async () => {
  const fixture = await runtimeFixture();
  const fake = await startFakeV8Inspector({
    targetUrl: pathToFileURL(fixture.entry).href,
    additionalTargetCount: 205,
  });
  try {
    const listed = await new V8InspectorProvider().listTargets({
      inspector_endpoint: fake.endpoint,
    });
    if (!listed.ok) throw listed.error;
    expect(listed.value.targets).toHaveLength(206);
    expect(listed.value.targets[0]?.target_id).toBe(fake.targetId);
  } finally {
    await fake.close();
  }
});

test.each([
  { label: "omitted", attached: undefined, expected: null },
  { label: "explicitly detached", attached: false, expected: false },
] as const)(
  "preserves $label V8 attachment state through listing and observation",
  async ({ attached, expected }) => {
    const fixture = await runtimeFixture();
    const fake = await startFakeV8Inspector({
      targetUrl: pathToFileURL(fixture.entry).href,
      ...(attached === undefined ? {} : { attached }),
    });
    try {
      const provider = new V8InspectorProvider();
      const listed = await provider.listTargets({
        inspector_endpoint: fake.endpoint,
      });
      if (!listed.ok) throw listed.error;
      expect(listed.value.targets[0]?.attached).toBe(expected);
      if (expected === null)
        expect(
          listed.value.limitations.some((item) =>
            item.includes("attachment state"),
          ),
        ).toBe(true);

      const observed = await provider.observe(
        observeInput(fake.endpoint, fake.targetId, "node"),
      );
      if (!observed.ok) throw observed.error;
      expect(observed.value.target.attached).toBe(expected);
      if (expected === null)
        expect(
          observed.value.limitations.some((item) =>
            item.includes("attachment state"),
          ),
        ).toBe(true);
    } finally {
      await fake.close();
    }
  },
);

test("rejects a V8 target explicitly marked attached", async () => {
  const fixture = await runtimeFixture();
  const fake = await startFakeV8Inspector({
    targetUrl: pathToFileURL(fixture.entry).href,
    attached: true,
  });
  try {
    const result = await new V8InspectorProvider().observe(
      observeInput(fake.endpoint, fake.targetId, "node"),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { reason: "target_not_allowed" },
    });
    expect(fake.commands).toEqual([]);
  } finally {
    await fake.close();
  }
});

test("includes targets outside the old caller root filter", async () => {
  const fixture = await runtimeFixture();
  const outside = await temporaryFile("outside.js");
  const fake = await startFakeV8Inspector({
    targetUrl: pathToFileURL(fixture.entry).href,
    additionalTargetUrl: pathToFileURL(outside).href,
  });
  try {
    const result = await new V8InspectorProvider().listTargets({
      inspector_endpoint: fake.endpoint,
    });
    if (!result.ok) throw result.error;
    expect(result.value.targets).toHaveLength(2);
    expect(result.value.targets.map(({ location }) => location)).toContainEqual(
      expect.objectContaining({ file_path: outside }),
    );
  } finally {
    await fake.close();
  }
});

test("captures complete metadata with two enable commands", async () => {
  const fixture = await runtimeFixture();
  const outside = await temporaryFile("secret.js");
  const fake = await startFakeV8Inspector({
    targetUrl: pathToFileURL(fixture.entry).href,
    scriptUrls: [
      pathToFileURL(fixture.entry).href,
      "node:fs",
      pathToFileURL(outside).href,
    ],
  });
  try {
    const result = await new V8InspectorProvider().observe(
      observeInput(fake.endpoint, fake.targetId, "node"),
    );
    if (!result.ok) throw result.error;
    expect(result.value.scripts.items).toHaveLength(3);
    expect(result.value.scripts.excluded.unsupported_location).toBe(0);
    expect(result.value.execution_contexts).toEqual([
      {
        context_key: "1",
        state: "created",
        name: "node[fixture]",
        origin: "",
      },
    ]);
    expect(new Set(fake.commands.map(({ method }) => method))).toEqual(
      new Set(["Runtime.enable", "Debugger.enable"]),
    );
    expect(result.value.scripts.items).toContainEqual(
      expect.objectContaining({
        location: expect.objectContaining({ file_path: outside }),
      }),
    );
    expect(result.value.unavailable_without_instrumentation).toContain(
      "Electron IPC messages and handlers",
    );
  } finally {
    await fake.close();
  }
});

test("excludes an Electron main target that reports only bare file://", async () => {
  const fixture = await runtimeFixture();
  const fake = await startFakeV8Inspector({
    targetUrl: "file://",
    scriptUrls: [pathToFileURL(fixture.entry).href],
  });
  try {
    const provider = new V8InspectorProvider();
    const listed = await provider.listTargets({
      inspector_endpoint: fake.endpoint,
    });
    if (!listed.ok) throw listed.error;
    expect(listed.value.targets).toEqual([]);

    const observed = await provider.observe(
      observeInput(fake.endpoint, fake.targetId, "electron-main"),
    );
    expect(observed.ok).toBe(false);
    if (observed.ok) return;
    expect(observed.error.message).toMatch(/target/u);
  } finally {
    await fake.close();
  }
});

test.each([
  ["node", "node"],
  ["electron-main", "node"],
  ["electron-preload", "page"],
  ["electron-renderer", "page"],
] as const)(
  "admits declared %s only on its protocol target family",
  async (runtimeKind, targetType) => {
    const fixture = await runtimeFixture();
    const fake = await startFakeV8Inspector({
      targetUrl: pathToFileURL(fixture.entry).href,
      targetType,
    });
    try {
      const result = await new V8InspectorProvider().observe(
        observeInput(fake.endpoint, fake.targetId, runtimeKind),
      );
      expect(result.ok).toBe(true);
    } finally {
      await fake.close();
    }
  },
);

describe("complete Inspector script hashes", () => {
  test("keeps more than one hundred long script hashes distinct", async () => {
    const fixture = await runtimeFixture();
    const url = pathToFileURL(fixture.entry).href;
    const prefix = "h".repeat(512);
    const scriptHashes = Array.from(
      { length: 101 },
      (_, index) => `${prefix}${String(index)}`,
    );
    const fake = await startFakeV8Inspector({
      targetUrl: url,
      scriptUrls: scriptHashes.map(() => url),
      scriptHashes,
    });
    try {
      const result = await new V8InspectorProvider().observe({
        ...observeInput(fake.endpoint, fake.targetId, "node"),
        observation_ms: 1_000,
      });
      if (!result.ok) throw result.error;
      expect(result.value.scripts.items).toHaveLength(scriptHashes.length);
      expect(
        new Set(result.value.scripts.items.map(({ cdp_hash }) => cdp_hash)),
      ).toEqual(new Set(scriptHashes));
    } finally {
      await fake.close();
    }
  });
});

describe("undeclared V8 runtime role", () => {
  test("observes a target without inventing a runtime role", async () => {
    const fixture = await runtimeFixture();
    const fake = await startFakeV8Inspector({
      targetUrl: pathToFileURL(fixture.entry).href,
      targetType: "page",
    });
    try {
      const input = observeInput(fake.endpoint, fake.targetId, "node");
      delete input.runtime_kind;
      const result = await new V8InspectorProvider().observe(input);
      if (!result.ok) throw result.error;
      expect(result.value.target).toMatchObject({
        protocol_type: "page",
        runtime_kind: "unknown",
        runtime_kind_authority: "not-declared",
      });
    } finally {
      await fake.close();
    }
  });
});

describe("V8 Inspector script retention", () => {
  test("retains authorized script locations longer than the former byte ceiling", async () => {
    const longUrl = `https://example.test/${"a".repeat(20_000)}`;
    const fake = await startFakeV8Inspector({
      targetUrl: longUrl,
      scriptUrls: [longUrl],
    });
    try {
      const input = {
        ...observeInput(fake.endpoint, fake.targetId, "node"),
      };
      const result = await new V8InspectorProvider().observe(input);
      if (!result.ok) throw result.error;
      expect(result.value.scripts.items).toHaveLength(1);
      expect(result.value.scripts.items[0]?.location).toMatchObject({
        kind: "url",
        origin: "https://example.test",
        sanitized_url: longUrl,
      });
    } finally {
      await fake.close();
    }
  });

  test("returns every authorized script beyond the former collection ceiling", async () => {
    const fixture = await runtimeFixture();
    const scriptUrls = [
      pathToFileURL(fixture.entry).href,
      ...Array.from({ length: 2_004 }, () => pathToFileURL(fixture.entry).href),
    ];
    const fake = await startFakeV8Inspector({
      targetUrl: pathToFileURL(fixture.entry).href,
      scriptUrls,
    });
    try {
      const input = {
        ...observeInput(fake.endpoint, fake.targetId, "node"),
        observation_ms: 1_000,
      };
      const result = await new V8InspectorProvider().observe(input);
      if (!result.ok) throw result.error;
      expect(result.value.capture.truncated).toBe(false);
      expect(result.value.capture.truncation_reasons).toEqual([]);
      expect(result.value.capture.events_dropped).toBe(0);
      expect(result.value.scripts.items).toHaveLength(scriptUrls.length);
    } finally {
      await fake.close();
    }
  });
});

describe("bounded V8 Inspector capture", () => {
  test("bounds aggregate script and context metadata while retaining a useful partial capture", async () => {
    const fixture = await runtimeFixture();
    const url = pathToFileURL(fixture.entry).href;
    const scriptHashes = Array.from(
      { length: 2_300 },
      (_, index) => `${"h".repeat(4_096)}${String(index)}`,
    );
    const fake = await startFakeV8Inspector({
      targetUrl: url,
      scriptUrls: scriptHashes.map(() => url),
      scriptHashes,
      contextTransitionCount: 2_000,
    });
    try {
      const result = await new V8InspectorProvider().observe({
        ...observeInput(fake.endpoint, fake.targetId, "node"),
        observation_ms: 1_000,
      });
      if (!result.ok) throw result.error;
      expect(result.value.capture.truncated).toBe(true);
      expect(result.value.capture.truncation_reasons).toEqual([
        "retained_metadata_budget_exceeded",
      ]);
      expect(result.value.capture.events_dropped).toBeGreaterThan(0);
      expect(result.value.capture.metadata_bytes_retained).toBeLessThanOrEqual(
        8 * 1024 * 1024,
      );
      expect(result.value.capture.events_observed).toBeGreaterThan(
        result.value.capture.events_retained,
      );
      expect(result.value.execution_contexts).toHaveLength(1);
    } finally {
      await fake.close();
    }
  });

  test("rejects a CDP event larger than the configured transport payload budget", async () => {
    const fixture = await runtimeFixture();
    const fake = await startFakeV8Inspector({
      targetUrl: pathToFileURL(fixture.entry).href,
      oversizedEventBytes: 16 * 1024 * 1024,
    });
    try {
      const result = await new V8InspectorProvider().observe(
        observeInput(fake.endpoint, fake.targetId, "node"),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({
        _tag: "BrowserObservationError",
        reason: "payload_limit",
      });
      expect(result.error.userMessage).toContain("protocol budget");
    } finally {
      await fake.close();
    }
  });
});

describe("passive V8 Inspector evidence", () => {
  test("produces deterministic Evidence through the service without grants", async () => {
    const fixture = await runtimeFixture();
    const fake = await startFakeV8Inspector({
      targetUrl: pathToFileURL(fixture.entry).href,
    });
    try {
      const input = observeInput(fake.endpoint, fake.targetId, "node");
      const first = await observeJavaScriptRuntime(
        new V8InspectorProvider(),
        input,
      );
      const second = await observeJavaScriptRuntime(
        new V8InspectorProvider(),
        input,
      );
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      expect(second.value.evidence_id).toBe(first.value.evidence_id);

      const listed = await listJavaScriptRuntimeTargets(
        new V8InspectorProvider(),
        {
          inspector_endpoint: fake.endpoint,
        },
      );
      expect(listed.ok).toBe(true);
    } finally {
      await fake.close();
    }
  });

  test("reconciles V8 script presence with static Application Graph Evidence", () => {
    const root = "/Applications/Example.app/Contents/Resources/app";
    const observation = runtimeObservation(
      `${root}/index.html`,
      `${root}/renderer.js`,
    );
    const runtimeEvidence = createJavaScriptRuntimeObservationEvidence(
      "observe_javascript_runtime",
      {
        inspector_endpoint: "http://127.0.0.1:9229",
        target_id: "example-v8-target",
        runtime_kind: "electron-main",
        observation_ms: 100,
      },
      observation,
      V8_INSPECTOR_PROVIDER_IDENTITY,
    );
    const reconciled = reconcileJavaScriptRuntimeEvidence({
      static_layers: JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE.static_layers,
      runtime_observations: [runtimeEvidence],
    });
    if (!reconciled.ok) throw reconciled.error;
    const result = javascriptRuntimeReconciliationResultSchema.parse(
      reconciled.value.evidence.normalized_result,
    );
    expect(result.runtime_captures[0]?.kind).toBe("v8-inspector");
    expect(result.summary.runtime_scripts).toBe(1);
    expect(result.summary.matched).toBeGreaterThan(0);
  });

  test("keeps unverified partial script URLs unresolved during reconciliation", () => {
    const rawUrl = "file:///tmp/not-verified.js?caller-value=kept";
    const resolvedObservation = runtimeObservation(
      "/Applications/Example.app/Contents/Resources/app/index.html",
      "/Applications/Example.app/Contents/Resources/app/renderer.js",
    );
    const resolvedScript = resolvedObservation.scripts.items[0];
    if (resolvedScript === undefined)
      throw new Error("Expected the runtime fixture to have one script");
    const observation: JavaScriptRuntimeObservation = {
      ...resolvedObservation,
      scripts: {
        ...resolvedObservation.scripts,
        items: [
          ...resolvedObservation.scripts.items.map((script) => ({
            ...script,
            location: {
              kind: "unresolved" as const,
              reported_url: rawUrl,
              reason: "location-authorization-not-attempted" as const,
            },
          })),
          {
            ...resolvedScript,
            script_key: `v8_script_${"5".repeat(64)}`,
            location: {
              kind: "unresolved",
              reported_url: "",
              reason: "location-authorization-not-attempted",
            },
            cdp_hash: null,
            length: 0,
          },
        ],
      },
    };
    const runtimeEvidence = createJavaScriptRuntimeObservationEvidence(
      "observe_javascript_runtime",
      {
        inspector_endpoint: "http://127.0.0.1:9229",
        target_id: "example-v8-target",
        runtime_kind: "electron-main",
        observation_ms: 100,
      },
      observation,
      V8_INSPECTOR_PROVIDER_IDENTITY,
    );

    const reconciled = reconcileJavaScriptRuntimeEvidence({
      static_layers: JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE.static_layers,
      runtime_observations: [runtimeEvidence],
    });
    if (!reconciled.ok) throw reconciled.error;
    const result = javascriptRuntimeReconciliationResultSchema.parse(
      reconciled.value.evidence.normalized_result,
    );
    expect(result.summary.runtime_scripts).toBe(2);
    expect(result.reconciliations).toContainEqual(
      expect.objectContaining({
        entity_kind: "script",
        status: "unknown",
        reason: "runtime-location-unresolved",
      }),
    );
    const runtimeProperties = result.graph.nodes
      .filter(({ kind }) => kind === "runtime-script-instance")
      .flatMap(({ observations }) =>
        observations.map(({ properties }) => properties),
      );
    expect(runtimeProperties).toContainEqual(
      expect.objectContaining({ reported_url: rawUrl, cdp_hash: "v8-hash" }),
    );
    expect(runtimeProperties).toContainEqual(
      expect.objectContaining({ reported_url: "", cdp_hash: null }),
    );
  });
});

test("keeps Inspector parse failures separate and preserves file URL script identity through reconciliation", async () => {
  const fixture = await runtimeFixture();
  const firstUrl = `${pathToFileURL(fixture.entry).href}?instance=1#first`;
  const secondUrl = `${pathToFileURL(fixture.entry).href}?instance=2#second`;
  const fake = await startFakeV8Inspector({
    targetUrl: pathToFileURL(fixture.entry).href,
    scriptEvents: [
      ...[firstUrl, secondUrl].map((url, index) => ({
        method: "Debugger.scriptParsed",
        params: {
          scriptId: String(index + 1),
          url,
          executionContextId: 1,
          hash: "same-source-hash",
          length: 42,
          isModule: true,
        },
      })),
      {
        method: "Debugger.scriptFailedToParse",
        params: { scriptId: "failed", url: firstUrl },
      },
    ],
  });
  try {
    const observed = await new V8InspectorProvider().observe(
      observeInput(fake.endpoint, fake.targetId, "node"),
    );
    if (!observed.ok) throw observed.error;
    expect(observed.value.scripts.items).toHaveLength(2);
    expect(observed.value.scripts.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location: { kind: "file", file_path: fixture.entry },
          reported_url: firstUrl,
        }),
        expect.objectContaining({
          location: { kind: "file", file_path: fixture.entry },
          reported_url: secondUrl,
        }),
      ]),
    );
    expect(
      new Set(observed.value.scripts.items.map(({ script_key }) => script_key))
        .size,
    ).toBe(2);
    expect(observed.value.scripts).toMatchObject({
      parse_failed_total: 1,
      excluded: {
        unsupported_location: 0,
        invalid_protocol_value: 0,
      },
    });

    const evidence = createJavaScriptRuntimeObservationEvidence(
      "observe_javascript_runtime",
      {
        inspector_endpoint: fake.endpoint,
        target_id: fake.targetId,
        runtime_kind: "node",
        observation_ms: 100,
      },
      observed.value,
      V8_INSPECTOR_PROVIDER_IDENTITY,
    );
    const reconciled = reconcileJavaScriptRuntimeEvidence({
      static_layers: JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE.static_layers,
      runtime_observations: [evidence],
    });
    if (!reconciled.ok) throw reconciled.error;
    const result = javascriptRuntimeReconciliationResultSchema.parse(
      reconciled.value.evidence.normalized_result,
    );
    const runtimeScripts = result.graph.nodes.filter(
      (node) => node.kind === "runtime-script-instance",
    );
    const reportedUrls = runtimeScripts.flatMap((node) =>
      node.observations
        .map(({ properties }) => properties.reported_url)
        .filter((url): url is string => typeof url === "string"),
    );
    expect(reportedUrls).toEqual(expect.arrayContaining([firstUrl, secondUrl]));
    expect(new Set(reportedUrls).size).toBe(2);
    const scriptKeys = runtimeScripts.flatMap((node) =>
      node.identity.strategy === "runtime-instance"
        ? [node.identity.runtime_key]
        : [],
    );
    expect(new Set(scriptKeys).size).toBe(2);

    const parsedCapture = parseRuntimeCaptures([evidence])[0];
    if (parsedCapture?.kind !== "v8-inspector")
      throw new Error("Expected the Inspector Evidence to parse as V8 capture");
    expect(
      parsedCapture.inspection.completeness.unavailable_sections,
    ).not.toContain("scripts");

    const legacySnapshot = {
      ...observed.value,
      scripts: {
        ...observed.value.scripts,
      },
    };
    delete legacySnapshot.scripts.parse_failed_total;
    const parsedLegacySnapshot =
      javascriptRuntimeObservationSchema.parse(legacySnapshot);
    expect("parse_failed_total" in parsedLegacySnapshot.scripts).toBe(false);
  } finally {
    await fake.close();
  }
});

test("keeps malformed scriptFailedToParse protocol values in the invalid count", async () => {
  const fixture = await runtimeFixture();
  const fake = await startFakeV8Inspector({
    targetUrl: pathToFileURL(fixture.entry).href,
    scriptEvents: [
      {
        method: "Debugger.scriptFailedToParse",
        params: { url: pathToFileURL(fixture.entry).href },
      },
    ],
  });
  try {
    const observed = await new V8InspectorProvider().observe(
      observeInput(fake.endpoint, fake.targetId, "node"),
    );
    if (!observed.ok) throw observed.error;
    expect(observed.value.scripts.excluded).toMatchObject({
      invalid_protocol_value: 1,
    });
    expect(observed.value.scripts.parse_failed_total).toBe(0);
  } finally {
    await fake.close();
  }
});

const runtimeFixture = async () => {
  const root = await createTestTempDirectory("rea-v8-runtime-");
  const entry = join(root, "entry.js");
  await writeFile(entry, "export const value = 1;\n");
  return { root, entry };
};

const temporaryFile = async (name: string): Promise<string> => {
  const root = await createTestTempDirectory("rea-v8-outside-");
  const path = join(root, name);
  await writeFile(path, "export {};\n");
  return path;
};

const observeInput = (
  endpoint: string,
  targetId: string,
  runtimeKind: ObserveJavaScriptRuntimeInput["runtime_kind"],
): ObserveJavaScriptRuntimeInput => ({
  inspector_endpoint: endpoint,
  target_id: targetId,
  runtime_kind: runtimeKind,
  observation_ms: 10,
});

const runtimeObservation = (
  targetPath: string,
  scriptPath: string,
): JavaScriptRuntimeObservation => ({
  runtime: {
    product: "node.js/v24.4.1",
    protocol_version: "1.3",
    v8_version: "13.6",
  },
  target: {
    target_id: "example-v8-target",
    protocol_type: "node",
    attached: false,
    location: { kind: "file", file_path: targetPath },
    runtime_kind: "electron-main",
    runtime_kind_authority: "caller-declared-unverified",
  },
  capture: {
    observation_ms: 100,
    events_observed: 1,
    events_retained: 1,
    events_dropped: 0,
    metadata_bytes_retained: 100,
    truncated: false,
    truncation_reasons: [],
  },
  scripts: {
    items: [
      {
        script_key: `v8_script_${"4".repeat(64)}`,
        location: { kind: "file", file_path: scriptPath },
        execution_context_key: "1",
        cdp_hash: "v8-hash",
        length: 29,
        is_module: true,
        status: "observed-loaded",
      },
    ],
    observed_total: 1,
    excluded: {
      unsupported_location: 0,
      invalid_protocol_value: 0,
    },
  },
  execution_contexts: [],
  directly_observed: ["Debugger.scriptParsed established script presence."],
  unavailable_without_instrumentation: [
    "require/import caller-to-callee edges",
  ],
  unknowns: ["Capture is bounded."],
  limitations: ["Passive Inspector metadata only."],
});
