import { describe, expect, it } from "vitest";

import {
  scenarioCaptureEvidence,
  scenarioCaptureFixture,
  scenarioServeFixture,
} from "../../../tests/fixtures/browserScenarioCapture.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { inspectAnalysisView } from "../analysisView/AnalysisViewService.js";
import {
  planEnvironmentBundle,
  registryPackageSource,
} from "./environmentBundle.js";
import { replayEnvironmentTool } from "./environmentReplay.js";
import { loadEnvironmentSource } from "./environmentSource.js";
import { prepareServedState } from "./environmentState.js";

const fixture = scenarioServeFixture();

describe("environment manifests from capture_browser_scenario parents", () => {
  it("projects the scenario's transactions into tools, citing them by request order", () => {
    const manifest = fixture.manifest.normalized_result as {
      parent_operation: string;
      artifact: unknown;
      tools: {
        name: string;
        record_ordinals: number[];
        query_parameter_names: string[];
        body_shape: unknown;
      }[];
      limitations: string[];
    };
    expect(manifest.parent_operation).toBe("capture_browser_scenario");
    expect(manifest.artifact).toEqual({ path: "", sha256: null });
    const tool = (name: string) =>
      manifest.tools.find((entry) => entry.name === name);
    expect(tool("get_users_by_id")?.record_ordinals).toEqual([1, 2]);
    expect(tool("get_search")?.query_parameter_names).toEqual(["query"]);
    expect(tool("post_folders")?.body_shape).toEqual({
      type: "object",
      properties: { title: "string" },
    });
    // The redacted URL never becomes a template, so no tool is named from its marker.
    expect(
      manifest.tools.some((entry) => entry.name.includes("redacted")),
    ).toBe(false);
    expect(manifest.limitations).toContain(
      "Scenario records are the capture's network transactions in request order; each record ordinal is the transaction's zero-based position.",
    );
  });

  it("refuses a scenario capture that selected neither response bodies nor header values", async () => {
    const refused = await inspectAnalysisView({
      source: {
        kind: "inline",
        evidence: scenarioCaptureEvidence(
          scenarioCaptureFixture(undefined, {
            request_body: false,
            response_body: false,
            header_values: false,
          }),
        ),
      },
      view: { kind: "environment-manifest", template_rules: [] },
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(projectAnalysisError(refused.error)).toMatchObject({
      code: "unsupported_target",
    });
  });

  it("names the views a scenario capture supports when another is requested", async () => {
    const refused = await inspectAnalysisView({
      source: {
        kind: "inline",
        evidence: scenarioCaptureEvidence(scenarioCaptureFixture()),
      },
      view: { kind: "dart-aot", collection: "package_uris" },
    });
    if (refused.ok) throw new Error("Expected the unsupported view refusal");
    expect(projectAnalysisError(refused.error)).toMatchObject({
      code: "invalid_request",
    });
    expect(JSON.stringify(projectAnalysisError(refused.error))).toContain(
      "supports summary and browser-scenario views",
    );
  });

  it("serves and exports a scenario-built manifest from the same capture", () => {
    const source = loadEnvironmentSource(fixture.manifest, fixture.capture);
    if (!source.ok) throw source.error;
    expect(source.value.captureKind).toBe("browser-scenario");
    expect(source.value.captureSha256).toMatch(/^[0-9a-f]{64}$/u);
    const users = source.value.manifest.tools.find(
      (entry) => entry.name === "get_users_by_id",
    );
    if (users === undefined) throw new Error("Manifest lacks get_users_by_id");
    const replayed = replayEnvironmentTool(source.value, users, { id: "3" });
    if (!replayed.ok) throw replayed.error;
    expect(replayed.value).toMatchObject({
      status: 200,
      body: { id: 3, login: "viewer" },
      replay: { record_ordinal: 2, exact_match: true, body_encoding: "utf-8" },
    });
    const blobs = source.value.manifest.tools.find(
      (entry) => entry.name === "get_blobs_by_id",
    );
    if (blobs === undefined) throw new Error("Manifest lacks get_blobs_by_id");
    const binary = replayEnvironmentTool(source.value, blobs, { id: "1" });
    if (!binary.ok) throw binary.error;
    expect(binary.value).toMatchObject({
      body: Buffer.from([0xff, 0xfe, 0x00, 0x41]).toString("base64"),
      replay: { body_encoding: "base64" },
    });
    const planned = planEnvironmentBundle(source.value, {
      packageSource: registryPackageSource(),
      served: (name) =>
        prepareServedState(source.value, fixture.capture, { name }),
    });
    if (!planned.ok) throw planned.error;
    const readme =
      planned.value.files.find((entry) => entry.path === "README.md")
        ?.content ?? "";
    expect(readme).toContain(
      "exported by REA from one retained browser scenario capture",
    );
    expect(readme).toContain(
      `Scenario definition SHA-256: \`${source.value.captureSha256 ?? ""}\``,
    );
  });
});
