import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";

cliTest(
  "preserves renderer endpoint certainty through CLI graph delivery",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-renderer-endpoints-");
    await writeFixtureFiles(root, {
      "main.cjs": `
      const { BrowserWindow } = require("electron");
      const replaced = new BrowserWindow();
      replaced.loadURL = () => {};
      replaced.loadURL("https://replaced.test");
      const local = { loadURL(value) { return value; } };
      local.loadURL("https://local.test");
      const intact = new BrowserWindow();
      intact.loadURL("https://intact.test");
      new BrowserWindow().loadURL(runtimeUrl);
      new BrowserWindow().loadFile("page.html");
    `,
      "page.html": "<p>Local renderer</p>",
    });
    const result = await analyzeJavaScriptDirectory("CLI", cli, root);
    const endpoints = result.graph.nodes.filter(
      ({ kind }) => kind === "endpoint",
    );
    expect(endpoints).toHaveLength(4);
    for (const value of ["https://replaced.test", "https://local.test"]) {
      const endpoint = endpoints.find(({ observations }) =>
        observations.some(({ properties }) => properties.value === value),
      );
      expect(endpoint?.observations[0]).toMatchObject({
        properties: { value, interpretation: "candidate" },
        evidence: { state: "inferred", confidence: "low" },
      });
      expect(endpoint?.observations[0]?.evidence.limitations).toEqual(
        expect.arrayContaining([
          expect.stringContaining("receiver does not establish a network call"),
        ]),
      );
      expect(
        result.graph.edges.find(
          ({ target_node_id }) => target_node_id === endpoint?.node_id,
        ),
      ).toMatchObject({
        relation: "calls",
        properties: { interpretation: "candidate" },
        evidence: { state: "inferred", confidence: "low" },
      });
    }
    const intact = endpoints.find(({ observations }) =>
      observations.some(
        ({ properties }) => properties.value === "https://intact.test",
      ),
    );
    expect(intact?.observations[0]).toMatchObject({
      properties: { value: "https://intact.test" },
      evidence: { state: "observed", confidence: "exact" },
    });
    expect(intact?.observations[0]?.properties).not.toHaveProperty(
      "interpretation",
    );
    const dynamic = endpoints.find(({ observations }) =>
      observations.some(({ properties }) => properties.value === "runtimeUrl"),
    );
    expect(dynamic?.observations[0]).toMatchObject({
      properties: { value: "runtimeUrl", resolution: "partial" },
      evidence: { state: "observed" },
    });
  },
);

cliTest(
  "qualifies local browser request spellings through CLI Evidence",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-network-spellings-");
    await writeFixtureFiles(root, {
      "index.js": `
    const local = { fetch(x) { return x; }, sendBeacon(x) { return x; }, EventSource(x) { return x; } };
    local.fetch('/local-fetch'); local.sendBeacon('/local-beacon'); local.EventSource('/local-events');
    const other = { open(a,b) { return b; }, post(x) { return x; }, put(x) { return x; }, patch(x) { return x; }, request(x) { return x; } };
    other.open('GET', '/local-open'); other.post('/local-post'); other.put('/local-put'); other.patch('/local-patch'); other.request('/local-request');
    fetch('/intrinsic-fetch'); navigator.sendBeacon('/intrinsic-beacon'); new EventSource('/intrinsic-events');
  `,
    });
    const result = await analyzeJavaScriptDirectory("CLI", cli, root);
    const endpoints = result.graph.nodes.filter(
      ({ kind }) => kind === "endpoint",
    );
    expect(endpoints).toHaveLength(11);
    for (const endpoint of endpoints) {
      const observation = endpoint.observations[0]!;
      const local = String(observation.properties.value).startsWith("/local-");
      expect(observation.evidence).toMatchObject(
        local
          ? { state: "inferred", confidence: "low" }
          : { state: "observed", confidence: "exact" },
      );
      expect(observation.properties.interpretation).toBe(
        local ? "candidate" : undefined,
      );
      if (local)
        expect(
          result.graph.edges.find(
            ({ target_node_id }) => target_node_id === endpoint.node_id,
          )?.evidence,
        ).toMatchObject({ state: "inferred", confidence: "low" });
    }
  },
);

cliTest(
  "preserves binding-backed XHR identity and qualifies replaced open methods",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-xhr-identity-");
    await writeFixtureFiles(root, {
      "index.js": `
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/intact-xhr');
    const replaced = new XMLHttpRequest();
    replaced.open = (method, value) => value;
    replaced.open('GET', '/replaced-xhr');
    { const XMLHttpRequest = class {}; const local = new XMLHttpRequest(); local.open('GET', '/local-xhr'); }
  `,
    });
    const result = await analyzeJavaScriptDirectory("CLI", cli, root);
    const endpoints = result.graph.nodes.filter(
      ({ kind }) => kind === "endpoint",
    );
    expect(endpoints).toHaveLength(3);
    for (const endpoint of endpoints) {
      const observation = endpoint.observations[0]!;
      expect(observation.evidence).toMatchObject(
        observation.properties.value === "/intact-xhr"
          ? { state: "observed", confidence: "exact" }
          : { state: "inferred", confidence: "low" },
      );
    }
  },
);
