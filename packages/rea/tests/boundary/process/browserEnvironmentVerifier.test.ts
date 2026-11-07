import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect, it } from "vitest";

const execute = promisify(execFile);

it("requires actual cancellation and confirmed cleanup before the environment verifier passes", async () => {
  // Execute the verifier's actual oracle with controlled provider outcomes.
  // The real-browser lane separately proves emulation and restoration in Chrome.
  const { stdout } = await execute(process.execPath, [
    "--input-type=module",
    "-e",
    String.raw`
      const { verifyCancelledEnvironment } = await import(process.argv[1]);
      const { AnalysisCancelledError, AnalysisProtocolError } = await import(
        new URL("../../dist/domain/analysisErrorCore.js", process.argv[1])
      );
      const outcomes = [];
      for (const kind of ["cancelled", "protocol-error", "cleanup-failed", "completed", "cancelled-step", "incomplete-step"]) {
        let snapshots = 0;
        let aborted = false;
        const connection = {
          send: async () => ({ result: {
            type: "string",
            value: JSON.stringify({
              timeOrigin: ++snapshots,
              environment: { timezone: "Pacific/Honolulu", locale: "fr-FR", dpr: 2, width: 900, height: 600 },
            }),
          } }),
        };
        const error = kind === "protocol-error"
          ? new AnalysisProtocolError("controlled protocol failure")
          : new AnalysisCancelledError("capture_browser_scenario", kind === "cleanup-failed"
            ? { cleanup: { reason: "controlled cleanup failure", resources: ["browser_transport"] } }
            : undefined);
        const result = ["completed", "cancelled-step", "incomplete-step"].includes(kind)
          ? { ok: true, value: {
              steps: [{ status: kind === "completed" ? "completed" : "cancelled" }],
              browser: { cleanup: kind === "incomplete-step" ? "incomplete" : "disconnected-external" },
            } }
          : { ok: false, error };
        const provider = {
          captureScenario: (_scenario, { signal }) => new Promise((resolve) => {
            signal.addEventListener("abort", () => { aborted = true; resolve(result); }, { once: true });
          }),
        };
        let accepted = false;
        try {
          await verifyCancelledEnvironment(provider, connection, { actions: [{}] });
          accepted = true;
        } catch {}
        outcomes.push({ kind, accepted, aborted, snapshots });
      }
      console.log(JSON.stringify(outcomes));
    `,
    new URL(
      "../../../scripts/lib/browser-scenario-environment-e2e.mjs",
      import.meta.url,
    ).href,
  ]);
  expect(JSON.parse(stdout)).toEqual(
    [
      ["cancelled", true],
      ["protocol-error", false],
      ["cleanup-failed", false],
      ["completed", false],
      ["cancelled-step", true],
      ["incomplete-step", false],
    ].map(([kind, accepted]) => ({
      kind,
      accepted,
      aborted: true,
      snapshots: 2,
    })),
  );
});
