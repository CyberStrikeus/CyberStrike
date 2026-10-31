import {
  MAX_NODE_TIMER_DELAY_MS,
  MAX_GHIDRA_DECOMPILE_TIMEOUT_SECONDS,
} from "../domain/analysisResourceLimits.js";
import { z } from "zod";

/** Default deadline for Darwin ownership-helper `swiftc` compilation. */
/** Fresh Swift SDK cache took ~88s on the supported Intel macOS VM. */
export const DEFAULT_SWIFTC_COMPILE_TIMEOUT_MS = 120_000;

/** Parse REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS; absent keeps Ghidra decompiles unbounded. */
export const ghidraDecompileTimeoutSchema = z
  .string()
  .regex(/^[1-9]\d*$/u, "must be a positive decimal integer")
  .transform(Number)
  .pipe(z.number().int().min(1).max(MAX_GHIDRA_DECOMPILE_TIMEOUT_SECONDS));

/** Parse the optional setting without reading the ambient process environment. */
export const providerStartupTimeoutSchema = z
  .string()
  .regex(/^[1-9]\d*$/u, "must be a positive decimal integer")
  .transform(Number)
  .pipe(z.int().min(1).max(MAX_NODE_TIMER_DELAY_MS));
