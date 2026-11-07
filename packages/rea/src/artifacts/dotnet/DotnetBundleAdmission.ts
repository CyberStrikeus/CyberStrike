import type { StableRegularFileDescriptor } from "../../filesystem/RegularFile.js";

/** The marker observation belongs to this unchanged, borrowed descriptor. */
export interface DotnetBundleAdmission {
  readonly kind: "dotnet-bundle";
  readonly source: StableRegularFileDescriptor;
  readonly headerOffset: number;
}
