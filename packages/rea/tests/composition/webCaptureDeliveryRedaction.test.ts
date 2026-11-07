import { createHash } from "node:crypto";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { WebNetworkCaptureService } from "../../src/application/WebNetworkCaptureService.js";
import { decodeHarCapture } from "../../src/browser/history/HarCapture.js";
import { deliverCliAnalysisEvidence } from "../../src/cli/analysisEvidenceDelivery.js";
import { analysisErrorProjectionSchema } from "../../src/contracts/errorSchemas.js";
import { ok } from "../../src/domain/result.js";
import { historicalHar } from "../fixtures/historicalHar.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

it("excludes marked output identity from late CLI publication failure while retaining capture Evidence", async () => {
  const root = await createTestTempDirectory("rea-capture-delivery-");
  const outputPath = join(root, "private-publication-marker.json");
  await writeFile(outputPath, "existing caller file");
  const bytes = JSON.stringify(historicalHar());
  const values = ["private-publication-marker"];
  const input = {
    capture_path: join(root, "capture.har"),
    format: "har" as const,
    sensitive_values: values,
  };
  const service = new WebNetworkCaptureService({
    inspect: async () =>
      ok({
        ...decodeHarCapture(bytes, values),
        artifact: {
          path: input.capture_path,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          bytes: Buffer.byteLength(bytes),
        },
        format: "har" as const,
        runtime_attribution: "unknown" as const,
        limitations: [],
      }),
  });
  const output = analysisErrorProjectionSchema.parse(
    await deliverCliAnalysisEvidence({
      run: () => service.inspect(input),
      service,
      providerId: "web-network-capture",
      operation: "inspect_web_network_capture",
      signal: new AbortController().signal,
      detail: "complete",
      evidenceOutput: outputPath,
      sensitiveValues: values,
    }),
  );
  expect(output.code).toBe("invalid_request");
  expect(output.details).toHaveProperty(
    "partial_observation.normalized_result.artifact.path",
    input.capture_path,
  );
  expect(JSON.stringify(output)).not.toContain(values[0]);
  expect(await readFile(outputPath, "utf8")).toBe("existing caller file");
});

it.each([true, false])(
  "publishes summary bytes while excluding only a marked receipt identity: %s",
  async (marked) => {
    const root = await createTestTempDirectory("rea-capture-publication-");
    const outputPath = join(root, "private-publication-marker.json");
    const values = marked ? ["private-publication-marker"] : [];
    const bytes = JSON.stringify(historicalHar());
    const input = {
      capture_path: join(root, "capture.har"),
      format: "har" as const,
      sensitive_values: values,
    };
    const service = new WebNetworkCaptureService({
      inspect: async () =>
        ok({
          ...decodeHarCapture(bytes, values),
          artifact: {
            path: input.capture_path,
            sha256: createHash("sha256").update(bytes).digest("hex"),
            bytes: Buffer.byteLength(bytes),
          },
          format: "har" as const,
          runtime_attribution: "unknown" as const,
          limitations: [],
        }),
    });
    const output = await deliverCliAnalysisEvidence({
      run: () => service.inspect(input),
      service,
      providerId: "web-network-capture",
      operation: "inspect_web_network_capture",
      signal: new AbortController().signal,
      detail: "summary",
      evidenceOutput: outputPath,
      sensitiveValues: values,
    });
    const persisted = await readFile(outputPath);
    expect(output).toMatchObject({
      evidence_bundle: { bytes: persisted.length },
    });
    if (marked) {
      expect(output).not.toHaveProperty("evidence_bundle.path");
      expect(JSON.stringify(output)).not.toContain(values[0]);
    } else expect(output).toHaveProperty("evidence_bundle.path", outputPath);
    expect(JSON.parse(persisted.toString())).toHaveProperty(
      "records.0.operation",
      "inspect_web_network_capture",
    );
  },
);
