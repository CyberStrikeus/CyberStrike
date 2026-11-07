import { SignalRecordingService } from "../application/signals/SignalRecordingService.js";
import {
  SigrokRecordingProvider,
  sigrokHostSupported,
} from "../signals/SigrokRecordingProvider.js";

export { sigrokHostSupported };

export const createSignalRecordingService = (
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): SignalRecordingService =>
  new SignalRecordingService(new SigrokRecordingProvider(environment));
