import { PacketCaptureService } from "../application/captures/PacketCaptureService.js";
import {
  TsharkCaptureProvider,
  tsharkHostSupported,
} from "../captures/TsharkCaptureProvider.js";

export { tsharkHostSupported };

export const createPacketCaptureService = (
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): PacketCaptureService =>
  new PacketCaptureService(new TsharkCaptureProvider(environment));
