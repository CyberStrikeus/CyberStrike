import type { AdbDeviceAnalysisPort } from "../application/adb/AdbDeviceAnalysisPort.js";
import { AdbProvider } from "../adb/AdbProvider.js";

/** Construct one ADB provider bound to the caller-selected binary. */
export const createAdbDeviceAnalysisProvider = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AdbDeviceAnalysisPort => new AdbProvider({ environment });
