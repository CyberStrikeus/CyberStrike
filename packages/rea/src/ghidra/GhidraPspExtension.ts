import { GhidraAdmissionError } from "./GhidraAdmissionError.js";
import { createHash } from "node:crypto";
import { lstat, opendir, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { sameRegularFileState } from "../filesystem/RegularFile.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
} from "../domain/analysisErrorCore.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { err, ok, type Result } from "../domain/result.js";
import type { GhidraInstallationInspection } from "./GhidraInstallation.js";
import { parseGhidraJavaProperties } from "./GhidraJavaProperties.js";

import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
import { OwnedDirectoryHandle } from "../filesystem/OwnedDirectoryHandle.js";
import {
  assertArtifactReadActive,
  artifactFileCancellationCause,
  artifactFilePrimaryFacts,
  bindArtifactFileCleanup,
  withArtifactRegularFile,
} from "../artifacts/ArtifactFileOperation.js";

/** Installed processor code and data, distinct from REA's analysis-extension ABI. */
export const ghidraPspExtensionSchema = z.strictObject({
  id: z.literal("ghidra-allegrex"),
  root: z.string().refine(isAbsolute),
  ghidra_version: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
export type GhidraPspExtension = z.infer<typeof ghidraPspExtensionSchema>;

// Resource bounds for scanning a caller-installed extension, not target limits.
const MAX_ENTRIES = 1024;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_DEPTH = 16;
const REQUIRED = [
  "Module.manifest",
  "extension.properties",
  "data/languages/allegrex.ldefs",
  "data/languages/allegrex.sla",
  "data/languages/allegrex.pspec",
  "data/languages/allegrex.cspec",
];

/** Read-only fingerprint of all installed files; no home scanning or installation. */
export const inspectGhidraPspExtension = async (
  root: string,
  ghidraVersion: string,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
): Promise<GhidraPspExtension> => {
  try {
    return await resources.run(() =>
      fingerprint(root, ghidraVersion, resources, signal),
    );
  } catch (cause: unknown) {
    throw ghidraPspInspectionError(cause);
  }
};

const fingerprint = async (
  root: string,
  ghidraVersion: string,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
): Promise<GhidraPspExtension> => {
  assertArtifactReadActive(signal);
  if (!isAbsolute(root) || (await realpath(root)) !== root)
    throw new GhidraAdmissionError("canonical_path");
  const files: string[] = [];
  let entries = 1; // The root itself consumes one inventory entry.
  const visit = async (relative: string, depth: number): Promise<void> => {
    assertArtifactReadActive(signal);
    if (depth > MAX_DEPTH)
      throw new GhidraAdmissionError("nesting_exceeds_limit", {
        max_depth: MAX_DEPTH,
      });
    const path = join(root, relative);
    const metadata = await lstat(path);
    if (metadata.isDirectory()) {
      const children = await readChildren(
        path,
        MAX_ENTRIES - entries,
        resources,
        signal,
      );
      entries += children.length;
      children.sort();
      for (const child of children)
        await visit(
          relative === "" ? child : `${relative}/${child}`,
          depth + 1,
        );
    } else if (metadata.isFile()) {
      files.push(relative);
    } else throw new GhidraAdmissionError("entry_kind", { relative });
  };
  await visit("", 0);
  for (const required of REQUIRED)
    if (!files.includes(required))
      throw new GhidraAdmissionError("component_missing", {
        component: required,
      });
  if (!files.some((path) => path.startsWith("lib/") && path.endsWith(".jar")))
    throw new GhidraAdmissionError("loader_jar_missing");
  const hash = createHash("sha256");
  let bytesRead = 0;
  let properties = Buffer.alloc(0);
  for (const relative of files) {
    assertArtifactReadActive(signal);
    const path = join(root, relative);
    await withArtifactRegularFile(
      path,
      resources,
      signal,
      async ({ handle, initial: before }) => {
        if (
          !Number.isSafeInteger(before.size) ||
          before.size > MAX_BYTES - bytesRead
        )
          throw new GhidraAdmissionError("bytes_exceed_limit", {
            max_bytes: MAX_BYTES,
          });
        if (relative === "extension.properties" && before.size > 65536)
          throw new GhidraAdmissionError("properties_exceed_limit", {
            max_bytes: 65536,
          });
        hash.update(JSON.stringify([relative, before.size]));
        const buffer = Buffer.alloc(Math.min(65536, before.size + 1));
        let offset = 0;
        const chunks: Buffer[] = [];
        // Serial reads keep final close behind every native read. One extra byte
        // detects growth without a stream's read-ahead or unbounded allocation.
        while (offset <= before.size) {
          assertArtifactReadActive(signal);
          const { bytesRead } = await handle.read(
            buffer,
            0,
            Math.min(buffer.length, before.size - offset + 1),
            offset,
          );
          assertArtifactReadActive(signal);
          if (bytesRead === 0) break;
          offset += bytesRead;
          if (offset > before.size)
            throw new GhidraAdmissionError("component_changed", { relative });
          const chunk = buffer.subarray(0, bytesRead);
          hash.update(chunk);
          if (relative === "extension.properties")
            chunks.push(Buffer.from(chunk));
        }
        if (offset !== before.size)
          throw new GhidraAdmissionError("component_truncated", { relative });
        if (
          !sameRegularFileState(before, await handle.stat()) ||
          !sameRegularFileState(before, await lstat(path))
        )
          throw new GhidraAdmissionError("component_changed", { relative });
        bytesRead += before.size;
        if (relative === "extension.properties")
          properties = Buffer.concat(chunks);
      },
    );
  }
  // Ghidra's extension.properties version is the compatible Ghidra version,
  // not the extension release (e.g. v21.4); content identity supplies the latter.
  const parsedProperties = parseGhidraJavaProperties(
    properties.toString("latin1"),
  );
  if (!parsedProperties.ok)
    throw new GhidraAdmissionError("properties_invalid", {
      parser_code: parsedProperties.error,
    });
  const property = (name: string): string | undefined =>
    parsedProperties.value.get(name);
  if (
    property("name") !== "ghidra-allegrex" ||
    property("version") !== ghidraVersion
  )
    throw new GhidraAdmissionError("metadata_mismatch", {
      ghidra_version: ghidraVersion,
    });
  assertArtifactReadActive(signal);
  return {
    id: "ghidra-allegrex",
    root,
    ghidra_version: ghidraVersion,
    sha256: hash.digest("hex"),
  };
};

/** Resolve prerequisites before opening or admitting cached PSP analysis. */
export const resolveGhidraPspExtension = async (
  installation: GhidraInstallationInspection,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
): Promise<Result<GhidraPspExtension, AnalysisError>> => {
  try {
    assertArtifactReadActive(signal);
    if (
      installation.status !== "available" ||
      installation.platform !== "linux" ||
      installation.architecture !== "x64"
    )
      throw new GhidraAdmissionError("host_unsupported", {
        platform: installation.platform,
        architecture: installation.architecture,
      });
    const root = join(
      await realpath(installation.installDir),
      "Ghidra",
      "Extensions",
      "ghidra-allegrex",
    );
    return ok(
      await inspectGhidraPspExtension(
        root,
        installation.providerVersion,
        resources,
        signal,
      ),
    );
  } catch (cause: unknown) {
    return err(ghidraPspInspectionError(cause));
  }
};

/** Preserve the producer's primary failure and its live cleanup dependencies. */
const ghidraPspInspectionError = (cause: unknown): AnalysisError => {
  if (cause instanceof AnalysisError) return cause;
  const cleanup =
    cause instanceof ArtifactReaderFailure ? cause.cleanup : undefined;
  const { cause: primary } = artifactFilePrimaryFacts(cause);
  const admission =
    primary instanceof GhidraAdmissionError ? primary : undefined;
  const identity =
    admission?.code ??
    (primary instanceof Error ? primary.message : String(primary));
  const reason = `PSP_EXTENSION_UNAVAILABLE: ${identity} Use a compatible caller-installed ghidra-allegrex under GHIDRA_INSTALL_DIR/Ghidra/Extensions; REA does not install it.`;
  const diagnostics =
    admission === undefined
      ? undefined
      : { code: admission.code, ...admission.detail };
  const error =
    cause instanceof ArtifactReaderFailure && cause.reason === "cancelled"
      ? new AnalysisCancelledError("resolve_analysis_profile", {
          cause: artifactFileCancellationCause(cause),
          cleanup,
        })
      : new AnalysisCapabilityUnavailableError(
          "ghidra",
          "resolve_analysis_profile",
          reason,
          {
            cause,
            userMessage: reason,
            cleanup,
            ...(diagnostics === undefined ? {} : { diagnostics }),
          },
        );
  bindArtifactFileCleanup(cause, error);
  return error;
};

/** Close before descending, retaining the exact directory owner on uncertainty. */
const readChildren = async (
  path: string,
  remainingEntries: number,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
): Promise<string[]> => {
  assertArtifactReadActive(signal);
  const owner = new OwnedDirectoryHandle(await opendir(path));
  let outcome:
    | { readonly kind: "completed"; readonly names: string[] }
    | { readonly kind: "failed"; readonly cause: unknown };
  try {
    const names: string[] = [];
    for (;;) {
      assertArtifactReadActive(signal);
      const child = await owner.handle.read();
      assertArtifactReadActive(signal);
      if (child === null) break;
      if (names.length >= remainingEntries)
        throw new GhidraAdmissionError("inventory_exceeds_limit", {
          max_entries: MAX_ENTRIES,
        });
      names.push(child.name);
    }
    outcome = { kind: "completed", names };
  } catch (cause: unknown) {
    outcome = { kind: "failed", cause };
  }
  const lease = new AnalysisCleanupLease(() => owner.close(), [path]);
  const attempt = await resources.release({
    kind: "lease",
    resource: path,
    lease,
  });
  if (attempt.kind === "failed") {
    const primary =
      outcome.kind === "failed"
        ? outcome.cause
        : signal?.aborted
          ? new ArtifactReaderFailure(
              "cancelled",
              "PSP inspection cancelled during directory close",
              { cause: signal.reason },
            )
          : attempt.cause;
    const error = ghidraPspInspectionError(
      ArtifactReaderFailure.withCleanup(
        primary,
        ArtifactReaderFailure.cleanupObservation(attempt.cause, path),
      ),
    );
    lease.bindCleanupError(error);
    throw error;
  }
  if (outcome.kind === "failed") throw outcome.cause;
  assertArtifactReadActive(signal);
  return outcome.names;
};
