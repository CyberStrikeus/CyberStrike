import { fileURLToPath } from "node:url";
import type { HistoricalCaptureFormatAdapter } from "./HistoricalCaptureFormatAdapter.js";
import {
  DEFAULT_CAPTURE_DECODER_HEAP,
  resolveCaptureDecoderHeap,
  type CaptureDecoderHeap,
} from "../../config/captureDecoderHeap.js";
import { CAPTURE_DECODER_SEMI_SPACE_MIB } from "../../domain/analysisResourceLimits.js";
import {
  NODE_CAPTURE_HEAP_ENFORCED,
  HAR_CAPTURE_PROVIDER_IDENTITY,
  SAZ_CAPTURE_PROVIDER_IDENTITY,
  QLOG_CAPTURE_PROVIDER_IDENTITY,
  captureDecoderProcessMemoryLimitBytes,
} from "./CaptureRelease.js";
import { AnalysisCapabilityUnavailableError } from "../../domain/analysisErrorCore.js";

/** Package-backed capture decoders share one bounded offline Node process profile. */
export class NodeCaptureAdapter implements HistoricalCaptureFormatAdapter {
  readonly identity;
  readonly limitations;
  readonly heap: CaptureDecoderHeap;
  /**
   * `environment` is the selected startup environment. Omitted means the
   * default heap, not ambient `process.env`. An invalid setting is refused.
   * `heap` is an already parsed fact and is not read from `environment` again.
   */
  constructor(
    readonly format: "har" | "saz" | "qlog",
    environment?: Readonly<Record<string, string | undefined>>,
    heap?: CaptureDecoderHeap,
  ) {
    this.heap =
      heap ??
      (environment === undefined
        ? DEFAULT_CAPTURE_DECODER_HEAP
        : resolveCaptureDecoderHeap(environment));
    this.identity =
      format === "har"
        ? HAR_CAPTURE_PROVIDER_IDENTITY
        : format === "saz"
          ? SAZ_CAPTURE_PROVIDER_IDENTITY
          : QLOG_CAPTURE_PROVIDER_IDENTITY;
    this.limitations =
      format === "saz"
        ? [
            "SAZ ordinals follow first session-member occurrence in ZIP directory order, not chronology or numeric session ID.",
            "HTTP fields use byte-preserving Latin-1 text; start-line separators and header delimiters are not projected. Bodies retain stored bytes without transfer/content decoding. Absent and zero-byte HTTP members are null, distinct from empty bodies.",
            "XML preserves node order and attribute/text values, not its original byte serialization. WebSocket and gRPC members retain opaque message-file bytes, not decoded protocol events.",
            "Non-session archive members are inventoried but their content is not decoded.",
          ]
        : [];
  }
  async command(requestPath: string) {
    const memoryLimitBytes = captureDecoderProcessMemoryLimitBytes(
      this.heap.oldGenerationMiB,
    );
    if (
      this.format !== "har" &&
      !NODE_CAPTURE_HEAP_ENFORCED &&
      memoryLimitBytes === null
    )
      throw new AnalysisCapabilityUnavailableError(
        this.identity.id,
        "inspect_web_network_capture",
        `${this.format} decoding requires an enforced decoder memory limit. Run REA with Node.js on this host.`,
      );
    return {
      command: process.execPath,
      arguments: [
        `--max-old-space-size=${String(this.heap.oldGenerationMiB)}`,
        `--max-semi-space-size=${String(CAPTURE_DECODER_SEMI_SPACE_MIB)}`,
        "--v8-pool-size=1",
        "--single-threaded",
        fileURLToPath(new URL("./NodeCaptureProcess.js", import.meta.url)),
        requestPath,
        this.format,
      ],
      ...(memoryLimitBytes === null ? {} : { memoryLimitBytes }),
    };
  }
}
