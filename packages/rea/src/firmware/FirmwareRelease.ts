import { BOUNDED_PRODUCER_LIMITS } from "../process/LinuxResourceLimits.js";
import { FIRMWARE_TOOL_REQUIREMENTS } from "../contracts/firmware/firmwareToolRequirements.js";

/** Catalog identity for the verified Binwalk release. Evidence replaces version with the observed banner. */
export const BINWALK_PROVIDER_IDENTITY = {
  id: "binwalk",
  name: FIRMWARE_TOOL_REQUIREMENTS.binwalk.name,
  version: FIRMWARE_TOOL_REQUIREMENTS.binwalk.version,
} as const;
/** Catalog identity for explicit firmware extraction. */
export const UNBLOB_PROVIDER_IDENTITY = {
  id: "unblob",
  name: FIRMWARE_TOOL_REQUIREMENTS.unblob.name,
  version: FIRMWARE_TOOL_REQUIREMENTS.unblob.version,
} as const;

/** Resource policy for this Linux integration, not a claim of aggregate containment. */
export const FIRMWARE_LIMITS = {
  inputBytes: 128 * 1024 * 1024,
  reportBytes: 8 * 1024 * 1024,
  diagnosticBytes: 8 * 1024 * 1024,
  addressSpaceBytes: BOUNDED_PRODUCER_LIMITS.address_space_bytes,
  cpuSeconds: 120,
} as const;
