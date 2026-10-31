import { ElectronFuseService } from "../application/electron/ElectronFuseService.js";
import { ElectronFuseProvider } from "../electron/ElectronFuseProvider.js";

/** Compose read-only fuse inspection without a runtime, network, or fuse edit. */
export const createElectronFuseService = (): ElectronFuseService =>
  new ElectronFuseService(new ElectronFuseProvider());
