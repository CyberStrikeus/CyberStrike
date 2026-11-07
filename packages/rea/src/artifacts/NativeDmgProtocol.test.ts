import { ExecFileOutputCancelledError } from "../process/ExecFileOutput.js";
import { ArtifactReaderFailure } from "./ArtifactReader.js";
import { build } from "plist";
import { expect, it, vi } from "vitest";
import {
  NativeDmgArtifactReader,
  type NativeDmgHost,
} from "./NativeDmgArtifactReader.js";
import { translateArtifactFailure } from "./ArtifactOperationFailure.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArtifactReaderTraversal } from "./ArtifactReader.js";
import { DirectoryArtifactReader } from "./DirectoryArtifactReader.js";

it.skipIf(process.platform === "win32").each([false, true])(
  "preserves mounted-directory coverage alongside readable DMG entries (unknown coverage: %s)",
  async (unknownCoverage) => {
    let mountPoint: string | undefined;
    const coverage: ArtifactReaderTraversal[] = [];
    const producerCoverage: ArtifactReaderTraversal = {
      status: "unknown",
      examinedEntries: 3,
      limitations: [
        "Directory contains an entry name that is not valid UTF-8.",
      ],
    };
    // APFS rejects invalid UTF-8 basenames at creation. Inject the directory
    // owner's completed observation while retaining its real entry traversal.
    const entries = DirectoryArtifactReader.prototype.entries;
    const traversal = vi
      .spyOn(DirectoryArtifactReader.prototype, "entries")
      .mockImplementation(async function* (
        this: DirectoryArtifactReader,
        signal,
        options,
      ) {
        yield* entries.call(this, signal, options);
        if (unknownCoverage && typeof options !== "function")
          options?.onCoverage?.(producerCoverage);
      });
    const host: NativeDmgHost = {
      run: async (args) => {
        if (args[0] === "verify" || args[0] === "detach")
          return { stdout: "", exitCode: 0 };
        if (args[0] === "attach") {
          const root = args[args.indexOf("-mountroot") + 1];
          if (root === undefined) throw new Error("Missing mount root");
          mountPoint = join(root, "Volume");
          await mkdir(mountPoint);
          await writeFile(join(mountPoint, "readable.txt"), "visible");
        }
        if (args[0] === "info" || args[0] === "attach") {
          const entities =
            mountPoint === undefined
              ? []
              : [{ "dev-entry": "/dev/disk800", "mount-point": mountPoint }];
          return {
            stdout: build(
              args[0] === "info"
                ? {
                    images:
                      entities.length === 0
                        ? []
                        : [{ "system-entities": entities }],
                  }
                : { "system-entities": entities },
            ),
            exitCode: 0,
          };
        }
        throw new Error(`Unexpected command ${String(args[0])}`);
      },
    };
    const reader = new NativeDmgArtifactReader("/fixture/image.dmg", {}, host);
    const paths: string[] = [];
    try {
      for await (const entry of reader.entries(undefined, {
        onCoverage: (value) => coverage.push(value),
      }))
        paths.push(entry.path);
      expect(paths).toContain("image.dmg/Volume/readable.txt");
      expect(coverage).toEqual(unknownCoverage ? [producerCoverage] : []);
    } finally {
      try {
        await reader.close();
      } finally {
        traversal.mockRestore();
      }
    }
  },
);

it("retains malformed successful hdiutil inventory output as a typed producer parse failure before attach", async () => {
  const calls: string[] = [];
  const host: NativeDmgHost = {
    run: async (args) => {
      calls.push(args[0] ?? "");
      if (args[0] === "verify") return { stdout: "", exitCode: 0 };
      if (args[0] === "info")
        return { stdout: build({ images: "not an array" }), exitCode: 0 };
      throw new Error("Unexpected command");
    },
  };
  const reader = new NativeDmgArtifactReader("/fixture/image.dmg", {}, host);
  let failure: unknown;
  try {
    for await (const _entry of reader.entries()) {
      /* consume */
    }
  } catch (cause: unknown) {
    failure = cause;
  } finally {
    await reader.close();
  }
  expect(calls).toEqual(["verify", "info"]);
  expect(failure).toMatchObject({
    reason: "format",
    message: "hdiutil info -plist returned malformed image inventory",
    cause: { name: "ZodError" },
  });
  expect(
    projectAnalysisError(translateArtifactFailure("inspect_artifact", failure)),
  ).toMatchObject({
    details: {
      reason: "format",
      detail: "hdiutil info -plist returned malformed image inventory",
    },
  });
});

it("uses the typed command cancellation owner for injected hosts and preserves physical AbortError names", async () => {
  for (const cancelled of [true, false]) {
    const reason = { requested: "stop injected verify" };
    const physical = Object.assign(new Error("physical host failure"), {
      name: "AbortError",
      code: "EIO",
    });
    const failureCause = cancelled
      ? new ExecFileOutputCancelledError(reason)
      : physical;
    const reader = new NativeDmgArtifactReader(
      "/fixture/image.dmg",
      {},
      {
        run: async () => {
          throw failureCause;
        },
      },
    );
    try {
      const result = (async () => {
        for await (const _entry of reader.entries()) {
          /* consume */
        }
      })();
      const failure: unknown = await result.catch((cause: unknown) => cause);
      expect(failure).toBeInstanceOf(ArtifactReaderFailure);
      if (!(failure instanceof ArtifactReaderFailure))
        throw new Error("Expected typed failure");
      expect(failure.reason).toBe(cancelled ? "cancelled" : "io");
      expect(failure.cause).toBe(failureCause);
      expect(failure.cancellation?.reason).toBe(cancelled ? reason : undefined);
    } finally {
      await reader.close();
    }
  }
});
