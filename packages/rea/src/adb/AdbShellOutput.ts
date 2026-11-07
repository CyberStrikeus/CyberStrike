import { collectNumericIssues } from "./AdbNumericIssues.js";
import type {
  AdbDisplayNumericIssues,
  AdbPackageNumericIssues,
  AdbWindowFocusContext,
  AdbWindowFocusObservation,
} from "../domain/adb/adbDeviceAnalysis.js";
import {
  collectUnparsedLines,
  type AdbUnparsedLines,
} from "./AdbUnparsedLines.js";

/**
 * Parsers for fixed observation commands REA runs through `adb shell`.
 *
 * Formats follow toybox output on Android 8+ (verified against an Android 14
 * emulator). Unparseable lines are sampled and counted rather than dropped so
 * callers can see the format drift instead of silently losing rows.
 */

export interface AdbProcessEntry {
  readonly user: string;
  readonly pid: number;
  readonly ppid: number | null;
  readonly rss: number | null;
  readonly state: string | null;
  readonly name: string;
}

// Toybox emits one separator before the unpadded final NAME column.
// Remaining whitespace belongs to argv[0], not the table layout.
const PROCESS_LINE =
  /^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+) (.+)$/u;

const safeInteger = (text: string): number | null => {
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
};

/** Parse `ps -A` output; the header line is preserved verbatim as `columns`. */
export const parseProcessListOutput = (
  stdout: string,
): {
  columns: string | null;
  processes: readonly AdbProcessEntry[];
  unparsedLines: AdbUnparsedLines;
} => {
  const processes: AdbProcessEntry[] = [];
  const unparsed = collectUnparsedLines();
  let columns: string | null = null;
  for (const line of stdout.split(/\r?\n/u)) {
    if (line.trim() === "") continue;
    if (/^USER\s+PID\s+PPID\b/u.test(line)) {
      columns = line.trim();
      continue;
    }
    const match = PROCESS_LINE.exec(line);
    if (match === null) {
      unparsed.add(line);
      continue;
    }
    const pid = safeInteger(match[2]!);
    const ppid = safeInteger(match[3]!);
    const rss = safeInteger(match[5]!);
    if (pid === null || ppid === null || rss === null) unparsed.add(line);
    if (pid === null) continue;
    processes.push({
      user: match[1]!,
      pid,
      ppid,
      rss,
      state: match[8]!,
      name: match[9]!,
    });
  }
  return { columns, processes, unparsedLines: unparsed.facts() };
};

export interface AdbFeatureEntry {
  readonly name: string;
  readonly version: number | null;
}

const FEATURE_LINE = /^feature:([^=\s]+)(?:=(0x[0-9a-fA-F]+|\d+))?$/u;

/** Parse `pm list features` output, including hex GL versions. */
export const parseFeatureListOutput = (
  stdout: string,
): {
  features: readonly AdbFeatureEntry[];
  unparsedLines: AdbUnparsedLines;
} => {
  const features: AdbFeatureEntry[] = [];
  const unparsed = collectUnparsedLines();
  for (const rawLine of stdout.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "") continue;
    const match = FEATURE_LINE.exec(line);
    if (match === null) {
      unparsed.add(rawLine);
      continue;
    }
    const version = match[2] === undefined ? null : safeInteger(match[2]);
    if (match[2] !== undefined && version === null) unparsed.add(rawLine);
    features.push({
      name: match[1]!,
      version,
    });
  }
  return { features, unparsedLines: unparsed.facts() };
};

export interface AdbServiceEntry {
  readonly name: string;
  readonly interface: string | null;
}

const SERVICE_LINE = /^\s*(?:\d+\s+)?([A-Za-z0-9._$/-]+):\s*\[([^\]]*)\]\s*$/u;

/** Parse `service list` output, tolerating numbered and plain formats. */
export const parseServiceListOutput = (
  stdout: string,
): {
  services: readonly AdbServiceEntry[];
  unparsedLines: AdbUnparsedLines;
} => {
  const services: AdbServiceEntry[] = [];
  const unparsed = collectUnparsedLines();
  for (const rawLine of stdout.split(/\r?\n/u)) {
    const line = rawLine.trimEnd();
    if (line.trim() === "" || /^Found \d+ services:/u.test(line.trim()))
      continue;
    const match = SERVICE_LINE.exec(line);
    if (match === null) {
      if (line.trim() !== "") unparsed.add(line.trim());
      continue;
    }
    services.push({
      name: match[1]!,
      interface: match[2] === "" ? null : match[2]!,
    });
  }
  return { services, unparsedLines: unparsed.facts() };
};

const SIZE_DECLARATION = /^(Physical|Override) size:(.*)$/u;
const SIZE_VALUE = /^\s+(\d+)x(\d+)$/u;
const DENSITY_DECLARATION = /^(Physical|Override) density:(.*)$/u;
const DENSITY_VALUE = /^\s+(\d+)$/u;
const DENSITY_BARE = /^(\d+)$/u;

type DisplayNumericIssue = AdbDisplayNumericIssues["sample"][number];

/** Parse declarations before admission so a malformed last declaration stays owned. */
export const parseWmSizeOutput = (
  stdout: string,
): {
  physical: { readonly width: number; readonly height: number } | null;
  override: { readonly width: number; readonly height: number } | null;
  physicalDeclared: boolean;
  numericIssues: AdbDisplayNumericIssues;
} => {
  let physical = null;
  let override = null;
  let physicalDeclared = false;
  const issues = collectNumericIssues<DisplayNumericIssue>();
  for (const rawLine of stdout.split(/\r?\n/u)) {
    const declaration = SIZE_DECLARATION.exec(rawLine.trim());
    if (declaration === null) continue;
    const field =
      declaration[1] === "Physical" ? "physical_size" : "override_size";
    if (field === "physical_size") physicalDeclared = true;
    const match = SIZE_VALUE.exec(declaration[2]!);
    const width = match === null ? null : safeInteger(match[1]!);
    const height = match === null ? null : safeInteger(match[2]!);
    const reason =
      match === null
        ? "invalid_format"
        : width === null || height === null
          ? "unsafe_integer"
          : width <= 0 || height <= 0
            ? "nonpositive"
            : null;
    const value =
      reason === null && width !== null && height !== null
        ? { width, height }
        : null;
    if (reason !== null)
      issues.add({ command: "wm size", field, reason, raw_line: rawLine });
    if (field === "physical_size") physical = value;
    else override = value;
  }
  return {
    physical,
    override,
    physicalDeclared,
    numericIssues: issues.facts(),
  };
};

/** Labeled physical density dominates the first bare declaration, even when malformed. */
export const parseWmDensityOutput = (
  stdout: string,
): {
  physical: number | null;
  override: number | null;
  numericIssues: AdbDisplayNumericIssues;
} => {
  let physical = null;
  let override = null;
  let bare = null;
  let physicalDeclared = false;
  let bareDeclared = false;
  const issues = collectNumericIssues<DisplayNumericIssue>();
  for (const rawLine of stdout.split(/\r?\n/u)) {
    const trimmed = rawLine.trim();
    const declaration = DENSITY_DECLARATION.exec(trimmed);
    const bareMatch = declaration === null ? DENSITY_BARE.exec(trimmed) : null;
    if (declaration === null && (bareMatch === null || bareDeclared)) continue;
    const field =
      declaration?.[1] === "Override" ? "override_density" : "physical_density";
    const match =
      declaration === null ? bareMatch : DENSITY_VALUE.exec(declaration[2]!);
    const value = match === null ? null : safeInteger(match[1]!);
    const reason =
      match === null
        ? "invalid_format"
        : value === null
          ? "unsafe_integer"
          : value <= 0
            ? "nonpositive"
            : null;
    const admitted = reason === null ? value : null;
    if (reason !== null)
      issues.add({ command: "wm density", field, reason, raw_line: rawLine });
    if (declaration === null) {
      bareDeclared = true;
      bare = admitted;
    } else if (field === "physical_density") {
      physicalDeclared = true;
      physical = admitted;
    } else override = admitted;
  }
  return {
    physical: physicalDeclared ? physical : bare,
    override,
    numericIssues: issues.facts(),
  };
};

/** Own declaration identity and omission before deriving a singular summary. */
export const parseWindowFocusOutput = (
  stdout: string,
): AdbWindowFocusObservation => {
  const contexts: AdbWindowFocusContext[] = [];
  const observedLines: string[] = [];
  let current: AdbWindowFocusContext | undefined;
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("Display:")) {
      current = {
        scope: "display",
        display_id:
          /^Display:\s+mDisplayId=(-?[0-9]+)(?:\s|$)/u.exec(trimmed)?.[1] ??
          null,
        header_line: line,
        declarations: [],
      };
      contexts.push(current);
      observedLines.push(line);
      continue;
    }
    const field = trimmed.startsWith("mCurrentFocus=")
      ? "mCurrentFocus"
      : trimmed.startsWith("mFocusedApp=")
        ? "mFocusedApp"
        : undefined;
    if (field === undefined) continue;
    if (current === undefined) {
      current = {
        scope: "unscoped",
        display_id: null,
        header_line: null,
        declarations: [],
      };
      contexts.push(current);
    }
    const value = trimmed.slice(field.length + 1).trim();
    current.declarations.push({
      field,
      value: value === "null" ? null : value,
      raw_line: line,
    });
    observedLines.push(line);
  }
  const windows =
    contexts.length === 1
      ? contexts[0]!.declarations.filter(
          ({ field }) => field === "mCurrentFocus",
        )
      : [];
  const apps =
    contexts.length === 1
      ? contexts[0]!.declarations.filter(({ field }) => field === "mFocusedApp")
      : [];
  const declared = contexts.some(({ declarations }) => declarations.length > 0);
  const summary = !declared
    ? "unavailable"
    : contexts.length === 1 && windows.length <= 1 && apps.length <= 1
      ? "single_context"
      : "ambiguous";
  return {
    focused_window:
      summary === "single_context" ? (windows[0]?.value ?? null) : null,
    focused_app: summary === "single_context" ? (apps[0]?.value ?? null) : null,
    focus_summary: summary,
    focus_contexts: contexts,
    observed_lines: observedLines,
  };
};

export interface AdbPackageDetails {
  readonly versionName: string | null;
  /** Signed 64-bit long version code exactly as Package Manager prints it. */
  readonly versionCode: string | null;
  readonly firstInstallTime: string | null;
  readonly lastUpdateTime: string | null;
  readonly installerPackageName: string | null;
  readonly userId: number | null;
  readonly pkgFlags: string | null;
  readonly requestedPermissions: number | null;
  readonly numericIssues: AdbPackageNumericIssues;
}

const DETAIL_LINE = /^\s+([A-Za-z][A-Za-z0-9_]*)=(.*)$/u;

/**
 * Package Manager prints its `String` fields by concatenation, so an absent
 * `installerPackageName` appears as the literal text `null`
 * (morluto/rea#3943). No installer can be named "null", so an empty value or
 * that sentinel is the absence of the fact and becomes the nullable result's
 * null. `versionName` keeps the printed text: a manifest may declare the
 * string "null" on purpose, and the parser cannot tell the two apart.
 */
const absentInstallerOrName = (value: string): string | null =>
  value === "" || value === "null" ? null : value;

/**
 * Project `dumpsys package PACKAGE` output. Only the listed fields are
 * extracted; the input is version-dependent and everything else is ignored
 * by design rather than guessed.
 */
export const parseDumpsysPackageOutput = (
  stdout: string,
): AdbPackageDetails => {
  const details: {
    versionName: string | null;
    versionCode: string | null;
    firstInstallTime: string | null;
    lastUpdateTime: string | null;
    installerPackageName: string | null;
    userId: number | null;
    pkgFlags: string | null;
  } = {
    versionName: null,
    versionCode: null,
    firstInstallTime: null,
    lastUpdateTime: null,
    installerPackageName: null,
    userId: null,
    pkgFlags: null,
  };
  const issues =
    collectNumericIssues<AdbPackageNumericIssues["sample"][number]>();
  let permissionsIndent: number | null = null;
  let hasPermissionsSection = false;
  let permissions = 0;
  let parsedPackageAvailable: boolean | null = null;
  for (const line of stdout.split(/\r?\n/u)) {
    // Hidden system packages describe a separate section, not the requested package.
    if (/^\s*Hidden system packages:\s*$/u.test(line)) break;
    const permissionsHeader = /^(\s*)requested permissions:\s*$/u.exec(line);
    if (permissionsHeader !== null) {
      hasPermissionsSection = true;
      permissionsIndent = permissionsHeader[1]!.length;
      continue;
    }
    if (permissionsIndent !== null) {
      const indentation = /^\s*/u.exec(line)![0].length;
      if (line.trim() !== "" && indentation > permissionsIndent) {
        // Android 10 and 11 may append ": restricted=true" to a row. The
        // section is indentation-delimited; permission strings are arbitrary.
        permissions += 1;
        continue;
      }
      if (line.trim() === "" && indentation > permissionsIndent) continue;
      permissionsIndent = null;
    }
    const match = DETAIL_LINE.exec(line);
    if (match === null) continue;
    const key = match[1]!;
    // versionName is an arbitrary manifest string, printed verbatim by AOSP.
    // Only the fields with their own structured grammar are normalized below.
    const rawValue = match[2]!;
    const value = rawValue.trim();
    if (key === "pkg" && parsedPackageAvailable === null) {
      if (value === "null") parsedPackageAvailable = false;
      else if (value.startsWith("Package{") && value.endsWith("}"))
        parsedPackageAvailable = true;
    } else if (key === "versionName" && details.versionName === null)
      details.versionName = rawValue;
    else if (key === "versionCode" && details.versionCode === null) {
      const parsed = /^(-?\d+)/u.exec(value);
      if (parsed !== null) details.versionCode = parsed[1]!;
    } else if (key === "firstInstallTime" && details.firstInstallTime === null)
      details.firstInstallTime = value === "" ? null : value;
    else if (key === "lastUpdateTime" && details.lastUpdateTime === null)
      details.lastUpdateTime = value === "" ? null : value;
    else if (
      key === "installerPackageName" &&
      details.installerPackageName === null
    )
      details.installerPackageName = absentInstallerOrName(value);
    else if (key === "userId" || key === "appId") {
      const parsed = /^(\d+)/u.exec(value);
      const admitted = parsed === null ? null : safeInteger(parsed[1]!);
      if (admitted === null)
        issues.add({
          command: "dumpsys package",
          field: "user_id",
          reason: parsed === null ? "invalid_format" : "unsafe_integer",
          raw_line: line,
        });
      else if (details.userId === null) details.userId = admitted;
    } else if (key === "pkgFlags" && details.pkgFlags === null)
      details.pkgFlags = value === "" ? null : value;
  }
  // `dumpsys` omits this section both for known-empty inventories and when
  // Package Manager has no parsed package; only the former is a known zero.
  const requestedPermissions =
    parsedPackageAvailable === false
      ? null
      : hasPermissionsSection
        ? permissions
        : parsedPackageAvailable === true
          ? 0
          : null;
  return { ...details, requestedPermissions, numericIssues: issues.facts() };
};

/**
 * Parse `settings get` output. Android prints the literal string `null` for
 * absent keys; that is reported as a device-side null observation.
 */
export const parseSettingsGetOutput = (
  stdout: string,
): {
  value: string | null;
  deviceReportedNull: boolean;
} => {
  const trimmed = stdout.replace(/\r?\n$/u, "");
  if (trimmed === "null") return { value: null, deviceReportedNull: true };
  return { value: trimmed, deviceReportedNull: false };
};

/** Parse the host-side completion line from `adb bugreport`. */
export const parseBugreportCopiedPath = (stdout: string): string | null => {
  const match = /^Bug report copied to (.+)\r?$/mu.exec(stdout.trim());
  return match === null ? null : match[1]!;
};

/**
 * Read the digest from one `sha256sum FILE` line, or null when the output
 * names none. GNU sha256sum starts the line with a backslash when it escaped
 * the echoed name; the digest itself is never escaped.
 */
export const parseSha256sumOutput = (stdout: string): string | null =>
  /^\\?([a-f0-9]{64}) [ *]/u.exec(stdout)?.[1] ?? null;

/** Read the device's `Failure [REASON]` verdict from package-change output. */
export const packageChangeFailureReason = (output: string): string | null =>
  /Failure \[([^\]]+)\]/u.exec(output)?.[1] ?? null;

/**
 * Parse `adb install`/`adb uninstall` output. adb can print `Failure [...]`
 * with a zero exit code, so the text decides, not the exit status.
 */
export const parsePackageChangeOutput = (
  stdout: string,
):
  | { readonly status: "success" | "unknown"; readonly reason: null }
  | { readonly status: "failure"; readonly reason: string } => {
  const text = stdout.trim();
  const failure = packageChangeFailureReason(text);
  if (failure !== null) return { status: "failure", reason: failure };
  if (/^Success$/mu.test(text)) return { status: "success", reason: null };
  return { status: "unknown", reason: null };
};

/**
 * Parse `cmd package resolve-activity --brief` output: the component is the
 * last non-empty line.
 */
export const parseResolveActivityOutput = (stdout: string): string | null => {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !/^No activity found$/iu.test(line));
  return lines.length === 0 ? null : lines[lines.length - 1]!;
};

/** Parsed facts and verdict from the full `am start -W` report. */
export interface AmStartOutput {
  readonly status: "started" | "refused";
  readonly startedActivity: string | null;
  readonly activity: string | null;
  readonly reportedStatus: string | null;
  readonly reason: string | null;
}

/**
 * Parse the complete `am start -W` report. `Starting:` records an attempt;
 * hard errors and any non-ok Activity Manager status determine the verdict.
 */
export const parseAmStartOutput = (
  stdout: string,
  stderr = "",
): AmStartOutput => {
  const normalizedStdout = stdout.replaceAll("\r\n", "\n");
  const starting = /^Starting:[ \t]+Intent[ \t]*\{(.*)\}[ \t]*$/mu.exec(
    normalizedStdout,
  );
  const startedActivity = starting?.[1]?.trim() ?? null;
  const activityMatch = /^Activity:[ \t]*(.*)$/mu.exec(normalizedStdout);
  const activity = activityMatch?.[1]?.trim() || null;
  const statuses = [...normalizedStdout.matchAll(/^Status:[ \t]*(.*)$/gmu)].map(
    (match) => match[1]!.trim(),
  );
  const nonOkStatus = statuses.find((status) => status.toLowerCase() !== "ok");
  const reportedStatus = nonOkStatus ?? statuses[0] ?? null;
  const errorLines = [normalizedStdout, stderr.replaceAll("\r\n", "\n")]
    .flatMap((stream) => stream.split("\n"))
    .map((line) => line.trim())
    .map((line) => ({
      line,
      prefixedMatch: /^(?:Error|Exception)(?::|\b)(.*)$/iu.exec(line),
      throwable:
        /^(?:(?:[A-Za-z_$][A-Za-z0-9_$]*\.)+(?:[A-Za-z_$][A-Za-z0-9_$]*(?:Exception|Error)|Exception|Error)|[A-Za-z_$][A-Za-z0-9_$]*(?:Exception|Error))(?::\s*.*)?$/u.test(
          line,
        ),
      genericHeader:
        /^(?:Error\s+type\s+\d+|Exception\s+occurred\s+while\s+executing\b.*)$/iu.test(
          line,
        ),
    }));

  // Prefer the underlying Java throwable over the generic Activity Manager
  // wrapper, regardless of which line or stream printed it first.
  const error =
    errorLines.find(({ throwable }) => throwable) ??
    errorLines.find(
      ({ prefixedMatch, genericHeader }) =>
        prefixedMatch !== null && !genericHeader,
    ) ??
    errorLines.find(({ prefixedMatch }) => prefixedMatch !== null);

  const errorReason =
    error === undefined
      ? null
      : error.throwable
        ? error.line
        : error.prefixedMatch?.[1]?.trim() || error.line;
  const statusReason =
    nonOkStatus === ""
      ? "am start reported an empty status"
      : nonOkStatus === undefined
        ? null
        : `am start reported status: ${nonOkStatus}`;
  const reason =
    errorReason ??
    statusReason ??
    (/^Warning:/mu.test(normalizedStdout.trim())
      ? normalizedStdout.trim().slice(0, 512)
      : null);
  if (errorReason !== null || nonOkStatus !== undefined)
    return {
      status: "refused",
      startedActivity,
      activity,
      reportedStatus,
      reason: reason ?? "am start did not report a successful launch",
    };
  if (startedActivity !== null)
    return {
      status: "started",
      startedActivity,
      activity,
      reportedStatus,
      reason: null,
    };
  const text = `${normalizedStdout}\n${stderr.replaceAll("\r\n", "\n")}`.trim();
  return {
    status: "refused",
    startedActivity,
    activity,
    reportedStatus,
    reason:
      reason ??
      (text === "" ? "am start returned no activity" : text.slice(0, 512)),
  };
};
