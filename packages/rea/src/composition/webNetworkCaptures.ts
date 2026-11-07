import { WebNetworkCaptureService } from "../application/WebNetworkCaptureService.js";
import { HistoricalCaptureDecoder } from "../browser/history/HistoricalCaptureDecoder.js";
import { NodeCaptureAdapter } from "../browser/history/NodeCaptureAdapter.js";
import { MitmproxyCaptureAdapter } from "../browser/history/MitmproxyCaptureAdapter.js";
import type { AnalysisSettingsReader } from "../domain/analysisSettings.js";
import { runtimeCaptureDecoderHeap } from "../config/runtimeAnalysisSettings.js";

/** Compose offline format adapters without import-time reads, installation or process startup. */
export const createWebNetworkCaptureService = (
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
  settings?: AnalysisSettingsReader,
): WebNetworkCaptureService => {
  const heap = runtimeCaptureDecoderHeap(environment, settings);
  return new WebNetworkCaptureService(
    new HistoricalCaptureDecoder(
      [
        new NodeCaptureAdapter("har", environment, heap),
        new NodeCaptureAdapter("saz", environment, heap),
        new NodeCaptureAdapter("qlog", environment, heap),
        new MitmproxyCaptureAdapter(environment),
      ],
      environment,
    ),
  );
};
