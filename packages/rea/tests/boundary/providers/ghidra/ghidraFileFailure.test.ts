import { open, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import { ghidraFileFailure } from "../../../../src/ghidra/GhidraFileArtifacts.js";
import {
  ArtifactFileCleanupFailure,
  mapArtifactFileFailure,
  withArtifactRegularFile,
} from "../../../../src/artifacts/ArtifactFileOperation.js";
import { ArtifactResourceScope } from "../../../../src/artifacts/ArtifactResourceScope.js";
import {
  AnalysisCleanupLease,
  AnalysisCleanupLeaseGroup,
} from "../../../../src/artifacts/AnalysisCleanupLease.js";
import { OwnedRegularFileOperationFailure } from "../../../../src/filesystem/OwnedRegularFile.js";
import { OwnedFileHandle } from "../../../../src/filesystem/OwnedFileHandle.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
} from "../../../../src/domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../../../../src/domain/providerCleanupError.js";
import { createEvidence } from "../../../../src/domain/evidence.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { nativePlistFailure } from "../../../../src/native/NativePlistSource.js";
import { appleDispatchMetadataFailure } from "../../../../src/native/AppleDispatchMetadata.js";

const retainFailedDescriptor = async (path: string, primary: unknown) => {
  const resources = new ArtifactResourceScope();
  let allowClose = false;
  let handle: FileHandle | undefined;
  const failure: unknown = await resources
    .run(() =>
      withArtifactRegularFile(
        path,
        resources,
        undefined,
        async ({ handle: file }) => {
          handle = file;
          const close = file.close.bind(file);
          file.close = async () => {
            if (!allowClose)
              throw new Error("controlled descriptor close refusal");
            await close();
          };
          throw new OwnedRegularFileOperationFailure(primary);
        },
      ),
    )
    .catch((cause: unknown) => cause);
  if (!(failure instanceof ArtifactFileCleanupFailure)) {
    allowClose = true;
    await resources.close();
    throw new Error("Expected the owned descriptor's cleanup failure");
  }
  return {
    failure,
    resources,
    get descriptor() {
      return handle;
    },
    release: async () => {
      allowClose = true;
      await resources.close();
    },
  };
};

const retainForeignFailure = async (path: string) => {
  await writeFile(path, "foreign bytes");
  const owner = new OwnedFileHandle(await open(path, "r"));
  const lease = AnalysisCleanupLease.forCloseOwner(owner, path);
  const partial = createEvidence(
    undefined,
    { id: "foreign", name: "foreign", version: null },
    {
      operation: "inspect_artifact",
      parameters: {},
      result: { foreign: true },
    },
  );
  const capturedOutput = {
    stdout: "foreign output",
    stderr: "foreign diagnostics",
    truncated: false,
  };
  const error = new ProviderCleanupError(
    "foreign",
    [path],
    { reason: "foreign descriptor remains owned" },
    {
      operation: "foreign-operation",
      partialObservation: partial,
      capturedOutput,
    },
  );
  new AnalysisCleanupLeaseGroup(error, [lease]);
  return { owner, lease, error, partial, capturedOutput };
};

it.each(["opaque", "errno", "authored"] as const)(
  "keeps Ghidra file provenance and local cleanup for a marked %s primary",
  async (kind) => {
    const root = await createTestTempDirectory("rea-ghidra-file-primary-");
    const path = join(root, "owned.txt");
    await writeFile(path, "owned bytes");
    const foreign = await retainForeignFailure(join(root, "foreign.txt"));
    const raw =
      kind === "errno"
        ? Object.assign(new Error("controlled read denial"), {
            code: "EACCES",
            syscall: "read",
            path,
          })
        : foreign.error;
    const owned = await retainFailedDescriptor(path, raw);
    const authored = new AnalysisArtifactChangedError(
      "resolve_analysis_profile",
      path,
      "authored identity classification",
      { cause: raw },
    );
    try {
      const projected =
        kind === "authored"
          ? mapArtifactFileFailure(owned.failure, () => authored)
          : owned.failure;
      const error = ghidraFileFailure(projected, "resolve_analysis_profile", {
        path,
      });
      const plist = nativePlistFailure(projected, { path, origin: "selected" });
      const dispatch = appleDispatchMetadataFailure(projected, path);
      const errors = [error, plist, dispatch];
      for (const failure of errors) {
        expect(failure.cleanupResources).toEqual([path]);
        expect(failure.cleanupIncomplete).toBe(true);
        expect(failure.partialObservation).toBeUndefined();
        expect(failure.capturedOutput).toBeUndefined();
        expect(failure.cleanupPrimary).not.toBe(foreign.error);
      }
      if (kind === "opaque") {
        expect(error.cleanupPrimary).toBeUndefined();
        expect(error.cause).toBe(owned.failure);
      } else if (kind === "errno") {
        expect(error.cleanupPrimary).toBeInstanceOf(AnalysisAccessDeniedError);
        expect(error.cleanupPrimary).toMatchObject({
          path,
          systemCode: "EACCES",
          cause: raw,
        });
      } else expect(error.cleanupPrimary).toBe(authored);
      expect(owned.descriptor?.fd).toBeGreaterThanOrEqual(0);
      await expect(owned.resources.close()).rejects.toThrow();
      await owned.release();
      expect(owned.descriptor?.fd).toBe(-1);
      for (const failure of errors) {
        expect(failure.cleanupIncomplete).toBe(false);
        expect(failure.cleanupResources).toEqual([]);
      }
      if (kind === "errno") {
        expect(projectAnalysisError(error).code).toBe("access_denied");
        expect(dispatch.cleanupPrimary).toBeInstanceOf(
          AnalysisAccessDeniedError,
        );
        expect(plist.cleanupPrimary?.message).toContain("permission denied");
      }
      if (kind === "authored") expect(error.cleanupPrimary).toBe(authored);
      expect(foreign.owner.handle.fd).toBeGreaterThanOrEqual(0);
      expect(foreign.lease.released).toBe(false);
      expect(foreign.error.cleanupIncomplete).toBe(true);
      expect(foreign.error.partialObservation).toBe(foreign.partial);
      expect(foreign.error.capturedOutput).toEqual(foreign.capturedOutput);
    } finally {
      await owned.release();
      await foreign.lease.release();
    }
  },
);
