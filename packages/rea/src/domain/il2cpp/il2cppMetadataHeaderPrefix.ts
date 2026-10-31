import { IL2CPP_METADATA_MAGIC } from "./il2cppMetadata.js";

/** Parsed identity facts available before the complete IL2CPP header exists. */
export type Il2cppMetadataHeaderPrefix =
  | {
      readonly kind: "unavailable-magic";
      readonly magic: null;
      readonly rawVersion: null;
      readonly version: null;
    }
  | {
      readonly kind: "other-magic";
      readonly magic: number;
      readonly rawVersion: null;
      readonly version: null;
    }
  | {
      readonly kind: "il2cpp";
      readonly magic: typeof IL2CPP_METADATA_MAGIC;
      /** Unsigned bytes as stored; null means fewer than eight prefix bytes. */
      readonly rawVersion: number | null;
      /** The decoder's signed Int32 interpretation; null means unavailable. */
      readonly version: number | null;
    };

/** Parse the shared magic/version prefix once, retaining incomplete identity explicitly. */
export const observeIl2cppMetadataHeaderPrefix = (
  bytes: Uint8Array,
): Il2cppMetadataHeaderPrefix => {
  if (bytes.byteLength < 4)
    return {
      kind: "unavailable-magic",
      magic: null,
      rawVersion: null,
      version: null,
    };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== IL2CPP_METADATA_MAGIC)
    return {
      kind: "other-magic",
      magic,
      rawVersion: null,
      version: null,
    };
  if (bytes.byteLength < 8)
    return {
      kind: "il2cpp",
      magic: IL2CPP_METADATA_MAGIC,
      rawVersion: null,
      version: null,
    };
  return {
    kind: "il2cpp",
    magic: IL2CPP_METADATA_MAGIC,
    rawVersion: view.getUint32(4, true),
    version: view.getInt32(4, true),
  };
};
