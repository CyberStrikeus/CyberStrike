import {
  BinaryFormatFailure,
  type BinaryContainer,
} from "./BinaryContainer.js";
import {
  classifyFatContainerIdentity,
  readFatContainerHeader,
  readFatHeaderPrefix,
  readMachoHeaderPrefixFacts,
} from "../../domain/apple/machoContainer.js";
import { readElfImage } from "./ElfImage.js";
import { readPeImage } from "./PeImage.js";
import { readMachoImage } from "./MachoImage.js";

/** Identify an ELF, PE, or thin Mach-O image and its file sections. */
export const readBinaryContainer = (bytes: Buffer): BinaryContainer => {
  if (bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])))
    return readElfImage(bytes);
  if (bytes.subarray(0, 2).equals(Buffer.from("MZ"))) return readPeImage(bytes);
  if (bytes.length >= 4) {
    const fatPrefix = readFatHeaderPrefix(bytes);
    if (fatPrefix.state === "incomplete" || fatPrefix.state === "parsed") {
      const fatHeader = readFatContainerHeader(bytes, bytes.length);
      if (fatHeader.state === "malformed")
        throw new BinaryFormatFailure("malformed", fatHeader.reason);
      const identity =
        fatHeader.state === "parsed"
          ? classifyFatContainerIdentity(fatHeader, (offset) => {
              if (offset >= bytes.length) return undefined;
              if (offset + 4 > bytes.length) return null;
              return bytes.readUInt32BE(offset);
            })
          : undefined;
      // An invalid FAT-shaped table is not proof of a Mach-O container: JVM
      // constant-pool bytes can share both the magic and a known CPU value.
      const confirmedFatMachO = identity?.state === "mach-o";
      if (confirmedFatMachO)
        throw new BinaryFormatFailure(
          "unsupported",
          "Universal/fat Mach-O containers require selecting a thin slice",
        );
    }
    if (readMachoHeaderPrefixFacts(bytes).format !== null)
      return readMachoImage(bytes);
  }
  throw new BinaryFormatFailure(
    "unsupported",
    "Only ELF, PE, and thin Mach-O native images are supported",
  );
};
