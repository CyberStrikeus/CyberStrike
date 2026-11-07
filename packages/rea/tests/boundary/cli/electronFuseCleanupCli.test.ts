import { jsonObjectSchema } from "../../../src/domain/jsonValue.js";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect } from "vitest";
import { cliTest } from "../../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  thinFuseImage,
  OBSIDIAN_FUSE_BYTES,
} from "../../fixtures/electron/fuseImage.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { analysisErrorProjectionSchema } from "../../../src/contracts/errorSchemas.js";
import { parseEvidence } from "../../../src/domain/evidence.js";

cliTest.for([
  "normal",
  "close-once",
  "read-and-close-once",
  "deny-until-allowed",
] as const)(
  "owns the actual CLI fuse descriptor through %s",
  async (mode, { processes }) => {
    const root = await createTestTempDirectory("rea-cli-fuse-cleanup-");
    const path = join(root, "selected");
    const tracePath = join(root, "trace.jsonl");
    await writeFile(path, thinFuseImage(OBSIDIAN_FUSE_BYTES).bytes);
    const result = await processes.run(
      process.execPath,
      [
        "--import",
        resolve("tests/fixtures/electron/fuseCleanupPreload.mjs"),
        resolve("scripts/rea.mjs"),
        "inspect-electron-fuses",
        path,
        "--json",
      ],
      {
        env: {
          PATH: process.env.PATH,
          HOME: root,
          REA_LOG_LEVEL: "silent",
          REA_FUSE_PROBE_INPUT: path,
          REA_FUSE_PROBE_MODE: mode,
          REA_FUSE_PROBE_TRACE: tracePath,
          REA_FUSE_PROBE_ALLOW: join(root, "allow"),
        },
        timeoutMs: 30_000,
      },
    );
    const trace = (await readFile(tracePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(trace.filter((entry) => entry.kind === "open")).toHaveLength(1);
    expect(result.signal, result.stderr).toBeNull();
    if (mode === "normal") {
      expect(result.exitCode, result.stderr).toBe(0);
      expect(
        toolContract("inspect_electron_fuses").outputSchema.parse(
          JSON.parse(result.stdout),
        ).subject?.architecture,
      ).toBe("arm64");
    } else {
      expect(result.exitCode, result.stderr).toBe(1);
      const failure = analysisErrorProjectionSchema.parse(
        JSON.parse(result.stdout),
      );
      const details = jsonObjectSchema.parse(failure.details ?? {});
      const persistent = mode === "deny-until-allowed";
      expect(failure.code).toBe(
        persistent
          ? "cleanup_incomplete"
          : mode === "close-once"
            ? "execution_failure"
            : "access_denied",
      );
      if (persistent) {
        expect(failure.details).toMatchObject({
          cleanup: "incomplete",
          resources: [path],
        });
      } else {
        expect(details.cleanup).not.toBe("incomplete");
        expect(details.resources).toBeUndefined();
        const closes = trace.filter((entry) => entry.kind === "close");
        expect(closes.map((entry) => entry.denied)).toEqual([true, false]);
        expect(closes[0].descriptor).toBe(closes[1].descriptor);
      }
      if (mode === "close-once")
        expect(parseEvidence(details.partial_observation)).toMatchObject({
          subject: { local_path: path, architecture: "arm64" },
          normalized_result: { slices: [{ sentinel_count: 1 }] },
        });
    }
    // The probe releases only residue which production did not recover.
    expect(
      trace.filter((entry) => entry.kind === "probe-final-release"),
    ).toHaveLength(mode === "deny-until-allowed" ? 1 : 0);
  },
);
