import {
  CAPTURE_DECODER_SEMI_SPACE_MIB,
  DEFAULT_CAPTURE_DECODER_OLD_GENERATION_MIB,
} from "../../domain/analysisResourceLimits.js";
import { javaScriptRuntime } from "../../domain/runtimeVersion.js";
import { javaScriptWorkerMemoryLimitBytes } from "../../process/JavaScriptWorkerMemoryLimit.js";

/** Upstream packages and owned schema corrections for offline HAR decoding. */
export const HAR_CAPTURE_PROVIDER_IDENTITY = {
  id: "har-schema/lossless-json",
  name: "REA HAR capture adapter",
  version:
    "har-schema@2.0.0;har-schema-corrections@1;jsonc-parser@3.3.1;lossless-json@4.3.1",
} as const;

/**
 * Default V8 heap settings for the owned Node capture decoder process.
 * The old generation is `REA_CAPTURE_DECODER_OLD_GENERATION_MIB`; the
 * semi-space stays fixed.
 */
export const NODE_CAPTURE_HEAP_LIMITS = {
  oldGenerationMiB: DEFAULT_CAPTURE_DECODER_OLD_GENERATION_MIB,
  semiSpaceMiB: CAPTURE_DECODER_SEMI_SPACE_MIB,
} as const;

/** Windows Job Object commit limit for one resolved old-generation budget. */
export const captureDecoderProcessMemoryLimitBytes = (
  oldGenerationMiB: number,
): number | null => javaScriptWorkerMemoryLimitBytes(oldGenerationMiB);

/** The Node capture decoder runs on this executable; Bun accepts but ignores V8 heap flags. */
export const NODE_CAPTURE_HEAP_ENFORCED =
  javaScriptRuntime(process.versions).id === "node";

/** Commit limit for the default heap. A configured heap uses `captureDecoderProcessMemoryLimitBytes`. */
export const NODE_CAPTURE_PROCESS_MEMORY_LIMIT_BYTES =
  captureDecoderProcessMemoryLimitBytes(
    NODE_CAPTURE_HEAP_LIMITS.oldGenerationMiB,
  );

/** Native executable profile verified with unchanged mitmproxy raw-state decoding. */
export const MITMPROXY_CAPTURE_PROVIDER_IDENTITY = {
  id: "mitmproxy-native-tnetstring",
  name: "REA offline native mitmproxy adapter",
  version: "12.2.3",
} as const;

/** Native SAZ member decoding with the existing ZIP and XML package profiles. */
export const SAZ_CAPTURE_PROVIDER_IDENTITY = {
  id: "fiddler-saz",
  name: "REA Fiddler SAZ capture adapter",
  version: "1;zip.js@2.15.0;xmldom@0.9.12",
} as const;

/** Fixed offline interpretation profile, not an authenticated producer claim. */
export const QLOG_CAPTURE_PROVIDER_IDENTITY = {
  id: "aioquic-qlog-json",
  name: "REA aioquic qlog capture adapter",
  version:
    "aioquic-profile@1.5.0;qlog@0.3;jsonc-parser@3.3.1;lossless-json@4.3.1",
} as const;
