import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import {
  parseProcessCapture,
  safeParseProcessCapture,
} from "../../../src/domain/process/processCaptureParsing.js";
import { ProcessCaptureError } from "../../../src/process/capture/ProcessCaptureError.js";
import { captureProcessScenario } from "../../../src/process/capture/ProcessHarness.js";
import { compareProcessCaptures } from "../../../src/domain/process/processComparison.js";
import {
  digestProcessCommitment,
  processScenarioSchema,
} from "../../../src/domain/process/processScenario.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { itWithCaptureCapability } from "./processCaptureCapability.js";

const literal = "SYNTHETIC_PROCESS_INPUT_83A4";

for (const sensitive of [true, false]) {
  itWithCaptureCapability(
    `${sensitive ? "redacts" : "preserves unmarked"} echoed input across retained terminal representations`,
    async () => {
      const root = await createTestTempDirectory("rea-sensitive-process-");
      const result = await captureProcessScenario(
        processScenarioSchema.parse({
          executable: process.execPath,
          arguments: [
            fileURLToPath(
              new URL(
                "../../fixtures/processSensitiveEcho.mjs",
                import.meta.url,
              ),
            ),
          ],
          working_directory: root,
          terminal: { columns: 120, rows: 8, scrollback: 20 },
          events: [
            { type: "input", at_ms: 350, data: `${literal}\r`, sensitive },
          ],
          timeout_ms: 3000,
          idle_timeout_ms: 3000,
          limits: { output_bytes: 16384, processes: 16 },
          normalization: {
            pids: false,
            ports: false,
            patterns: [{ pattern: "echo:", replacement: "view:" }],
          },
        }),
      );
      if (!result.ok) throw result.error;
      const capture = parseProcessCapture(
        JSON.parse(JSON.stringify(result.value)),
      );
      if (sensitive) {
        const contract = { ...capture.manifest.comparison_contract };
        delete contract["sensitive_input_redaction_version"];
        const legacyPolicy = parseProcessCapture({
          ...capture,
          manifest: {
            ...capture.manifest,
            comparison_contract: contract,
            comparison_contract_sha256: digestProcessCommitment(contract),
          },
        });
        expect(() => compareProcessCaptures(capture, legacyPolicy)).toThrow(
          expect.objectContaining({
            issues: [
              expect.objectContaining({
                expected: ["sensitive_input_redaction_version"],
              }),
            ],
          }),
        );
        expect(compareProcessCaptures(capture, capture)).toMatchObject({
          terminal: "unknown",
          interaction: "unknown",
        });
        const corrupted = structuredClone(capture);
        const redacted =
          corrupted.truncation_details.raw_terminal.redacted_bytes ?? 0;
        const rejected = safeParseProcessCapture({
          ...corrupted,
          truncation_details: {
            ...corrupted.truncation_details,
            raw_terminal: {
              ...corrupted.truncation_details.raw_terminal,
              redacted_bytes: redacted + 1,
            },
          },
        });
        if (rejected.success)
          throw new Error(
            "Expected inconsistent redacted byte accounting to be rejected",
          );
        expect(rejected.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "custom",
              path: ["truncation_details", "raw_terminal"],
            }),
          ]),
        );
      }
      const views = {
        normalized: capture.frames.map(({ data }) => data).join(""),
        original: capture.frames
          .map(({ raw_data, data }) => raw_data ?? data)
          .join(""),
        rendered: capture.rendered_frames
          .flatMap(({ lines }) => lines)
          .join("\n"),
        serialized: capture.rendered_frames
          .map(({ serialized_state }) => serialized_state)
          .join("\n"),
      };
      expect(capture.interaction_events[0]).toMatchObject({
        outcome: "dispatched",
        type: "input",
      });
      expect(capture.rendered_frames.length).toBeGreaterThan(0);
      expect(
        capture.frames.some(({ raw_data }) => raw_data !== undefined),
      ).toBe(true);
      expect(views.normalized).toContain("PUBLIC_TAIL");
      expect(capture.cleanup).toMatchObject({
        owned_process_group: "verified",
        temporary_root: "removed",
      });
      const disclosures = Object.entries(views)
        .filter(([, value]) => value.includes(literal))
        .map(([name]) => name);
      expect(disclosures).toEqual(sensitive ? [] : Object.keys(views));
      if (sensitive) {
        const prefix = literal.slice(0, Math.floor(literal.length / 2));
        expect(
          Object.entries(views)
            .filter(([, value]) => value.includes(prefix))
            .map(([name]) => name),
        ).toEqual([]);
        expect(capture.interaction_events[0]).toMatchObject({
          data: "",
          sensitive: true,
          input_bytes: Buffer.byteLength(`${literal}\r`),
        });
        expect(
          capture.truncation_details.raw_terminal.redacted_bytes,
        ).toBeGreaterThan(0);
      }
    },
    20_000,
  );
}

itWithCaptureCapability(
  "retains safe terminal facts after cancellation during a private echo",
  async () => {
    const root = await createTestTempDirectory("rea-private-cancel-");
    const controller = new AbortController();
    const result = await captureProcessScenario(
      processScenarioSchema.parse({
        executable: process.execPath,
        arguments: [
          fileURLToPath(
            new URL("../../fixtures/processSensitiveEcho.mjs", import.meta.url),
          ),
          "--linger",
        ],
        working_directory: root,
        terminal: { columns: 120, rows: 8, scrollback: 20 },
        events: [
          { type: "input", at_ms: 350, data: `${literal}\r`, sensitive: true },
        ],
        timeout_ms: 3000,
        idle_timeout_ms: 3000,
        limits: { output_bytes: 16384, processes: 16 },
      }),
      controller.signal,
      process.platform,
      process.env,
      undefined,
      undefined,
      {
        async report(update) {
          if (
            update.phase === "running" &&
            /interactions=1(?: |$)/u.test(update.message) &&
            /frames=(?:[2-9]|[1-9]\d+)(?: |$)/u.test(update.message)
          )
            controller.abort();
        },
      },
    );
    expect(controller.signal.aborted).toBe(true);
    if (result.ok) throw new Error("Expected cancelled private capture");
    if (!(result.error instanceof ProcessCaptureError)) throw result.error;
    const partial = result.error.partialObservation;
    expect(partial).toBeDefined();
    expect(JSON.stringify(partial)).not.toContain(literal);
    expect(JSON.stringify(partial)).not.toContain(
      literal.slice(0, Math.floor(literal.length / 2)),
    );
    expect(partial).toMatchObject({
      observations: {
        frames: { state: "available" },
        rendered_frames: { state: "available" },
        interaction_events: {
          state: "available",
          value: [{ outcome: "dispatched", data: "", sensitive: true }],
        },
      },
    });
    expect(result.error.cleanupReport).toMatchObject({
      owned_process_group: { state: "cleaned" },
      terminal_renderer: { state: "cleaned" },
      temporary_root: { state: "cleaned" },
    });
  },
  20_000,
);
