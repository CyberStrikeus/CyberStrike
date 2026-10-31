import {
  parseGhidraJavaProperties,
  type GhidraJavaPropertiesCode,
} from "./GhidraJavaProperties.js";
import { ghidraConfigurationVersion } from "./GhidraReleasePolicy.js";

/** One Java major bound declared by `application.properties`. */
type GhidraJavaBound =
  | { readonly status: "absent" }
  | { readonly status: "major"; readonly major: number }
  | { readonly status: "unresolved"; readonly raw: string };

/** JDK majors this installation admits, after reading its own properties. */
export type GhidraJavaRequirement =
  | {
      readonly minimumMajor: number;
      readonly maximumMajor: number | null;
      readonly unresolved: null;
    }
  | { readonly unresolved: string };

/** Version and Java bounds read from one `application.properties` file. */
export interface GhidraApplicationProperties {
  readonly providerVersion: string | null;
  /** Release-owned private settings directory; null when its identity is unresolved. */
  readonly configurationDirectoryName: string | null;
  readonly javaMinimum: GhidraJavaBound;
  readonly javaMaximum: GhidraJavaBound;
  /** A malformed Java properties escape invalidates the entire file. */
  readonly parseError: GhidraJavaPropertiesCode | null;
}

/** Read the version and Java bounds Ghidra publishes for one installation. */
export const ghidraApplicationProperties = (
  content: string,
): GhidraApplicationProperties => {
  const parsed = parseGhidraJavaProperties(content);
  if (!parsed.ok)
    return {
      providerVersion: null,
      configurationDirectoryName: null,
      javaMinimum: { status: "unresolved", raw: parsed.error },
      javaMaximum: { status: "unresolved", raw: parsed.error },
      parseError: parsed.error,
    };
  const providerVersion = parsed.value.get("application.version");
  // ApplicationIdentifier removes Java's ASCII whitespace and uppercases the
  // release name. Derive only a single safe component for official Ghidra builds.
  const releaseName = parsed.value
    .get("application.release.name")
    ?.replaceAll(/[ \t\n\r\f\v]/gu, "")
    .toUpperCase();
  // providerVersion above remains the original evidence.
  const configurationVersion =
    providerVersion === undefined
      ? undefined
      : ghidraConfigurationVersion(providerVersion);
  const configurationDirectoryName =
    providerVersion !== undefined &&
    configurationVersion !== undefined &&
    releaseName !== undefined &&
    /^[A-Za-z0-9][A-Za-z0-9._+-]*$/u.test(providerVersion) &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(releaseName)
      ? `ghidra_${configurationVersion}_${releaseName}`
      : null;
  const minimum = parsed.value.get("application.java.min");
  const maximum = parsed.value.get("application.java.max");
  return {
    providerVersion: providerVersion ?? null,
    configurationDirectoryName,
    javaMinimum:
      minimum === undefined ? { status: "absent" } : parseJavaBound(minimum),
    // Ghidra uses an explicitly empty maximum to mean no upper bound.
    javaMaximum: parseJavaMaximum(maximum),
    parseError: null,
  };
};

/** Resolve JDK majors from `application.java.min` and `application.java.max`. */
export const ghidraJavaRequirement = (
  properties: GhidraApplicationProperties | undefined,
): GhidraJavaRequirement => {
  if (properties?.parseError !== null && properties?.parseError !== undefined)
    return unresolvedJavaRequirement(
      `application.properties parse failed: ${properties.parseError}`,
    );
  if (properties === undefined)
    return unresolvedJavaRequirement("application.properties is unavailable");
  const minimum = properties.javaMinimum;
  const maximum = properties.javaMaximum;
  if (minimum.status === "unresolved")
    return unresolvedJavaRequirement(`application.java.min=${minimum.raw}`);
  if (minimum.status === "absent")
    return unresolvedJavaRequirement("application.java.min is missing");
  if (maximum.status === "unresolved")
    return unresolvedJavaRequirement(`application.java.max=${maximum.raw}`);
  const minimumMajor = minimum.major;
  const maximumMajor = maximum.status === "major" ? maximum.major : null;
  if (maximumMajor !== null && maximumMajor < minimumMajor)
    return unresolvedJavaRequirement(
      `application.java.max=${String(maximumMajor)} is below application.java.min=${String(minimumMajor)}`,
    );
  return { minimumMajor, maximumMajor, unresolved: null };
};

/** Caller-facing description of one resolved or unreadable JDK range. */
export const ghidraJavaRangeLabel = (
  requirement: GhidraJavaRequirement,
): string => {
  if (requirement.unresolved !== null)
    return "a 64-bit full JDK matching the installation's declared Java bounds";
  if (requirement.maximumMajor === null)
    return `a 64-bit full JDK ${String(requirement.minimumMajor)} or newer`;
  if (requirement.maximumMajor === requirement.minimumMajor)
    return `a 64-bit full JDK ${String(requirement.minimumMajor)}`;
  return `a 64-bit full JDK ${String(requirement.minimumMajor)} through ${String(requirement.maximumMajor)}`;
};

/** Whether an observed JDK satisfies the installation's declared range. */
export const ghidraJavaMajorAccepted = (
  major: number,
  requirement: GhidraJavaRequirement,
): boolean =>
  requirement.unresolved === null &&
  major >= requirement.minimumMajor &&
  (requirement.maximumMajor === null || major <= requirement.maximumMajor);

const parseJavaBound = (raw: string): GhidraJavaBound => {
  const major = parseJavaInteger(raw);
  return major === undefined
    ? { status: "unresolved", raw }
    : { status: "major", major };
};

const parseJavaMaximum = (raw: string | undefined): GhidraJavaBound => {
  if (raw === undefined || raw === "") return { status: "absent" };
  const bound = parseJavaBound(raw);
  return bound.status === "major" && bound.major === 0
    ? { status: "absent" }
    : bound;
};

const parseJavaInteger = (raw: string): number | undefined => {
  let index = 0;
  let sign = 1;
  if (raw[index] === "+" || raw[index] === "-") {
    if (raw[index] === "-") sign = -1;
    index += 1;
  }
  if (index === raw.length) return undefined;
  const limit = sign < 0 ? 2_147_483_648 : 2_147_483_647;
  let value = 0;
  for (; index < raw.length; index += 1) {
    const character = raw[index];
    if (character === undefined) return undefined;
    const digit = javaDecimalDigit(character);
    if (digit === undefined) return undefined;
    if (value > Math.floor((limit - digit) / 10)) return undefined;
    value = value * 10 + digit;
  }
  return sign * value;
};

/** Match Integer.parseInt(charAt) for BMP Decimal_Number characters. */
const javaDecimalDigit = (character: string): number | undefined => {
  const code = character.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (!/^\p{Decimal_Number}$/u.test(character)) return undefined;
  let blockStart = code;
  while (
    blockStart > 0 &&
    /^\p{Decimal_Number}$/u.test(String.fromCharCode(blockStart - 1))
  )
    blockStart -= 1;
  return (code - blockStart) % 10;
};

const unresolvedJavaRequirement = (
  unresolved: string,
): GhidraJavaRequirement => ({
  unresolved,
});
