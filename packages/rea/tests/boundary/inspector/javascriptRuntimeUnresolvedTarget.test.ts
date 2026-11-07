import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "vitest";

import { analyzeJavaScriptApplication } from "../../support/javascriptApplicationScope.js";
import { createJavaScriptRuntimeObservationEvidence } from "../../../src/application/javascript/JavaScriptRuntimeObservationEvidence.js";
import { V8InspectorProvider } from "../../../src/inspector/V8InspectorProvider.js";
import {
  readRuntimeReconciliationInput,
  reconcileJavaScriptRuntime,
} from "../../../src/domain/javascript/javascriptRuntimeReconciliation.js";
import { reconcileJavaScriptRuntimeInputSchema } from "../../../src/domain/javascript/javascriptRuntimeReconciliationSchemas.js";
import { startFakeV8Inspector } from "../../fixtures/inspector/fakeV8Inspector.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const reconcileInput = (input: unknown) => {
  const result = readRuntimeReconciliationInput(
    reconcileJavaScriptRuntimeInputSchema.parse(input),
  );
  if (!result.ok) throw result.error;
  return reconcileJavaScriptRuntime(result.value);
};

test("keeps unresolved target identity unknown while matching verified loaded scripts", async () => {
  const root = await createTestTempDirectory("rea-unresolved-runtime-");
  const entry = join(root, "entry.js");
  const reportedUrl = "file://C:_tools_entry.js";
  const fake = await startFakeV8Inspector({
    targetUrl: reportedUrl,
    scriptUrls: [pathToFileURL(entry).href],
  });
  try {
    await writeFile(entry, "export const fixture = true;\n");
    const analysis = await analyzeJavaScriptApplication({ input_path: root });
    if (!analysis.ok) throw analysis.error;
    const provider = new V8InspectorProvider();
    const input = {
      inspector_endpoint: fake.endpoint,
      target_id: fake.targetId,
      observation_ms: 10,
    };
    const observed = await provider.observe(input);
    if (!observed.ok) throw observed.error;
    const evidence = createJavaScriptRuntimeObservationEvidence(
      "observe_javascript_runtime",
      input,
      observed.value,
      provider.identity(),
    );
    const result = reconcileInput({
      static_layers: [{ role: "application", analysis: analysis.value }],
      runtime_observations: [evidence],
    });
    expect(result.reconciliations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity_kind: "target",
          status: "unknown",
          basis: "none",
          confidence: "unknown",
          reason: "runtime-location-unresolved",
          candidate_static_count: 0,
        }),
        expect.objectContaining({
          entity_kind: "script",
          status: "matched",
          basis: "artifact-path",
        }),
      ]),
    );
    expect(result.runtime_captures[0]?.target_location).toEqual({
      kind: "unresolved",
      reported_url: reportedUrl,
      reason: "unverifiable-file-location",
    });
    const target = result.graph.nodes.find(({ kind }) => kind === "target");
    expect(target?.observations[0]?.properties).toMatchObject({
      reported_url: reportedUrl,
      location_kind: "unresolved",
    });
    expect(target?.observations[0]?.properties).not.toHaveProperty("location");
    expect(
      result.graph.edges.filter(
        ({ relation, source_node_id }) =>
          relation === "observed_as" && source_node_id === target?.node_id,
      ),
    ).toEqual([]);
  } finally {
    await fake.close();
    await rm(root, { recursive: true, force: true });
  }
});
