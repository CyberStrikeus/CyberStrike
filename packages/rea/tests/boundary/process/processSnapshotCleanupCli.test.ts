import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { expect } from "vitest";
import { z } from "zod";

import { analysisCliErrorEnvelopeSchema } from "../../../src/contracts/errorSchemas.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { itWithCaptureCapability } from "./processCaptureCapability.js";

const execFileAsync = promisify(execFile);
const CLI_TIMEOUT_MS = 30_000;

const snapshotClosePreload = `
import fs from "node:fs";
import { resolve } from "node:path";
import { syncBuiltinESMExports } from "node:module";

const cliEntry = process.env.REA_TEST_CLI_ENTRY;
if (cliEntry !== undefined && resolve(process.argv[1] ?? "") === cliEntry) {
  const targetPath = process.env.REA_TEST_SNAPSHOT_FILE;
  const markerPath = process.env.REA_TEST_SNAPSHOT_CLOSE_MARKER;
  const originalOpen = fs.promises.open;
  let closeAttempts = 0;
  let released = false;
  let descriptorClosed = false;
  let closeFailureMessage;
  const record = () => {
    if (markerPath !== undefined) {
      fs.writeFileSync(markerPath, JSON.stringify({
        closeAttempts,
        released,
        descriptorClosed,
        closeFailureMessage: closeFailureMessage ?? null,
      }));
    }
  };

  fs.promises.open = async function (path, ...args) {
    const handle = await originalOpen.call(this, path, ...args);
    if (targetPath === undefined || resolve(String(path)) !== targetPath)
      return handle;
    const nativeClose = handle.close.bind(handle);
    const nativeStat = handle.stat.bind(handle);
    handle.close = async function () {
      closeAttempts++;
      if (closeAttempts === 1) {
        closeFailureMessage = "controlled final snapshot close failure";
        record();
        throw new Error(closeFailureMessage);
      }
      await nativeClose();
      released = true;
      try {
        await nativeStat();
      } catch (cause) {
        descriptorClosed = cause?.code === "EBADF";
      }
      record();
    };
    return handle;
  };
  syncBuiltinESMExports();
}
`;

const snapshotCloseMarkerSchema = z
  .object({
    closeAttempts: z.number().int().nonnegative(),
    released: z.boolean(),
    descriptorClosed: z.boolean(),
    closeFailureMessage: z.string().nullable(),
  })
  .strict();

itWithCaptureCapability(
  "retains the completed final snapshot and retries its exact file descriptor in the compiled CLI",
  async () => {
    const fixtureRoot = await createTestTempDirectory(
      "rea-process-snapshot-close-cli-",
    );
    const workingRoot = join(fixtureRoot, "working");
    const scenarioPath = join(fixtureRoot, "scenario.json");
    const preloadPath = join(fixtureRoot, "snapshot-close-preload.mjs");
    const markerPath = join(fixtureRoot, "snapshot-close-marker.json");
    const observedPath = join(workingRoot, "final-observation.txt");
    const observedBytes = "completed final filesystem observation";
    await mkdir(workingRoot);
    await writeFile(
      scenarioPath,
      JSON.stringify({
        executable: process.execPath,
        arguments: [
          "-e",
          `require("node:fs").writeFileSync(${JSON.stringify(observedPath)}, ${JSON.stringify(observedBytes)}); process.stdout.write("capture completed\\n");`,
        ],
        working_directory: workingRoot,
        filesystem_observation_paths: [workingRoot],
      }),
    );
    await writeFile(preloadPath, snapshotClosePreload);

    try {
      const cliEntry = resolve("scripts/rea.mjs");
      const result = await execFileAsync(
        process.execPath,
        [cliEntry, "capture-process", scenarioPath, "--json"],
        {
          cwd: fixtureRoot,
          env: {
            ...process.env,
            NODE_OPTIONS: `--import=${pathToFileURL(preloadPath).href}`,
            REA_TEST_CLI_ENTRY: cliEntry,
            REA_TEST_SNAPSHOT_FILE: observedPath,
            REA_TEST_SNAPSHOT_CLOSE_MARKER: markerPath,
          },
          timeout: CLI_TIMEOUT_MS,
        },
      ).then(
        ({ stdout, stderr }) => ({ exitCode: 0, stdout, stderr }),
        (cause: unknown) => {
          if (!(cause instanceof Error)) throw cause;
          const failure = cause as Error & {
            readonly code?: number | string;
            readonly stdout?: string;
            readonly stderr?: string;
          };
          return {
            exitCode: failure.code,
            stdout: failure.stdout ?? "",
            stderr: failure.stderr ?? "",
          };
        },
      );
      const marker = snapshotCloseMarkerSchema.parse(
        JSON.parse(await readFile(markerPath, "utf8")),
      );
      expect(result.exitCode, result.stderr || result.stdout).toBe(1);
      expect(
        marker,
        JSON.stringify({
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        }),
      ).toEqual({
        closeAttempts: 2,
        released: true,
        descriptorClosed: true,
        closeFailureMessage: "controlled final snapshot close failure",
      });
      await expect(access(observedPath)).resolves.toBeUndefined();
      const output = analysisCliErrorEnvelopeSchema.parse(
        JSON.parse(result.stdout),
      );
      const expectedHash = createHash("sha256")
        .update(observedBytes)
        .digest("hex");
      expect(output).toMatchObject({
        code: "process_capture_failed",
        details: {
          partial_observation: {
            observations: {
              exit: {
                state: "available",
                value: { code: 0, reason: "exited" },
              },
              filesystem_snapshots: {
                after: {
                  state: "available",
                  value: {
                    files: expect.arrayContaining([
                      expect.objectContaining({
                        path: "root_0:final-observation.txt",
                        sha256: expectedHash,
                      }),
                    ]),
                  },
                },
              },
            },
          },
          execution_failure: expect.stringContaining(
            "controlled final snapshot close failure",
          ),
        },
      });
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  },
  CLI_TIMEOUT_MS,
);
