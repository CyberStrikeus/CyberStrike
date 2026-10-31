import type { FirmwareAnalysisPort } from "../application/firmware/FirmwareAnalysisPort.js";
import {
  firmwareHostSupported,
  type FirmwareLauncher,
} from "../firmware/FirmwareCommand.js";
import { FirmwareProvider } from "../firmware/FirmwareProvider.js";

export { firmwareHostSupported };

/** Construct one firmware provider without launching or acquiring an engine. */
export const createFirmwareAnalysisProvider = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
  launcher?: FirmwareLauncher,
): FirmwareAnalysisPort => new FirmwareProvider(environment, launcher);
