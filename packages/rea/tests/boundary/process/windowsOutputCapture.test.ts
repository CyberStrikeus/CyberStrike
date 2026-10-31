import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ProviderProcessSupervisor,
  spawnOwnedProviderProcess,
} from "../../../src/process/ProviderProcess.js";

const OUTPUT_BYTES = 8 * 1024 * 1024 + 64 * 1024;
const WRITE_BYTES = 64 * 1024;
const WINDOWS_OUTPUT_DEADLINE_MS = 30_000;

const expectedDigest = (): string => {
  const hash = createHash("sha256");
  const chunk = Buffer.alloc(WRITE_BYTES, 0x61);
  let remaining = OUTPUT_BYTES;
  while (remaining > 0) {
    const bytes = Math.min(remaining, chunk.length);
    hash.update(chunk.subarray(0, bytes));
    remaining -= bytes;
  }
  return hash.digest("hex");
};

describe.skipIf(process.platform !== "win32")(
  "Windows owned process output capture",
  () => {
    it(
      "drains and retains a multi-megabyte stdout stream before the workflow deadline",
      async () => {
        const script = [
          `let remaining = ${OUTPUT_BYTES};`,
          `const chunk = Buffer.alloc(${WRITE_BYTES}, 0x61);`,
          "function write() {",
          "  while (remaining > 0) {",
          "    const bytes = Math.min(remaining, chunk.length);",
          "    remaining -= bytes;",
          "    if (!process.stdout.write(chunk.subarray(0, bytes))) {",
          "      process.stdout.once('drain', write);",
          "      return;",
          "    }",
          "  }",
          "}",
          "write();",
        ].join("\n");
        const startedAt = performance.now();
        const launched = await spawnOwnedProviderProcess({
          command: process.execPath,
          arguments: ["-e", script],
          runId: `rea-windows-output-${randomUUID()}`,
        });
        const supervisor = new ProviderProcessSupervisor(
          {
            process: launched.process,
            ownsProcessLifetime: true,
            ownership: launched.ownership,
            ...(launched.cleanup === undefined
              ? {}
              : { cleanup: launched.cleanup }),
          },
          { maxDiagnosticBytes: OUTPUT_BYTES + WRITE_BYTES },
        );

        try {
          const remainingDeadlineMs = Math.max(
            0,
            WINDOWS_OUTPUT_DEADLINE_MS - (performance.now() - startedAt),
          );
          expect(
            await supervisor.waitForOutputClose(remainingDeadlineMs),
            `expected ${OUTPUT_BYTES} bytes before the ${WINDOWS_OUTPUT_DEADLINE_MS} ms workflow deadline`,
          ).toBe(true);
          const snapshot = supervisor.snapshot();
          expect(snapshot.exitCode).toBe(0);
          expect(snapshot.signal).toBeNull();
          expect(snapshot.stdout.observedBytes).toBe(OUTPUT_BYTES);
          expect(snapshot.stdout.bytes).toBe(OUTPUT_BYTES);
          expect(snapshot.stderr.observedBytes).toBe(0);
          expect(snapshot.diagnosticTruncated).toBeUndefined();
          expect(snapshot.outputIncomplete).toBeUndefined();
          const elapsedMs = Math.round(performance.now() - startedAt);
          const digest = createHash("sha256")
            .update(snapshot.stdout.text, "utf8")
            .digest("hex");
          expect(digest).toBe(expectedDigest());
          expect(await supervisor.stop()).toMatchObject({
            status: "verified-cleanup",
          });
          console.info(
            JSON.stringify({
              test: "windows-owned-process-output-capture",
              bytes: snapshot.stdout.bytes,
              elapsed_ms: elapsedMs,
              sha256: digest,
              deadline_ms: WINDOWS_OUTPUT_DEADLINE_MS,
            }),
          );
        } finally {
          const cleanup = await supervisor.stop();
          supervisor.dispose();
          if (cleanup.status === "incomplete")
            throw new Error(
              `Windows output fixture cleanup failed: ${cleanup.reason}`,
            );
        }
      },
      WINDOWS_OUTPUT_DEADLINE_MS + 5_000,
    );
  },
);
