import { readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, onTestFinished, vi } from "vitest";
import { z } from "zod";

import { createCli } from "../../src/cli.js";
import { compareEvidenceBundlesCommand } from "../../src/application/EvidenceBundleCommands.js";
import {
  readEvidenceBundle,
  readImmutableEvidenceBundle,
  writeEvidenceBundle,
} from "../../src/application/EvidenceBundleFiles.js";
import { ArtifactResourceScope } from "../../src/artifacts/ArtifactResourceScope.js";
import { OwnedStagedOutput } from "../../src/filesystem/OwnedStagedOutput.js";
import { OwnedFileHandle } from "../../src/filesystem/OwnedFileHandle.js";
import { RetainedRegularFileCleanupFailure } from "../../src/application/RegularFileRead.js";
import * as bundleComparison from "../../src/domain/bundleComparison.js";
import * as bundleSummary from "../../src/domain/evidenceRecordSummary.js";
import { bundleComparisonResultSchema } from "../../src/domain/bundleComparison.js";
import { processEvidence } from "../../src/application/ReconstructionObligationLedger.fixture.js";
import { processCaptureSchema } from "../../src/domain/process/processCapture.js";
import * as evidenceBundleDomain from "../../src/domain/evidenceBundle.js";
import * as evidenceDomain from "../../src/domain/evidence.js";
import { createServer } from "../../src/server/createServer.js";
import { createTestBinarySession } from "../fixtures/binarySession.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

const unexpectedBundleFailures = [
  new TypeError("bundle authentication TypeError"),
  new Error("bundle authentication Error"),
] as const;

const spyOnBundleParse = (failure: Error): void => {
  const parser = vi
    .spyOn(evidenceBundleDomain.evidenceBundleSchema, "parse")
    .mockImplementation(() => {
      throw failure;
    });
  onTestFinished(() => parser.mockRestore());
};

const validBundleFile = async (directory: string, name = "bundle.json") => {
  const path = join(directory, name);
  const bundle = evidenceBundleDomain.createEvidenceBundle([processEvidence()]);
  await writeFile(path, evidenceBundleDomain.serializeEvidenceBundle(bundle));
  return { bundle, path };
};

it.each(["missing", "invalid", "cleanup"])(
  "retains the right bundle close owner when the left bundle has a %s failure",
  async (leftFailure) => {
    const directory = await createTestTempDirectory(
      "rea-bundle-mixed-cleanup-",
    );
    const { path: rightPath } = await validBundleFile(directory, "right.json");
    const leftPath = join(directory, "left.json");
    if (leftFailure === "invalid") await writeFile(leftPath, "{}");
    if (leftFailure === "cleanup")
      await validBundleFile(directory, "left.json");
    const rightIdentity = await stat(rightPath);
    const original = OwnedFileHandle.prototype.close;
    const owners = new Set<OwnedFileHandle>();
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(async function (this: OwnedFileHandle) {
        const identity = await this.handle.stat();
        if (identity.ino === rightIdentity.ino || leftFailure === "cleanup") {
          owners.add(this);
          throw new Error("injected bundle descriptor close failure");
        }
        await original.call(this);
      });
    onTestFinished(async () => {
      close.mockRestore();
      for (const owner of owners) await owner.close();
    });

    const result = await compareEvidenceBundlesCommand({ leftPath, rightPath });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupResources).toContain(rightPath);
    if (leftFailure === "cleanup")
      expect(result.error.cleanupResources).toContain(leftPath);
    expect(owners.size).toBe(leftFailure === "cleanup" ? 2 : 1);
    expect([...owners].every((owner) => owner.handle.fd >= 0)).toBe(true);

    // Retry the exact leases carried through the combined failure, rather than
    // closing an independently reconstructed descriptor owner.
    close.mockRestore();
    const retry = async (cause: unknown): Promise<void> => {
      if (cause instanceof RetainedRegularFileCleanupFailure) {
        await cause.cleanupLease.release();
      } else if (cause instanceof AggregateError) {
        for (const nested of cause.errors) await retry(nested);
      } else if (cause instanceof Error) await retry(cause.cause);
    };
    await retry(result.error);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect([...owners].every((owner) => owner.handle.fd < 0)).toBe(true);
  },
);

it.each([
  new TypeError("capture validation implementation failed"),
  new Error("capture validator failed"),
  new z.ZodError([
    { code: "custom", path: [], message: "capture refinement failed" },
  ]),
])(
  "preserves unexpected process validation failures while reading a bundle: $name",
  async (failure) => {
    const directory = await createTestTempDirectory(
      "rea-bundle-capture-failure-",
    );
    const path = join(directory, "bundle.json");
    await writeFile(
      path,
      evidenceBundleDomain.serializeEvidenceBundle(
        evidenceBundleDomain.createEvidenceBundle([processEvidence()]),
      ),
    );
    const validator = vi
      .spyOn(processCaptureSchema, "safeParse")
      .mockImplementation(() => {
        throw failure;
      });
    onTestFinished(() => validator.mockRestore());

    await expect(
      compareEvidenceBundlesCommand({ leftPath: path, rightPath: path }),
    ).rejects.toBe(failure);
  },
);

it.each(unexpectedBundleFailures)(
  "preserves unexpected bundle authentication failures in mutable and immutable readers: $name",
  async (failure) => {
    const directory = await createTestTempDirectory(
      "rea-bundle-reader-failure-",
    );
    const { path } = await validBundleFile(directory);
    spyOnBundleParse(failure);

    await expect(readEvidenceBundle(path)).rejects.toBe(failure);
    await expect(readImmutableEvidenceBundle(path)).rejects.toBe(failure);
    await expect(
      compareEvidenceBundlesCommand({ leftPath: path, rightPath: path }),
    ).rejects.toBe(failure);
  },
);

it.each(unexpectedBundleFailures)(
  "does not publish output or retain resources when bundle authentication throws: $name",
  async (failure) => {
    const directory = await createTestTempDirectory(
      "rea-bundle-write-failure-",
    );
    const { bundle } = await validBundleFile(directory, "input.json");
    const outputPath = join(directory, "output.json");
    const resources = new ArtifactResourceScope();
    onTestFinished(async () => {
      await resources.close();
    });
    spyOnBundleParse(failure);

    await expect(
      writeEvidenceBundle(bundle, outputPath, false, resources),
    ).rejects.toBe(failure);
    expect(await readdir(directory)).toEqual(["input.json"]);
    expect(resources.hasPending).toBe(false);
    await resources.close();
  },
);

it.each(unexpectedBundleFailures)(
  "preserves unexpected bundle authentication failures through SDK import: $name",
  async (failure) => {
    const directory = await createTestTempDirectory(
      "rea-bundle-import-failure-",
    );
    const { path } = await validBundleFile(directory);
    const session = createTestBinarySession(() => {
      throw new Error("Evidence import must not launch a provider");
    });
    const server = createServer({ kind: "session", session });
    const client = new Client({ name: "bundle-import-failure", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    spyOnBundleParse(failure);
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const response = await client.callTool({
        name: "import_evidence_bundle",
        arguments: { path },
      });
      expect(response).toMatchObject({
        isError: true,
        content: [{ type: "text", text: failure.message }],
      });
      expect(response.structuredContent).toBeUndefined();
      expect(session.exportEvidenceBundle().records).toEqual([]);
      expect(session.exportEvidenceBundle().unknowns).toEqual([]);
    } finally {
      await Promise.allSettled([
        client.close(),
        server.close(),
        session.close(),
      ]);
    }
  },
);

it.each(unexpectedBundleFailures)(
  "preserves the session ledger when bundle authentication throws: $name",
  async (failure) => {
    const directory = await createTestTempDirectory(
      "rea-ledger-import-failure-",
    );
    const { bundle } = await validBundleFile(directory);
    const existing = evidenceDomain.createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      {
        operation: "observe",
        parameters: {},
        result: { retained: true },
      },
    );
    const session = createTestBinarySession(() => {
      throw new Error("Evidence import must not launch a provider");
    });
    onTestFinished(async () => {
      await session.close();
    });
    expect(session.recordEvidence(existing).ok).toBe(true);
    const before = session.exportEvidenceBundle();
    spyOnBundleParse(failure);

    expect(() => session.importEvidenceBundle(bundle)).toThrow(failure);
    expect(session.exportEvidenceBundle()).toEqual(before);
  },
);

it.each(unexpectedBundleFailures)(
  "propagates unexpected standalone-record classification failures: $name",
  async (failure) => {
    const directory = await createTestTempDirectory(
      "rea-bundle-classifier-failure-",
    );
    const path = join(directory, "record.json");
    const record = processEvidence();
    await writeFile(path, JSON.stringify(record));
    const parser = vi
      .spyOn(evidenceDomain, "parseEvidence")
      .mockImplementation(() => {
        throw failure;
      });
    onTestFinished(() => parser.mockRestore());

    await expect(readImmutableEvidenceBundle(path)).rejects.toBe(failure);
  },
);

it.each([
  new TypeError("comparison output invariant failed"),
  new RangeError("comparison computation failed"),
  new z.ZodError([
    { code: "custom", path: ["status"], message: "invalid generated result" },
  ]),
])(
  "keeps an internal comparison failure distinct from damaged Evidence: $name",
  async (failure) => {
    const directory = await createTestTempDirectory(
      "rea-bundle-compute-failure-",
    );
    const path = join(directory, "bundle.json");
    await writeFile(
      path,
      evidenceBundleDomain.serializeEvidenceBundle(
        evidenceBundleDomain.createEvidenceBundle([]),
      ),
    );
    // Reach output validation through the actual command, reader, authentication
    // and comparison. This fault is generated output, not the caller's bundle.
    const output = vi
      .spyOn(bundleComparisonResultSchema, "parse")
      .mockImplementation(() => {
        throw failure;
      });
    onTestFinished(() => output.mockRestore());

    const originalExitCode = process.exitCode;
    onTestFinished(() => {
      process.exitCode = originalExitCode;
    });
    process.exitCode = 0;
    let stdout = "";
    let exitCode = 0;
    await createCli({}).serve(["compare", path, path, "--json"], {
      env: {},
      stdout: (chunk) => {
        stdout += chunk;
      },
      exit: (code) => {
        exitCode = code;
      },
    });
    expect(exitCode || Number(process.exitCode ?? 0)).toBe(1);
    expect(JSON.parse(stdout)).toEqual({
      code: "UNKNOWN",
      message: failure.message,
    });
    await expect(
      compareEvidenceBundlesCommand({ leftPath: path, rightPath: path }),
    ).rejects.toBe(failure);
  },
);

const standaloneBundleArguments = (
  command: string,
  path: string,
  output: string,
) =>
  command === "inspect-evidence-bundle"
    ? [command, JSON.stringify({ path })]
    : command === "compare"
      ? [command, path, path]
      : command === "evidence-export"
        ? [command, path, output]
        : [command, path];

it.each([
  "evidence-import",
  "evidence-export",
  "compare",
  "inspect-evidence-bundle",
])(
  "retries retained read cleanup through the standalone %s owner",
  async (command) => {
    const directory = await createTestTempDirectory(
      "rea-standalone-bundle-cleanup-",
    );
    const { path } = await validBundleFile(directory);
    const output = join(directory, "output.json");
    const original = OwnedFileHandle.prototype.close;
    const attempts = new Map<OwnedFileHandle, number>();
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(async function (this: OwnedFileHandle) {
        const attempt = (attempts.get(this) ?? 0) + 1;
        attempts.set(this, attempt);
        if (attempt < 3) throw new Error("retryable descriptor close failure");
        return original.call(this);
      });
    onTestFinished(async () => {
      close.mockRestore();
      for (const owner of attempts.keys()) await owner.close();
    });
    let stdout = "";
    const previousExitCode = process.exitCode;
    try {
      await createCli({}).serve(
        [...standaloneBundleArguments(command, path, output), "--json"],
        {
          stdout: (part) => {
            stdout += part;
          },
          exit: () => {},
        },
      );
      expect(attempts.size).toBe(command === "compare" ? 2 : 1);
      expect([...attempts.values()]).toEqual(
        command === "compare" ? [3, 3] : [3],
      );
      expect([...attempts.keys()].every((owner) => owner.handle.fd < 0)).toBe(
        true,
      );
      const result = JSON.parse(stdout);
      // A read which failed to complete its own cleanup remains a failed read;
      // final cleanup resolves resource ownership rather than inventing data.
      expect(result).toMatchObject({ code: "execution_failure" });
      expect(result.details?.cleanup_incomplete).not.toBe(true);
      expect(await readdir(directory)).toEqual(["bundle.json"]);
    } finally {
      process.exitCode = previousExitCode;
    }
  },
);

it.each([
  "evidence-import",
  "evidence-export",
  "compare",
  "inspect-evidence-bundle",
])("handles SIGINT during the standalone %s input close", async (command) => {
  const directory = await createTestTempDirectory(
    "rea-standalone-bundle-cancel-",
  );
  const { path } = await validBundleFile(directory);
  const output = join(directory, "output.json");
  const original = OwnedFileHandle.prototype.close;
  const owners = new Set<OwnedFileHandle>();
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(async function (this: OwnedFileHandle) {
      owners.add(this);
      await original.call(this);
      process.emit("SIGINT");
    });
  onTestFinished(() => close.mockRestore());
  const before = process.listenerCount("SIGINT");
  const previousExitCode = process.exitCode;
  let stdout = "";
  try {
    process.exitCode = undefined;
    await createCli({}).serve(
      [...standaloneBundleArguments(command, path, output), "--json"],
      {
        stdout: (part) => {
          stdout += part;
        },
        exit: () => {},
      },
    );
    expect(JSON.parse(stdout)).toMatchObject({ code: "cancelled" });
    expect(process.exitCode).toBe(130);
    expect(process.listenerCount("SIGINT")).toBe(before);
    expect(owners.size).toBeGreaterThan(0);
    expect([...owners].every((owner) => owner.handle.fd < 0)).toBe(true);
    expect(await readdir(directory)).toEqual(["bundle.json"]);
  } finally {
    process.exitCode = previousExitCode;
  }
});

it.each(["compare", "inspect-evidence-bundle"])(
  "retains completed %s output when SIGINT is queued during projection",
  async (command) => {
    const directory = await createTestTempDirectory(
      "rea-standalone-bundle-projection-",
    );
    const { path, bundle } = await validBundleFile(directory);
    const queueInterrupt = () => {
      setImmediate(() => process.emit("SIGINT"));
    };
    const compare = bundleComparison.compareBundles;
    const summarize = bundleSummary.summarizeEvidenceBundle;
    const hook =
      command === "compare"
        ? vi
            .spyOn(bundleComparison, "compareBundles")
            .mockImplementation((...args) => {
              const result = compare(...args);
              queueInterrupt();
              return result;
            })
        : vi
            .spyOn(bundleSummary, "summarizeEvidenceBundle")
            .mockImplementation((...args) => {
              const result = summarize(...args);
              queueInterrupt();
              return result;
            });
    onTestFinished(() => hook.mockRestore());
    const previousExitCode = process.exitCode;
    const listeners = process.listenerCount("SIGINT");
    let stdout = "";
    try {
      process.exitCode = undefined;
      await createCli({}).serve(
        [
          ...(command === "compare"
            ? [command, path, path]
            : [command, JSON.stringify({ path, detail: "summary" })]),
          "--json",
        ],
        {
          stdout: (part) => {
            stdout += part;
          },
          exit: () => {},
        },
      );
      const expected =
        command === "compare" ? compare(bundle, bundle) : summarize(bundle);
      expect(JSON.parse(stdout)).toMatchObject({
        code: "cancelled",
        details: { diagnostics: { completed_result: expected } },
      });
      expect(hook).toHaveBeenCalledOnce();
      expect(process.exitCode).toBe(130);
      expect(process.listenerCount("SIGINT")).toBe(listeners);
    } finally {
      process.exitCode = previousExitCode;
    }
  },
);

it.each(["before-commit", "after-commit", "cleanup-retry"])(
  "preserves standalone export publication facts on SIGINT at %s",
  async (phase) => {
    const directory = await createTestTempDirectory(
      "rea-standalone-export-publication-",
    );
    const { path, bundle } = await validBundleFile(directory);
    const output = join(directory, "output.json");
    const method =
      phase === "before-commit" ? "assertReadyForPublication" : "close";
    const original = OwnedStagedOutput.prototype[method];
    let attempts = 0;
    const hook = vi
      .spyOn(OwnedStagedOutput.prototype, method)
      .mockImplementation(async function (
        this: OwnedStagedOutput,
        ...args: Parameters<OwnedStagedOutput[typeof method]>
      ) {
        attempts += 1;
        if (phase === "cleanup-retry" && attempts === 1)
          throw new Error("retry staged cleanup");
        await Reflect.apply(original, this, args);
        if (phase === "before-commit") process.emit("SIGINT");
        else setImmediate(() => process.emit("SIGINT"));
      });
    onTestFinished(() => hook.mockRestore());
    const previousExitCode = process.exitCode;
    const listeners = process.listenerCount("SIGINT");
    let stdout = "";
    try {
      process.exitCode = undefined;
      await createCli({}).serve(["evidence-export", path, output, "--json"], {
        stdout: (part) => {
          stdout += part;
        },
        exit: () => {},
      });
      const result = JSON.parse(stdout);
      expect(result).toMatchObject({ code: "cancelled" });
      expect(process.exitCode).toBe(130);
      expect(process.listenerCount("SIGINT")).toBe(listeners);
      if (phase === "before-commit") {
        expect(await readdir(directory)).toEqual(["bundle.json"]);
        expect(result).not.toHaveProperty(
          "details.diagnostics.evidence_bundle",
        );
      } else {
        const bytes = await stat(output);
        expect(result.details.diagnostics.evidence_bundle).toEqual({
          path: output,
          bytes: bytes.size,
        });
        const loaded = await readEvidenceBundle(output);
        expect(loaded).toEqual({ ok: true, value: bundle });
        expect((await readdir(directory)).sort()).toEqual([
          "bundle.json",
          "output.json",
        ]);
      }
      expect(attempts).toBe(phase === "cleanup-retry" ? 2 : 1);
    } finally {
      process.exitCode = previousExitCode;
    }
  },
);
