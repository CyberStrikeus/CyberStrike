import { describe, expect, it } from "vitest";

import { scenarioCaptureFixture } from "../../tests/fixtures/browserScenarioCapture.js";
import { browserScenarioSchema } from "../domain/browserScenario.js";
import { digestCanonicalValue } from "../domain/canonicalDigest.js";
import { createBrowserScenarioEvidence } from "./BrowserScenarioEvidence.js";

const ORIGIN = "http://127.0.0.1:3101";

const parameters = (actions: readonly unknown[]) =>
  createBrowserScenarioEvidence(
    browserScenarioSchema.parse({
      browser: { mode: "launch", executable_path: "/opt/chromium/chrome" },
      start_url: { url: `${ORIGIN}/` },
      actions,
    }),
    scenarioCaptureFixture(),
    { id: "fixture", name: "fixture", version: "1" },
  ).parameters;

const open = (fields: Record<string, unknown> = {}) => ({
  step_id: "open",
  action: "goto",
  destination: { url: `${ORIGIN}/items` },
  wait_until: "load",
  ...fields,
});

const create = (fields: Record<string, unknown> = {}) => ({
  step_id: "create",
  action: "request",
  method: "POST",
  path: "/api/items",
  json: { title: "Item 1" },
  ...fields,
});

describe("browser scenario evidence parameters", () => {
  it("records a scenario that saves nothing as it was recorded before saved values existed", () => {
    const recorded = parameters([open(), create()]);
    const actions = recorded["actions"] as Record<string, unknown>[];
    expect(Object.keys(actions[1]!)).not.toContain("save");
    expect(parameters([open(), create({ save: [] })])).toEqual(recorded);
    const { scenario_sha256, ...scenario } = recorded;
    expect(scenario_sha256).toBe(
      digestCanonicalValue(scenario, "Browser scenario"),
    );
  });

  it("records the values a step saves and the placeholders that send them", () => {
    const recorded = parameters([
      create({ save: [{ name: "item", json_pointer: "/id" }] }),
      open({ destination: { url: `${ORIGIN}/items/{saved:item}` } }),
    ]);
    expect(recorded["actions"]).toMatchObject([
      { save: [{ name: "item", json_pointer: "/id", secret: false }] },
      { destination: { url: `${ORIGIN}/items/%7Bsaved:item%7D` } },
    ]);
    expect(recorded["scenario_sha256"]).not.toBe(
      parameters([create(), open()])["scenario_sha256"],
    );
  });
});
