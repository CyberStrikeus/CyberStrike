import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { build } from "plist";
import { expect, it } from "vitest";

import { inspectBundleKeyedArchive } from "./KeyedArchiveReader.js";
import { ArtifactProvider } from "../ArtifactProvider.js";
import { AnalysisAccessDeniedError } from "../../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";

const run = promisify(execFile);
const isRoot = process.getuid?.() === 0;

/**
 * Make the selected entry unreadable for this process using the host's own
 * mechanism, so the refusal is a real filesystem error and not a simulated one.
 */
const denyRead = async (path: string): Promise<() => Promise<void>> => {
  if (process.platform !== "win32") {
    await chmod(path, 0);
    return () => chmod(path, 0o700);
  }
  const user = process.env.USERNAME ?? "";
  await run("icacls", [path, "/deny", `${user}:R`]);
  return async () => {
    await run("icacls", [path, "/remove:d", user]).catch(() => undefined);
  };
};

it.skipIf(isRoot)(
  "reports a real host read refusal on the selected archive as access denial",
  async () => {
    const root = await createTestTempDirectory("rea-keyed-host-denial-");
    await mkdir(join(root, "Contents", "Resources"), { recursive: true });
    const selected = join(root, "Contents", "Resources", "Model.plist");
    await writeFile(
      selected,
      Buffer.from(
        build({
          $archiver: "NSKeyedArchiver",
          $version: 100000,
          $objects: ["$null", "leaf"],
          $top: { root: { CF$UID: 1 } },
        }),
      ),
    );

    const restore = await denyRead(selected);
    try {
      // Establish that the host, not this fixture, refuses the read.
      const refusal = await readFile(selected).catch((cause: unknown) => cause);
      expect(refusal).toMatchObject({
        code: process.platform === "win32" ? "EPERM" : "EACCES",
      });
      const systemCode =
        refusal instanceof Error && "code" in refusal
          ? String(refusal.code)
          : undefined;

      const rejected = await inspectBundleKeyedArchive({
        bundlePath: root,
        targetSha256: "a".repeat(64),
        parameters: { path: "Contents/Resources/Model.plist" },
        platform: "darwin",
      }).catch((cause: unknown) => cause);

      expect(rejected).toBeInstanceOf(AnalysisAccessDeniedError);
      if (!(rejected instanceof AnalysisAccessDeniedError))
        throw new Error("expected a host access denial");
      expect(rejected.systemCode).toBe(systemCode);
      expect(rejected.path).toBe(selected);
      expect(projectAnalysisError(rejected)).toMatchObject({
        code: "access_denied",
        category: "unavailable",
        retryable: false,
        details: {
          path: selected,
          system_code: systemCode,
          boundary: "filesystem-read",
        },
        remediation: { action: expect.stringContaining("read access") },
      });

      // The provider translate step must keep the typed error, not replace it
      // with a generic artifact io failure.
      const executed = await new ArtifactProvider(process.env, "darwin")
        .createClient({
          path: selected,
          sha256: "a".repeat(64),
          kind: "artifact",
          format: "plist",
        })
        .execute("inspect_keyed_archive", {});
      expect(executed.ok).toBe(false);
      if (executed.ok) throw new Error("expected a denied read");
      expect(executed.error).toBeInstanceOf(AnalysisAccessDeniedError);
      expect(projectAnalysisError(executed.error)).toMatchObject({
        code: "access_denied",
        category: "unavailable",
        details: { system_code: systemCode, boundary: "filesystem-read" },
      });
    } finally {
      await restore();
    }
  },
);
