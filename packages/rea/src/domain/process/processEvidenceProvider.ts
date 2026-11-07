import type { EvidenceProvider } from "../evidence.js";

/** Canonical provider identity for controlled process capture Evidence. */
export const PROCESS_PROVIDER = {
  id: "rea-process",
  name: "REA process capture",
  version: "3",
} as const;

/** Admit current and previously emitted names for the same v3 process provider. */
export const isProcessEvidenceProvider = (
  provider: EvidenceProvider,
): boolean =>
  provider.id === PROCESS_PROVIDER.id &&
  provider.version === PROCESS_PROVIDER.version &&
  (provider.name === PROCESS_PROVIDER.name ||
    provider.name === "REA deterministic process harness");
