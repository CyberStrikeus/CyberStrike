import { DesktopApplicationService } from "../application/artifacts/DesktopApplicationService.js";
import { DesktopApplicationReader } from "../artifacts/DesktopApplicationReader.js";

/** Use the existing artifact reader and Evidence identity without a deep provider. */
export const createDesktopApplicationService = (): DesktopApplicationService =>
  new DesktopApplicationService(new DesktopApplicationReader());
