/** Kuna release whose CLI and project layout REA verified; others report as unverified. */
export const KUNA_VERIFIED_VERSION = "1.986";

/** Stable provider ID shared by readiness, doctor and Evidence. */
export const KUNA_PROVIDER_ID = "kuna";

/** Remediation when `REA_KUNA_COMMAND` is missing or not an absolute path. */
export const KUNA_COMMAND_REMEDIATION = `Set REA_KUNA_COMMAND to the absolute path of a caller-supplied kuna executable (verified with ${KUNA_VERIFIED_VERSION}). REA does not download, install or update Kuna.`;

/** Remediation when the host cannot supervise a Kuna process tree. */
export const KUNA_UNSUPPORTED_HOST_REMEDIATION =
  "Use Linux or macOS for the Kuna provider. Windows process-tree ownership for Kuna is not verified.";

/** Remediation when `kuna --version` cannot establish the installed release. */
export const KUNA_VERSION_PROBE_REMEDIATION =
  "Run the selected executable with --version: it must exit promptly and print `kuna <major>.<minor>`.";
