import { GhidraAdmissionError } from "../GhidraAdmissionError.js";
import { createHash } from "node:crypto";
import { realpath, mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import type { AppConfig } from "../../config/types.js";
import type { BinaryTarget } from "../../domain/binaryTargetTypes.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisUnsupportedTargetError,
} from "../../domain/analysisErrorCore.js";
import type { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import { assertArtifactReadActive } from "../../artifacts/ArtifactFileOperation.js";
import {
  readGhidraProfileArtifact,
  writeGhidraProfileArtifact,
  ghidraFileFailure,
} from "../GhidraFileArtifacts.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { jsonObjectSchema } from "../../domain/jsonValue.js";
import { err, ok, type Result } from "../../domain/result.js";
import { nativeAotAdapter } from "./nativeaot/NativeAotAdapter.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
/** Exact executable extension artifact committed before the session starts. */
export const ghidraExtensionSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9\x2d]*$/u),
  path: z.string().refine(isAbsolute, "Extension path must be absolute"),
  configured_path: z
    .string()
    .refine(isAbsolute, "Extension path must be absolute"),
  sha256: digest,
  entry_class: z.string().min(1),
  integration_api: z.literal(1),
});
export type GhidraExtension = z.infer<typeof ghidraExtensionSchema>;

/** Shared extension envelope; each adapter validates its own producer result. */
export const ghidraExtensionResultSchema = z.strictObject({
  id: z.string().min(1),
  sha256: digest,
  status: z.enum([
    "complete",
    "partial",
    "not_applicable",
    "unsupported",
    "failed",
  ]),
  reason: z.string().nullable(),
  result: jsonObjectSchema,
});
export type GhidraExtensionResult = z.infer<typeof ghidraExtensionResultSchema>;

/** Why an adapter cannot run here: on this host at all, or for this target. */
export interface GhidraExtensionRefusal {
  readonly constraint: "host" | "target";
  readonly reason: string;
}

/** Provider-local registration contract for independently replaceable analysis adapters. */
export interface GhidraExtensionAdapter {
  readonly id: string;
  readonly entryClass: string;
  configuredPath(config: AppConfig): string | undefined;
  unsupportedReason(
    target: BinaryTarget,
    platform: NodeJS.Platform,
  ): GhidraExtensionRefusal | null;
  validate(result: GhidraExtensionResult): string | null;
  readonly limitations: readonly string[];
}

const adapters: readonly GhidraExtensionAdapter[] = [nativeAotAdapter];
const MAX_EXTENSION_BYTES = 8 * 1024 * 1024;

/** JAR framing belongs to the extension adapter; file lifecycle is shared. */
const readJar = (
  path: string,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
): Promise<Buffer> =>
  readGhidraProfileArtifact(
    path,
    MAX_EXTENSION_BYTES,
    resources,
    signal,
    (bytes) => {
      if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50)
        throw new GhidraAdmissionError("not_jar", { path });
      return bytes;
    },
  );

/** Resolve explicitly configured optional extensions into the immutable analysis profile. */
export const resolveGhidraExtensions = async (
  config: AppConfig,
  target: BinaryTarget,
  platform: NodeJS.Platform,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
): Promise<Result<readonly GhidraExtension[], AnalysisError>> =>
  resources
    .run(async () => {
      const extensions: GhidraExtension[] = [];
      for (const adapter of adapters) {
        if (signal?.aborted)
          return err(
            new AnalysisCancelledError("open_binary", { cause: signal.reason }),
          );
        const configured = adapter.configuredPath(config);
        if (configured === undefined) continue;
        const refusal = adapter.unsupportedReason(target, platform);
        if (refusal !== null)
          return err(extensionRefusalError(refusal, target));
        try {
          const path = await realpath(configured);
          const bytes = await readJar(path, resources, signal);
          extensions.push({
            id: adapter.id,
            path,
            configured_path: configured,
            sha256: createHash("sha256").update(bytes).digest("hex"),
            entry_class: adapter.entryClass,
            integration_api: 1,
          });
        } catch (cause: unknown) {
          return err(
            ghidraFileFailure(cause, "resolve_analysis_profile", {
              extension: adapter.id,
              path: configured,
            }),
          );
        }
      }
      if (signal?.aborted)
        return err(
          new AnalysisCancelledError("open_binary", { cause: signal.reason }),
        );
      return ok(extensions);
    })
    .catch((cause: unknown) =>
      err(ghidraFileFailure(cause, "resolve_analysis_profile")),
    );

/** Require explicit local configuration before admitting executable code from a profile. */
export const validateGhidraExtensionProfile = (
  extensions: readonly GhidraExtension[],
  config: AppConfig,
  target: BinaryTarget,
  platform: NodeJS.Platform,
): string | null => {
  const enabled = adapters.filter(
    (adapter) => adapter.configuredPath(config) !== undefined,
  );
  if (
    enabled.length !== extensions.length ||
    new Set(extensions.map((extension) => extension.id)).size !==
      extensions.length
  )
    return "Configured Ghidra extension inventory differs from the resolved analysis profile.";
  for (const extension of extensions) {
    const adapter = enabled.find((value) => value.id === extension.id);
    if (
      adapter === undefined ||
      adapter.entryClass !== extension.entry_class ||
      adapter.configuredPath(config) !== extension.configured_path
    )
      return `Ghidra extension profile lacks matching explicit local configuration: ${extension.id}`;
    const refusal = adapter.unsupportedReason(target, platform);
    if (refusal !== null) return refusal.reason;
  }
  return null;
};

/**
 * A deliberate host or target refusal is not an execution failure: retrying
 * cannot change it, and its reason already names the remedy.
 */
const extensionRefusalError = (
  refusal: GhidraExtensionRefusal,
  target: BinaryTarget,
): AnalysisError =>
  refusal.constraint === "host"
    ? new AnalysisCapabilityUnavailableError(
        "ghidra",
        "resolve_analysis_profile",
        refusal.reason,
        { userMessage: refusal.reason },
      )
    : new AnalysisUnsupportedTargetError(
        "resolve_analysis_profile",
        target.path,
        refusal.reason,
        // The reason names the workflows that remain available.
        { remediationAction: refusal.reason },
      );

/** Snapshot committed extension bytes into the private runtime before Java loads them. */
export const snapshotGhidraExtensions = async (
  extensions: readonly GhidraExtension[],
  runtimeRoot: string,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
): Promise<readonly GhidraExtension[]> =>
  resources
    .run(async () => {
      assertArtifactReadActive(signal);
      if (extensions.length === 0) return [];
      for (const extension of extensions) {
        ghidraExtensionSchema.parse(extension);
        const adapter = adapters.find((value) => value.id === extension.id);
        if (
          adapter === undefined ||
          adapter.entryClass !== extension.entry_class
        )
          throw new GhidraAdmissionError("unregistered", {
            id: extension.id,
          });
        if ((await realpath(extension.configured_path)) !== extension.path)
          throw new GhidraAdmissionError("path_differs", {
            id: extension.id,
          });
      }
      const directory = join(runtimeRoot, "extensions");
      await mkdir(directory, { mode: 0o700 });
      const result: GhidraExtension[] = [];
      for (const extension of extensions) {
        const bytes = await readJar(extension.path, resources, signal);
        if (
          createHash("sha256").update(bytes).digest("hex") !== extension.sha256
        )
          throw new GhidraAdmissionError("digest_differs", {
            id: extension.id,
            path: extension.path,
          });
        const path = join(directory, `${extension.id}.jar`);
        await writeGhidraProfileArtifact(path, bytes, resources, signal);
        result.push({ ...extension, path });
      }
      return result;
    })
    .catch((cause: unknown) => {
      throw ghidraFileFailure(cause, "open_binary");
    });

/** Require every configured producer result to match its artifact and registered ABI. */
export const validateGhidraExtensionResults = (
  expected: readonly GhidraExtension[],
  results: readonly GhidraExtensionResult[],
): string | null => {
  if (
    results.length !== expected.length ||
    new Set(results.map((result) => result.id)).size !== results.length
  )
    return "Ghidra extension result inventory differs from its committed profile.";
  for (const extension of expected) {
    const result = results.find((value) => value.id === extension.id);
    const adapter = adapters.find((value) => value.id === extension.id);
    if (
      result === undefined ||
      adapter === undefined ||
      result.sha256 !== extension.sha256
    )
      return `Ghidra extension identity mismatch: ${extension.id}`;
    const invalid = adapter.validate(result);
    if (invalid !== null) return invalid;
  }
  return null;
};

/** Exact adapter limitations for explicitly configured session extensions. */
export const ghidraExtensionLimitations = (
  extensions: readonly GhidraExtension[],
): readonly string[] =>
  adapters
    .filter((adapter) =>
      extensions.some((extension) => extension.id === adapter.id),
    )
    .flatMap((adapter) => adapter.limitations);
