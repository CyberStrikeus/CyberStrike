import { access, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { itWithCaptureCapability } from "./processCaptureCapability.js";

const execFileAsync = promisify(execFile);
const CLI_TIMEOUT_MS = 30_000;

const cleanupPreload = `
import fs from "node:fs";
import { basename, resolve } from "node:path";
import { syncBuiltinESMExports } from "node:module";

const cliEntry = process.env.REA_TEST_CLI_ENTRY;
if (cliEntry !== undefined && resolve(process.argv[1] ?? "") === cliEntry) {
  const markerPath = process.env.REA_TEST_CLEANUP_MARKER;
  const originalMkdtemp = fs.promises.mkdtemp;
  const originalRm = fs.promises.rm;
  let captureRoot;
  let removalAttempts = 0;
  let released = false;
  const record = () => {
    if (markerPath !== undefined) {
      fs.writeFileSync(markerPath, JSON.stringify({
        root: captureRoot,
        removalAttempts,
        released,
      }));
    }
  };

  fs.promises.mkdtemp = async function (prefix, ...options) {
    const root = await originalMkdtemp.call(this, prefix, ...options);
    if (basename(String(prefix)) === "rea-process-") {
      captureRoot = resolve(root);
      record();
    }
    return root;
  };
  fs.promises.rm = async function (path, ...options) {
    if (captureRoot === undefined || resolve(String(path)) !== captureRoot)
      return originalRm.call(this, path, ...options);
    removalAttempts += 1;
    record();
    if (removalAttempts === 1)
      throw new Error("controlled first temporary-root removal denial");
    const result = await originalRm.call(this, path, ...options);
    released = true;
    record();
    return result;
  };
  syncBuiltinESMExports();
}
`;

interface CleanupMarker {
  readonly root: string;
  readonly removalAttempts: number;
  readonly released: boolean;
}

const readCleanupMarker = async (path: string): Promise<CleanupMarker> => {
  const contents = await readFile(path, "utf8");
  const parsed: unknown = JSON.parse(contents);
  if (typeof parsed !== "object" || parsed === null)
    throw new Error("Cleanup preload did not write its marker object");
  const candidate = parsed as Partial<CleanupMarker>;
  if (
    typeof candidate.root !== "string" ||
    typeof candidate.removalAttempts !== "number" ||
    typeof candidate.released !== "boolean"
  )
    throw new Error("Cleanup preload marker is missing removal results");
  return {
    root: candidate.root,
    removalAttempts: candidate.removalAttempts,
    released: candidate.released,
  };
};

itWithCaptureCapability(
  "retries the failed capture root before projecting the completed CLI failure",
  async () => {
    const fixtureRoot = await createTestTempDirectory(
      "rea-process-cleanup-recovery-cli-",
    );
    const scenarioPath = join(fixtureRoot, "scenario.json");
    const preloadPath = join(fixtureRoot, "cleanup-preload.mjs");
    const markerPath = join(fixtureRoot, "cleanup-marker.json");
    await writeFile(
      scenarioPath,
      JSON.stringify({
        executable: process.execPath,
        arguments: ["-e", "process.stdout.write('capture completed\\n')"],
        working_directory: fixtureRoot,
      }),
    );
    await writeFile(preloadPath, cleanupPreload);

    let captureRoot: string | undefined;
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
            REA_TEST_CLEANUP_MARKER: markerPath,
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
      const marker = await readCleanupMarker(markerPath);
      captureRoot = marker.root;
      expect(result.exitCode, result.stderr || result.stdout).toBe(1);
      expect(marker.removalAttempts).toBe(2);
      expect(marker.released).toBe(true);
      const output: unknown = JSON.parse(result.stdout);
      expect(output).toMatchObject({
        error: "Process command failed",
        code: "process_capture_failed",
        details: {
          cleanup_report: {
            temporary_root: {
              state: "failed",
              reason: "controlled first temporary-root removal denial",
            },
          },
          partial_observation: {
            capture: {
              exit: { code: 0, reason: "exited" },
            },
          },
        },
      });
      await expect(access(captureRoot)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      if (captureRoot !== undefined)
        await rm(captureRoot, { recursive: true, force: true });
    }
  },
  CLI_TIMEOUT_MS,
);
