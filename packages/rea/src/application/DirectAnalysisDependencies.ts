import type { AppConfig } from "../config/types.js";
import type { parseConfig } from "../config/parseConfig.js";
import type { Logger } from "pino";
import type { BinarySession } from "./binary/BinarySession.js";

/** Configuration and one-shot session factories supplied by the production boundary. */
export interface DirectAnalysisDependencies {
  /** Read the caller-selected configuration without consulting ambient state. */
  readonly readConfiguration: () => ReturnType<typeof parseConfig>;
  readonly createBinarySession: (
    config: AppConfig,
    logger: Logger,
  ) => BinarySession | Promise<BinarySession>;
  /** Prefer byte-backed dispatch inspection while preserving explicit selection. */
  readonly createNativeDispatchBinarySession: (
    config: AppConfig,
    logger: Logger,
  ) => BinarySession | Promise<BinarySession>;
  /** Create an artifact-only session without selecting native analysis engines. */
  readonly createArtifactBinarySession: () =>
    | BinarySession
    | Promise<BinarySession>;
  /** Create a native utility session without selecting deep analysis engines. */
  readonly createNativeBinarySession: () =>
    | BinarySession
    | Promise<BinarySession>;
  readonly createManagedBinarySession: () =>
    | BinarySession
    | Promise<BinarySession>;
}
