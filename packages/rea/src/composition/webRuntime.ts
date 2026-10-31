import { WebRuntimeService } from "../application/WebRuntimeService.js";
import { CdpWebRuntimeProvider } from "../browser/execution/CdpWebRuntimeProvider.js";

/** Construct the live attribution workflow without opening a browser connection. */
export const createWebRuntimeService = (): WebRuntimeService =>
  new WebRuntimeService(new CdpWebRuntimeProvider());
