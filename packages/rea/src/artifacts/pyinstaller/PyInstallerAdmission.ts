import type { StableRegularFileDescriptor } from "../../filesystem/RegularFile.js";
import type { PyInstallerCookie } from "./CArchiveLayout.js";
import type { CarrierPathDialect } from "./CArchiveMembers.js";

/** Validated cookie facts borrowed with the descriptor that produced them. */
export interface PyInstallerAdmission {
  readonly kind: "pyinstaller";
  readonly source: StableRegularFileDescriptor;
  readonly cookie: PyInstallerCookie;
  /** Carrier interpretation retained by the classifier that admitted this source. */
  readonly carrierPathDialect?: CarrierPathDialect;
}
