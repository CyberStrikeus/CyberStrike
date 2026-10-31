import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute } from "node:path";

import { appendCallerPath } from "../filesystem/callerPath.js";

import type { ProviderAvailability } from "../application/AnalysisProvider.js";
import type { ProviderRejectionCode } from "../domain/providerSelection.js";
import type { AnalysisErrorOptions } from "../domain/analysisErrorBase.js";
import {
  AnalysisCapabilityUnavailableError,
  AnalysisArtifactChangedError,
} from "../domain/analysisErrorCore.js";
import type { JsonValue } from "../domain/jsonValue.js";

export interface WiresharkExecutableIdentity {
  readonly bytes: number;
  readonly sha256: string;
}

/** Retain only identity facts after a bounded executable read. */
export const wiresharkExecutableIdentity = (snapshot: {
  readonly bytes: Uint8Array;
  readonly sha256: string;
}): WiresharkExecutableIdentity => ({
  bytes: snapshot.bytes.byteLength,
  sha256: snapshot.sha256,
});

/** Shared identity owner used to verify each caller-selected tool run. */
export const assertWiresharkExecutableIdentity = (
  operation: string,
  path: string,
  expected: WiresharkExecutableIdentity,
  actual: WiresharkExecutableIdentity,
  options?: AnalysisErrorOptions,
): void => {
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
    throw new AnalysisArtifactChangedError(
      operation,
      path,
      "The selected Wireshark executable changed during analysis.",
      options,
    );
};

/** Environment keys selecting the caller's tshark and capinfos binaries. */
export const TSHARK_COMMAND_ENV = "REA_TSHARK_COMMAND";
export const CAPINFOS_COMMAND_ENV = "REA_CAPINFOS_COMMAND";

const TOOL_REMEDIATION = `Supply Wireshark 4.x tshark and capinfos on PATH or through absolute ${TSHARK_COMMAND_ENV} and ${CAPINFOS_COMMAND_ENV}; REA does not install them.`;

/**
 * Host-tool refusals concern the caller's Wireshark installation, not the
 * target, so they carry their own guidance instead of the generic advice to
 * choose another target.
 */
export const pcapToolUnavailable = (
  operation: string,
  reason: string,
  options?: AnalysisErrorOptions,
): AnalysisCapabilityUnavailableError =>
  new AnalysisCapabilityUnavailableError("pcap", operation, reason, {
    ...options,
    userMessage: `${/[.!?]$/u.test(reason) ? reason : `${reason}.`} ${TOOL_REMEDIATION}`,
  });

/** How one caller-supplied Wireshark tool was selected. */
export interface WiresharkToolSelection {
  readonly command: string;
  readonly source: "environment" | "path";
}

/** How each tool was selected for this provider instance. */
export interface PcapToolSelection {
  readonly tshark: WiresharkToolSelection;
  readonly capinfos: WiresharkToolSelection;
}

const TOOL_COMMAND_ENV = {
  tshark: TSHARK_COMMAND_ENV,
  capinfos: CAPINFOS_COMMAND_ENV,
} as const;

/**
 * The one selection rule for a caller-supplied Wireshark tool: an absolute
 * environment path, otherwise the bare tool name resolved through PATH. A
 * relative environment value is configuration to fix, never a PATH lookup.
 * REA never installs the Wireshark suite.
 */
export const selectWiresharkTool = (
  environment: Readonly<Record<string, string | undefined>>,
  tool: "tshark" | "capinfos",
): WiresharkToolSelection => {
  const key = TOOL_COMMAND_ENV[tool];
  const configured = environment[key];
  if (configured === undefined || configured.trim() === "")
    return { command: tool, source: "path" };
  if (!isAbsolute(configured))
    throw new PcapConfigurationFailure(
      `${tool}_not_absolute`,
      `${key} must be an absolute path to the ${tool} binary`,
      { configured },
    );
  return { command: configured, source: "environment" };
};

/**
 * Resolve the caller-supplied tshark and capinfos binaries to the executables
 * the packet tools would also select. Windows keeps PATH/PATHEXT resolution in
 * the launcher, which the POSIX locator does not model.
 */
export const resolvePcapTools = (
  environment: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
): PcapToolSelection => {
  // Report every configuration error before consulting PATH for either tool.
  const selected = {
    tshark: selectWiresharkTool(environment, "tshark"),
    capinfos: selectWiresharkTool(environment, "capinfos"),
  };
  const locate = (tool: "tshark" | "capinfos"): WiresharkToolSelection => {
    const selection = selected[tool];
    if (selection.source === "environment" || platform === "win32")
      return selection;
    const command = locateWiresharkTool(selection, environment);
    if (command === undefined)
      throw new PcapConfigurationFailure(
        `${tool}_missing`,
        `${tool} was not found in an absolute PATH entry; add it to PATH or set ${TOOL_COMMAND_ENV[tool]} to its absolute path`,
      );
    return { command, source: "path" };
  };
  return { tshark: locate("tshark"), capinfos: locate("capinfos") };
};

/**
 * Locate a selected tool as an absolute executable so its identity can be
 * hashed. Environment selections are already absolute. PATH selections use the
 * first absolute PATH entry holding an executable regular file; relative PATH
 * entries are skipped because they would depend on the working directory.
 * Returns undefined when PATH holds no such executable.
 */
export const locateWiresharkTool = (
  selection: WiresharkToolSelection,
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined => {
  if (selection.source === "environment" || isAbsolute(selection.command))
    return selection.command;
  for (const directory of (environment.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const candidate = appendCallerPath(directory, selection.command);
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Absent or non-executable candidates leave later PATH entries eligible.
    }
  }
  return undefined;
};

export type PcapConfigurationFailureCode =
  | "tshark_not_absolute"
  | "capinfos_not_absolute"
  | "tshark_missing"
  | "capinfos_missing"
  | "tshark_version_unresolved"
  | "capinfos_version_unresolved"
  | "tshark_version_unsupported"
  | "capinfos_version_unsupported";

export class PcapConfigurationFailure extends Error {
  constructor(
    readonly code: PcapConfigurationFailureCode,
    message: string,
    readonly diagnostics: Readonly<Record<string, JsonValue>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * Recognize the selected Wireshark tool's version banner: null when the first
 * line is not a Wireshark banner, a failure when its major version is not 4.
 */
export const parseWiresharkVersion = (
  stdout: string,
  tool: "tshark" | "capinfos",
): string | null => {
  const line = stdout
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find((entry) => entry !== "");
  const parsed =
    line === undefined
      ? null
      : new RegExp(`^${tool} \\(Wireshark\\) (\\d+)\\.\\d+\\.\\d+`, "iu").exec(
          line,
        );
  if (parsed === null || line === undefined) return null;
  if (parsed[1] !== "4")
    throw new PcapConfigurationFailure(
      `${tool}_version_unsupported`,
      "Packet capture inspection currently requires Wireshark 4.x tools; select an installation with the admitted output profile.",
      { version: line },
    );
  return line;
};

export interface PcapClientIdentity {
  readonly tsharkVersion: string | null;
  readonly capinfosVersion: string | null;
}

/** Probe both tools without reading any capture file. */
export const inspectPcapClient = async (
  selection: PcapToolSelection,
  probe: (command: string) => Promise<string>,
): Promise<PcapClientIdentity> => ({
  tsharkVersion: parseWiresharkVersion(
    await probe(selection.tshark.command),
    "tshark",
  ),
  capinfosVersion: parseWiresharkVersion(
    await probe(selection.capinfos.command),
    "capinfos",
  ),
});

/** Availability in the shape shared by every provider. */
const rejectionCodeOf = (
  code: PcapConfigurationFailureCode,
): ProviderRejectionCode =>
  code.includes("missing")
    ? "executable_missing"
    : code.includes("unsupported")
      ? "unsupported_version"
      : code.includes("not_absolute")
        ? "not_configured"
        : "version_unresolved";

export const pcapConfigurationAvailability = (
  cause: PcapConfigurationFailure,
): ProviderAvailability => ({
  status: "unavailable",
  code: rejectionCodeOf(cause.code),
  reason: cause.message,
  diagnostics: { ...cause.diagnostics },
});
