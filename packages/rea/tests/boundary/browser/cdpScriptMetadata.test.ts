import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createJavaScriptRuntimeObservationEvidence } from "../../../src/application/javascript/JavaScriptRuntimeObservationEvidence.js";
import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { CdpElectronProvider } from "../../../src/browser/CdpElectronProvider.js";
import { publishWebScripts } from "../../../src/browser/assets/PublishWebScripts.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { selectScriptCapture } from "../../../src/browser/assets/ScriptCaptureAdapters.js";
import { inspectWebPageInputSchema } from "../../../src/domain/browserObservation.js";
import { inspectElectronPageInputSchema } from "../../../src/domain/javascript/electronObservation.js";
import { parseRuntimeCaptures } from "../../../src/domain/javascript/javascriptRuntimeReconciliationCaptureParsing.js";
import { projectRuntimeCaptures } from "../../../src/domain/javascript/javascriptRuntimeReconciliationRuntime.js";
import { V8InspectorProvider } from "../../../src/inspector/V8InspectorProvider.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { startFakeV8Inspector } from "../../fixtures/inspector/fakeV8Inspector.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const metadataCases = [
  {
    name: "omitted metadata remains unknown",
    reported: {},
    expected: { cdp_hash: null, length: null, is_module: null },
  },
  {
    name: "explicit empty hash, zero length, and non-module are preserved",
    reported: { hash: "", length: 0, isModule: false },
    expected: { cdp_hash: "", length: 0, is_module: false },
  },
  {
    name: "known module metadata is preserved",
    reported: { hash: "reported-hash", length: 123, isModule: true },
    expected: { cdp_hash: "reported-hash", length: 123, is_module: true },
  },
  {
    name: "malformed metadata is unknown instead of repaired",
    reported: { hash: 42, length: -1, isModule: "false" },
    expected: { cdp_hash: null, length: null, is_module: null },
  },
  {
    name: "invalid length preserves adjacent valid facts",
    reported: { hash: "reported-hash", length: 1.5, isModule: true },
    expected: { cdp_hash: "reported-hash", length: null, is_module: true },
  },
];

const resources: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of resources.splice(0).reverse()) await close();
});

const fixtureRoot = async (): Promise<string> => {
  const root = await createTestTempDirectory("rea-cdp-script-metadata-");
  resources.push(() => rm(root, { force: true, recursive: true }));
  await Promise.all([
    writeFile(join(root, "index.html"), "<html></html>"),
    writeFile(join(root, "app.js"), "export const observed = true;"),
  ]);
  return root;
};

describe.each(["browser", "electron"] as const)(
  "%s script metadata",
  (kind) => {
    it.each(metadataCases)(
      "$name through capture and consumers",
      async ({ reported, expected }) => {
        const root = await fixtureRoot();
        const artifactResources = new ArtifactResourceScope();
        resources.push(() => artifactResources.close());
        const browser = await startFakeCdpBrowser({
          ...(kind === "electron"
            ? { electronFileUrl: pathToFileURL(join(root, "index.html")).href }
            : {}),
          commandEvents: ({ method }, origin) =>
            method === "Debugger.enable"
              ? [
                  {
                    method: "Debugger.scriptParsed",
                    sessionId: "session-1",
                    params: {
                      scriptId: "captured-script",
                      url:
                        kind === "browser"
                          ? `${origin}/app.js`
                          : pathToFileURL(join(root, "app.js")).href,
                      executionContextId: 1,
                      scriptLanguage: "JavaScript",
                      ...reported,
                    },
                  },
                ]
              : undefined,
        });
        resources.push(() => browser.close());
        if (kind === "electron") {
          const result = await new CdpElectronProvider().inspectPage(
            inspectElectronPageInputSchema.parse({
              cdp_endpoint: browser.endpoint,
              target_id: "electron-page",
              observation_ms: 0,
              include_script_sources: true,
            }),
          );
          if (!result.ok) throw result.error;
          expect(result.value.scripts.items).toHaveLength(1);
          expect(result.value.scripts.items[0]).toMatchObject(expected);
          return;
        }
        const result = await new CdpBrowserProvider().inspectPage(
          inspectWebPageInputSchema.parse({
            cdp_endpoint: browser.endpoint,
            target_id: "allowed-page",
            observation_ms: 0,
            include_script_sources: true,
          }),
        );
        if (!result.ok) throw result.error;
        expect(result.value.scripts.items).toHaveLength(1);
        expect(result.value.scripts.items[0]).toMatchObject(expected);
        const capturePath = join(root, "capture.json");
        const captureBytes = JSON.stringify(result.value);
        await writeFile(capturePath, captureBytes);
        const exported = await publishWebScripts(
          {
            capture_path: capturePath,
            output_directory: join(root, "exported"),
          },
          selectScriptCapture(result.value),
          createHash("sha256").update(captureBytes).digest("hex"),
          { resources: artifactResources },
        );
        expect(exported.scripts[0]?.source).toMatchObject({
          is_module: expected.is_module,
        });
        expect(exported.scripts[0]?.content.state).toBe("exported");
        const manifest: unknown = JSON.parse(
          await readFile(exported.manifest.path, "utf8"),
        );
        expect(manifest).toMatchObject({
          scripts: [{ source: { is_module: expected.is_module } }],
        });
      },
    );
  },
);

describe("Inspector script metadata", () => {
  it.each(metadataCases)(
    "$name through reconciliation",
    async ({ reported, expected }) => {
      const root = await fixtureRoot();
      const scriptUrl = pathToFileURL(join(root, "app.js")).href;
      const inspector = await startFakeV8Inspector({
        targetUrl: scriptUrl,
        scriptEvents: [
          {
            method: "Debugger.scriptParsed",
            params: {
              scriptId: "captured-script",
              url: scriptUrl,
              executionContextId: 1,
              ...reported,
            },
          },
        ],
      });
      resources.push(() => inspector.close());
      const input = {
        inspector_endpoint: inspector.endpoint,
        target_id: inspector.targetId,
        observation_ms: 50,
      };
      const provider = new V8InspectorProvider();
      const result = await provider.observe(input);
      if (!result.ok) throw result.error;
      expect(result.value.scripts.items).toHaveLength(1);
      expect(result.value.scripts.items[0]).toMatchObject(expected);
      const evidence = createJavaScriptRuntimeObservationEvidence(
        "observe_javascript_runtime",
        input,
        result.value,
        provider.identity(),
      );
      const projected = projectRuntimeCaptures(
        parseRuntimeCaptures([evidence]),
      );
      const scriptNode = projected.nodes.find(
        ({ kind }) => kind === "runtime-script-instance",
      );
      expect(scriptNode?.observations[0]?.properties).toMatchObject(expected);
    },
  );
});

describe("Inspector script exclusions", () => {
  const reconcileV8Scripts = async (
    scriptEvents: readonly { method: string; params: object }[],
  ) => {
    const root = await fixtureRoot();
    const inspector = await startFakeV8Inspector({
      targetUrl: pathToFileURL(join(root, "app.js")).href,
      scriptEvents,
    });
    resources.push(() => inspector.close());
    const input = {
      inspector_endpoint: inspector.endpoint,
      target_id: inspector.targetId,
      observation_ms: 50,
    };
    const provider = new V8InspectorProvider();
    const result = await provider.observe(input);
    if (!result.ok) throw result.error;
    const [parsed] = parseRuntimeCaptures([
      createJavaScriptRuntimeObservationEvidence(
        "observe_javascript_runtime",
        input,
        result.value,
        provider.identity(),
      ),
    ]);
    return {
      producer: result.value.scripts.excluded,
      completeness: parsed?.inspection.completeness,
    };
  };
  const invalidFailedToParse = {
    method: "Debugger.scriptFailedToParse",
    params: { scriptId: 42, url: "", executionContextId: 1 },
  };
  const missingUrl = {
    method: "Debugger.scriptParsed",
    params: { scriptId: "missing-url", executionContextId: 1 },
  };

  it("keeps invalid protocol scripts out of policy filtering", async () => {
    const { producer, completeness } = await reconcileV8Scripts([
      invalidFailedToParse,
      missingUrl,
    ]);
    expect(producer).toEqual({
      unsupported_location: 0,
      invalid_protocol_value: 2,
    });
    expect(completeness).toMatchObject({
      status: "attach_limited",
      conditions: ["attach_limited"],
      policy_filtered_sections: [],
      excluded: [
        { section: "scripts", reason: "invalid_protocol_value", count: 2 },
      ],
    });
    expect(completeness?.unavailable_sections).toContain("scripts");
  });

  it("reports unsupported and invalid script exclusions separately", async () => {
    const { producer, completeness } = await reconcileV8Scripts([
      invalidFailedToParse,
      {
        method: "Debugger.scriptParsed",
        params: {
          scriptId: "data-script",
          url: "data:text/javascript,0",
          executionContextId: 1,
        },
      },
    ]);
    expect(producer).toEqual({
      unsupported_location: 1,
      invalid_protocol_value: 1,
    });
    expect(completeness).toMatchObject({
      status: "policy_filtered",
      conditions: ["attach_limited", "policy_filtered"],
      policy_filtered_sections: ["scripts"],
      excluded: [
        { section: "scripts", reason: "invalid_protocol_value", count: 1 },
        { section: "scripts", reason: "out_of_target_scope", count: 1 },
      ],
    });
    expect(completeness?.unavailable_sections).toContain("scripts");
  });
});
