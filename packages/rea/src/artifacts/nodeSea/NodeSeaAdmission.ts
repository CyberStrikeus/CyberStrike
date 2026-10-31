import type { StableRegularFileDescriptor } from "../../filesystem/RegularFile.js";
import type { DecodedNodeSeaBlob } from "./NodeSeaBlob.js";
import type { NodeSeaLocation } from "./NodeSeaLocation.js";

/** Validated blob facts borrowed with the exact descriptor that produced them. */
export interface NodeSeaAdmission {
  readonly kind: "node-sea";
  readonly source: StableRegularFileDescriptor;
  readonly location: NodeSeaLocation;
  readonly decoded: DecodedNodeSeaBlob;
}
