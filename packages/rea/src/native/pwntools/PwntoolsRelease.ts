import { DEFAULT_PWNTOOLS_TIMEOUT_MS } from "../../domain/native/nativeDeadlines.js";

/** Verified unchanged upstream profile for the Linux ELF adapter. */
export const PWNTOOLS_PROVIDER_IDENTITY = {
  id: "pwntools-elf",
  name: "REA pwntools ELF adapter",
  version: "pwntools@4.15.0;pyelftools@0.33;unicorn@2.1.2",
} as const;
/** Bridge-reserved status for MemoryError when no structured reply can be written. */
export const PWNTOOLS_MEMORY_FAILURE_EXIT = 75;
/** Bridge-reserved status for an observed EFBIG failure without a complete reply. */
export const PWNTOOLS_FILE_SIZE_FAILURE_EXIT = 76;

/**
 * Complete evidence budgets; address-space is separate from resident memory.
 * `timeoutMs` is the omitted `pwntools_timeout_ms`. cpuSeconds and the byte
 * allowances stay fixed.
 */
export const PWNTOOLS_LIMITS = {
  inputBytes: 32 * 1024 * 1024,
  outputBytes: 64 * 1024 * 1024,
  diagnosticBytes: 1024 * 1024,
  timeoutMs: DEFAULT_PWNTOOLS_TIMEOUT_MS,
  addressSpaceBytes: 3 * 1024 * 1024 * 1024,
  cpuSeconds: 30,
} as const;
