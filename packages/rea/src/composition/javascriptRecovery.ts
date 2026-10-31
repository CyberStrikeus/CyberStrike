import type { JavaScriptRecoveryPort } from "../application/javascript/JavaScriptRecoveryPort.js";
import { WakaruProvider } from "../javascript/recovery/WakaruProvider.js";
import {
  wakaruHostSupported,
  type WakaruLauncher,
} from "../javascript/recovery/WakaruCommand.js";

export { wakaruHostSupported };

/** Construct optional recovery without acquiring tools, processes or workspaces. */
export const createJavaScriptRecoveryProvider = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
  launcher?: WakaruLauncher,
): JavaScriptRecoveryPort => new WakaruProvider(environment, launcher);
