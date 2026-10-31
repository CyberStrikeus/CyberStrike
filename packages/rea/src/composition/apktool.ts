import type { ApktoolResourceAnalysisPort } from "../application/apktool/ApktoolResourceAnalysisPort.js";
import { ApktoolProvider } from "../apktool/ApktoolProvider.js";

/** Construct one Apktool provider bound to the caller-selected launcher. */
export const createApktoolResourceAnalysisProvider = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ApktoolResourceAnalysisPort => new ApktoolProvider({ environment });
