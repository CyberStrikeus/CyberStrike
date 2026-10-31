import type { AnalysisSettingsReader } from "../domain/analysisSettings.js";
import type { AndroidAnalysisPort } from "../application/android/AndroidAnalysisPort.js";
import type { JadxLauncher } from "../android/JadxMcpTransport.js";
import { JadxProvider } from "../android/JadxProvider.js";

/** Construct one APK provider with its own queue and cleanup-failure state. */
export const createAndroidAnalysisProvider = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
  launcher?: JadxLauncher,
  settings?: AnalysisSettingsReader,
): AndroidAnalysisPort => new JadxProvider(environment, launcher, settings);
