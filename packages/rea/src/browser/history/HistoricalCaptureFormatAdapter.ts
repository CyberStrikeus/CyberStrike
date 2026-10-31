import type { CaptureDecoderHeap } from "../../config/captureDecoderHeap.js";
import type { InspectWebNetworkCaptureInput } from "../../domain/webNetworkCapture.js";

/** Format-specific process profile keeps mature upstream code behind a replaceable adapter seam. */
export interface HistoricalCaptureFormatAdapter {
  readonly format: InspectWebNetworkCaptureInput["format"];
  readonly limitations?: readonly string[];
  /**
   * Parsed heap this adapter launches. Reports reuse this fact. Adapters that
   * do not launch the Node decoder omit it.
   */
  readonly heap?: CaptureDecoderHeap;
  readonly identity: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
  };
  /** Capture mutable configuration synchronously for one admitted operation. */
  snapshotConfiguration?(): HistoricalCaptureFormatAdapter;
  /** `memoryLimitBytes` requests an enforced commit limit for the decoder process tree. */
  command(
    requestPath: string,
    runtimePath: string,
  ): Promise<{
    command: string;
    arguments: readonly string[];
    memoryLimitBytes?: number;
  }>;
}
