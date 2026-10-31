import { GoBinaryService } from "../application/go/GoBinaryService.js";
import { GoBinaryProvider } from "../go/GoBinaryProvider.js";

/** Compose bundled offline inspection without acquiring a toolchain or starting any process. */
export const createGoBinaryService = (): GoBinaryService =>
  new GoBinaryService(new GoBinaryProvider());
