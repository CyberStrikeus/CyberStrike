import type { BrowserObservationPort } from "../application/BrowserObservationPort.js";
import { CdpBrowserProvider } from "../browser/CdpBrowserProvider.js";
import type { WebBundleAnalysisAdmission } from "../browser/IsolatedWebBundleAnalyzer.js";

/** Construct a fresh provider without opening a target or acquiring an engine. */
export const createBrowserObservationProvider = (
  admission?: WebBundleAnalysisAdmission,
): BrowserObservationPort => new CdpBrowserProvider(admission);
