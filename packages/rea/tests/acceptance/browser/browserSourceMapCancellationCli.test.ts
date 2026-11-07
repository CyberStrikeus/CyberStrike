import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { expect } from "vitest";

import { analysisErrorProjectionSchema } from "../../../src/contracts/errorSchemas.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { webBundleAcquisitionPartialObservationSchema } from "../../../src/domain/webBundleAnalysis.js";
import { startSourceMapCancellationBrowser } from "../../fixtures/browserSourceMapCancellation.js";
import { processTest } from "../../support/process/processFixture.js";

// The fake CDP endpoint and HTTP responses exercise the compiled public CLI.
// No Chromium process or real external source-map server is involved.
processTest.skipIf(process.platform === "win32")(
  "retains a completed source map and capture exclusions when the next fetch is cancelled",
  async ({ processes }) => {
    const { browser, mapText, completedMapPath, secondRequest, close } =
      await startSourceMapCancellationBrowser();
    const child = processes.spawn(
      process.execPath,
      [
        resolve("scripts/rea.mjs"),
        "analyze-web-bundle",
        browser.endpoint,
        "allowed-page",
        "--allowed-origins",
        browser.allowedOrigin,
        "--observation-ms",
        "0",
        "--fetch-source-maps",
        "--json",
      ],
      { env: { PATH: process.env.PATH ?? "" } },
    );
    child.stdin.end();
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const exited = new Promise<{
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    }>((resolveExit, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolveExit({ code, signal }));
    });
    const deadline = setTimeout(() => child.kill("SIGKILL"), 20_000);
    try {
      const pendingMapPath = await Promise.race([
        secondRequest,
        exited.then(({ code, signal }) => {
          throw new Error(
            `CLI exited before second map request (${String(code)}, ${String(signal)}): ${stderr}`,
          );
        }),
      ]);
      const retainedMapPath = await completedMapPath;
      expect([retainedMapPath, pendingMapPath].sort()).toEqual([
        "/first.js.map",
        "/second.js.map",
      ]);
      expect(child.kill("SIGINT")).toBe(true);
      expect(await exited, stderr).toEqual({ code: 130, signal: null });
      const failure = analysisErrorProjectionSchema.parse(JSON.parse(stdout));
      expect(failure.code).toBe("cancelled");
      const partial = parseEvidence(failure.details?.partial_observation);
      expect(partial.operation).toBe("analyze_web_bundle");
      const acquisition = webBundleAcquisitionPartialObservationSchema.parse(
        partial.normalized_result,
      );
      expect(acquisition.analysis_status).toBe("not_performed");
      expect(
        acquisition.source_maps,
        JSON.stringify(acquisition.source_maps),
      ).toMatchObject({
        status: "partial",
        requested: 2,
        processed: 1,
        excluded: [
          { section: "source_maps", reason: "disallowed_origin", count: 1 },
        ],
        items: [
          {
            status: "included",
            declared_url: `${browser.allowedOrigin}${retainedMapPath}`,
            artifact: {
              text: mapText,
              sha256: createHash("sha256").update(mapText).digest("hex"),
            },
          },
        ],
      });
      expect(acquisition.source_maps.items).toHaveLength(1);
      expect(acquisition.inspection.completeness.excluded).toContainEqual({
        section: "source_maps",
        reason: "disallowed_origin",
        count: 1,
      });
      expect(JSON.stringify(partial)).not.toContain("outside.example.test");
      expect(browser.activeConnectionCount()).toBe(0);
      expect(
        browser.httpRequests
          .filter(({ url }) => url.endsWith(".map"))
          .map(({ url }) => url),
      ).toEqual([retainedMapPath, pendingMapPath]);
    } finally {
      clearTimeout(deadline);
      child.kill("SIGTERM");
      await close();
    }
  },
);
