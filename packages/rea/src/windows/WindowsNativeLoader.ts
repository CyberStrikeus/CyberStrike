import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { PACKAGE_METADATA } from "../generatedPackageMetadata.js";
import {
  WINDOWS_NATIVE_ARTIFACT,
  parseWindowsNativeManifest,
  validateWindowsNativeArtifact,
} from "../domain/windowsNativeArtifact.js";

/** A native resource remains opaque until the addon validates its object tag. */
export const windowsHandleSchema = z.custom<object>(
  (value): value is object =>
    typeof value === "object" && value !== null && !Array.isArray(value),
);

/** Observed identity of an opened local NTFS object. */
export const windowsFileIdentitySchema = z.strictObject({
  requestedPath: z.string(),
  finalPath: z.string(),
  filesystem: z.literal("NTFS"),
  volumeSerial: z.string().regex(/^[a-f0-9]{16}$/u),
  fileId: z.string().regex(/^[a-f0-9]{32}$/u),
  size: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  directory: z.boolean(),
});

const inspectionSchema = z.strictObject({
  abiVersion: z.literal(WINDOWS_NATIVE_ARTIFACT.abiVersion),
  nodeApiVersion: z.literal(WINDOWS_NATIVE_ARTIFACT.nodeApiVersion),
  architecture: z.literal(WINDOWS_NATIVE_ARTIFACT.architecture),
  filesystem: windowsFileIdentitySchema,
  privateDacl: z.literal(true),
  privateBridgeDescriptorAccess: z.literal(true),
  atomicJobAssignment: z.literal(true),
  killOnOwnerClose: z.literal(true),
  protocolStdin: z.boolean().optional(),
  /** Absent from artifacts built before owned Job Object commit limits. */
  jobMemoryLimit: z.literal(true).optional(),
});

type NativeCall = (
  operation: string,
  arguments_: readonly unknown[],
) => unknown;
const bindingSchema = z.strictObject({
  call: z.custom<NativeCall>(
    (value): value is NativeCall => typeof value === "function",
  ),
});

/** Validated native operations and the observations establishing readiness. */
export interface WindowsNativeAuthority {
  readonly call: NativeCall;
  readonly inspection: z.infer<typeof inspectionSchema>;
}

/** Availability of the bundled native implementation, including load failures. */
export type WindowsNativeLoadResult =
  | { readonly available: true; readonly authority: WindowsNativeAuthority }
  | {
      readonly available: false;
      readonly reason: string;
      readonly failureStage:
        | "host"
        | "artifact"
        | "load"
        | "self-test"
        | "inspection";
      /** Only a failed native invocation can recover on a later query. */
      readonly retryable?: true;
    };

/** Trusted package reads and module loading, replaceable in loader tests. */
export interface WindowsNativeLoadHost {
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
  readonly nodeApiVersion: string | undefined;
  readonly packageVersion: string;
  readManifest(): unknown;
  readArtifact(): Buffer;
  loadArtifact(): unknown;
}

const missingWindowsNativeFileReason = (file: string): string =>
  `Missing packaged Windows native file native/windows/build/${file} (ENOENT). Restore both native/windows/build/manifest.json and native/windows/build/rea-windows-x64.node from the rea-agents@${PACKAGE_METADATA.version} tarball or build them with native/windows/README.md; no native artifact was loaded.`;

/** Recovery when Windows refuses to load the verified artifact, for example by code-integrity policy. */
export const WINDOWS_NATIVE_LOAD_REFUSED_REMEDIATION =
  "The file matched the package manifest, so restoring or reinstalling it will not help. If Windows reports that an Application Control policy blocked the file, Smart App Control or an App Control for Business policy refused it. Windows native controls, which Ghidra and JADX need on Windows, stay unavailable; rea setup can still register clients. Run REA on a host whose policy allows this file, or ask the REA maintainers about a signed build.";

const readPackagedWindowsNativeFile = <T>(file: string, read: () => T): T => {
  try {
    return read();
  } catch (cause: unknown) {
    if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      cause.code === "ENOENT"
    )
      throw new Error(missingWindowsNativeFileReason(file), { cause });
    throw cause;
  }
};

/** Validate compatibility and artifact identity before invoking the native addon. */
export const loadWindowsNativeAuthority = (
  host: WindowsNativeLoadHost,
): WindowsNativeLoadResult => {
  if (host.platform !== "win32" || host.architecture !== "x64")
    return {
      available: false,
      failureStage: "host",
      reason: "REA Windows native controls require a Windows x64 host.",
    };
  const nodeApiVersion = Number(host.nodeApiVersion);
  if (
    !Number.isSafeInteger(nodeApiVersion) ||
    nodeApiVersion < WINDOWS_NATIVE_ARTIFACT.nodeApiVersion
  )
    return {
      available: false,
      failureStage: "host",
      reason: "REA Windows native controls require Node-API 8 or newer.",
    };
  try {
    const manifest = parseWindowsNativeManifest(
      readPackagedWindowsNativeFile("manifest.json", () => host.readManifest()),
      host.packageVersion,
    );
    if (!manifest.ok) throw manifest.error;
    const artifact = readPackagedWindowsNativeFile(
      WINDOWS_NATIVE_ARTIFACT.artifact,
      () => host.readArtifact(),
    );
    const valid = validateWindowsNativeArtifact(manifest.value, artifact);
    if (!valid.ok) throw valid.error;
    let loadedModule: unknown;
    try {
      loadedModule = host.loadArtifact();
    } catch (cause: unknown) {
      return {
        available: false,
        failureStage: "load",
        reason: `REA Windows native controls are unavailable: Windows refused to load the verified native/windows/build/rea-windows-x64.node: ${cause instanceof Error ? cause.message : String(cause)} ${WINDOWS_NATIVE_LOAD_REFUSED_REMEDIATION}`,
      };
    }
    const binding = bindingSchema.parse(loadedModule);
    let observed: unknown;
    try {
      observed = binding.call("inspect", []);
    } catch (cause: unknown) {
      return {
        available: false,
        failureStage: "self-test",
        retryable: true,
        reason: `REA Windows native self-test failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    }
    const parsed = inspectionSchema.safeParse(observed);
    if (!parsed.success)
      return {
        available: false,
        failureStage: "inspection",
        reason: `REA Windows native inspection is invalid: ${parsed.error.message}`,
      };
    const inspection = parsed.data;
    return { available: true, authority: { call: binding.call, inspection } };
  } catch (cause: unknown) {
    return {
      available: false,
      failureStage: "artifact",
      reason: `REA Windows native controls are unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
};

let cached: WindowsNativeLoadResult | undefined;

/** Cache stable admission; let a later query retry failed owned inspection. */
export const systemWindowsNativeAuthority = (): WindowsNativeLoadResult => {
  if (cached?.available === false && cached.retryable === true)
    cached = undefined;
  cached ??= loadWindowsNativeAuthority({
    platform: process.platform,
    architecture: process.arch,
    nodeApiVersion: process.versions.napi,
    packageVersion: PACKAGE_METADATA.version,
    readManifest: () => {
      const encoded = readFileSync(
        new URL("../../native/windows/build/manifest.json", import.meta.url),
        "utf8",
      );
      const value: unknown = JSON.parse(encoded);
      return value;
    },
    readArtifact: () =>
      readFileSync(
        new URL(
          "../../native/windows/build/rea-windows-x64.node",
          import.meta.url,
        ),
      ),
    loadArtifact: () => {
      const value: unknown = createRequire(import.meta.url)(
        fileURLToPath(
          new URL(
            "../../native/windows/build/rea-windows-x64.node",
            import.meta.url,
          ),
        ),
      );
      return value;
    },
  });
  return cached;
};

/** Require the verified backend when an operation depends on native authority. */
export const requireWindowsNativeAuthority = (): WindowsNativeAuthority => {
  const loaded = systemWindowsNativeAuthority();
  if (!loaded.available) throw new Error(loaded.reason);
  return loaded.authority;
};
