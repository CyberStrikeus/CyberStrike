/** Ghidra build whose bridge behavior this REA release verifies. */
export const SUPPORTED_GHIDRA_VERSION = "12.1.4";
/** Verified JDK major; admission uses the installation's declared bounds. */
export const SUPPORTED_GHIDRA_JAVA_MAJOR = 21;

/** Numeric Ghidra release read from `application.version`. */
interface GhidraReleaseVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly suffix: string;
}

/** How an observed Ghidra release relates to this adapter's bridge. */
type GhidraReleaseCompatibility =
  | {
      readonly status: "verified";
      readonly version: GhidraReleaseVersion;
      readonly raw: string;
    }
  | {
      readonly status: "compatible";
      readonly version: GhidraReleaseVersion;
      readonly raw: string;
    }
  | {
      readonly status: "unsupported";
      readonly version: GhidraReleaseVersion;
      readonly raw: string;
    }
  | { readonly status: "unresolved"; readonly raw: string | null };

const GHIDRA_RELEASE_PATTERN = /^(\d+)\.(\d+)(?:\.(\d+))?([-+].*)?$/u;

/** Classify `application.version` against the verified release line. */
export const ghidraReleaseCompatibility = (
  raw: string | null | undefined,
): GhidraReleaseCompatibility => {
  if (raw === null || raw === undefined)
    return { status: "unresolved", raw: null };
  const version = parseGhidraRelease(raw);
  if (version === undefined) return { status: "unresolved", raw };
  if (raw === SUPPORTED_GHIDRA_VERSION)
    return { status: "verified", version, raw };
  const verified = verifiedGhidraRelease();
  // Admit the verified line and anything newer on this major: the observed
  // version is reported on the provider identity and sessions run with the
  // unverified-build limitation, so a newer release like 12.2 is usable
  // while the verified build stays pinned.
  return version.major === verified.major && version.minor >= verified.minor
    ? { status: "compatible", version, raw }
    : { status: "unsupported", version, raw };
};

/**
 * Limitation recorded when a session runs a compatible build other than the
 * verified release. The observed version stays on the provider identity.
 */
export const unverifiedGhidraBuildLimitation = (
  providerVersion: string,
): string | undefined => {
  const compatibility = ghidraReleaseCompatibility(providerVersion);
  if (compatibility.status !== "compatible") return undefined;
  return `This session uses Ghidra ${providerVersion}. The bridge is verified against ${SUPPORTED_GHIDRA_VERSION}; other ${ghidraReleaseLine()} builds are accepted and the observed version is reported.`;
};

/** Accepted release floor on this major, such as `12.x (>=12.1)`. */
export const ghidraReleaseLine = (): string => {
  const verified = verifiedGhidraRelease();
  return `${String(verified.major)}.x (>=${String(verified.major)}.${String(verified.minor)})`;
};

/** Detail for the installation version check, including the accepted line. */
export const ghidraVersionDetail = (raw: string | null | undefined): string => {
  const compatibility = ghidraReleaseCompatibility(raw);
  switch (compatibility.status) {
    case "unresolved":
      return compatibility.raw ?? "unknown";
    case "verified":
      return compatibility.raw;
    case "compatible":
      return `${compatibility.raw}; compatible ${ghidraReleaseLine()} release (verified build ${SUPPORTED_GHIDRA_VERSION})`;
    case "unsupported":
      return `${compatibility.raw}; accepted releases are ${ghidraReleaseLine()} (verified build ${SUPPORTED_GHIDRA_VERSION})`;
    default: {
      const unreachable: never = compatibility;
      return unreachable;
    }
  }
};

/** Whether this release line can run the packaged bridge. */
export const ghidraReleaseAccepted = (
  raw: string | null | undefined,
): boolean => {
  const status = ghidraReleaseCompatibility(raw).status;
  return status === "verified" || status === "compatible";
};

const verifiedGhidraRelease = (): GhidraReleaseVersion => {
  const version = parseGhidraRelease(SUPPORTED_GHIDRA_VERSION);
  if (version === undefined)
    throw new TypeError(
      `SUPPORTED_GHIDRA_VERSION ${SUPPORTED_GHIDRA_VERSION} is not a Ghidra release`,
    );
  return version;
};

const parseGhidraRelease = (raw: string): GhidraReleaseVersion | undefined => {
  const match = GHIDRA_RELEASE_PATTERN.exec(raw);
  const major = integerGroup(match?.[1]);
  const minor = integerGroup(match?.[2]);
  if (match === null || major === undefined || minor === undefined)
    return undefined;
  const patch = match[3] === undefined ? 0 : integerGroup(match[3]);
  return patch === undefined
    ? undefined
    : { major, minor, patch, suffix: match[4] ?? "" };
};

/**
 * The version spelling Ghidra's `ApplicationVersion.toString` uses in its
 * settings directory: numeric components normalized, a zero patch and an
 * empty tag omitted. A build-metadata (`+`) suffix has no such spelling.
 */
export const ghidraConfigurationVersion = (raw: string): string | undefined => {
  const version = parseGhidraRelease(raw);
  if (version === undefined || version.suffix.startsWith("+")) return undefined;
  const patch = version.patch === 0 ? "" : `.${String(version.patch)}`;
  const suffix = version.suffix === "-" ? "" : version.suffix;
  return `${String(version.major)}.${String(version.minor)}${patch}${suffix}`;
};

const integerGroup = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};
