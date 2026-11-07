import {
  createDfuSeDecoder,
  type DfuSeImage,
} from "../domain/firmware/dfuse.js";
import {
  DecodedRegionArtifactReader,
  regionFileName,
  type RegionDecoding,
} from "./DecodedRegionArtifactReader.js";
import type { StableRegularFileDescriptor } from "../filesystem/RegularFile.js";

const crcText = (value: number): string => value.toString(16).padStart(8, "0");

const dfuSeRegions: RegionDecoding<DfuSeImage> = {
  label: "DfuSe",
  keyPrefix: "dfuse",
  createDecoder: createDfuSeDecoder,
  describe: (image) => ({
    metadata: image.metadata,
    // Each element stays one region at its own file range, even beside others.
    regions: image.elements.map((element) => {
      const end = element.address + element.bytes.length - 1;
      return {
        path: `target-${String(element.targetIndex)}/element-${String(element.elementIndex)}-${regionFileName(element.address, end)}`,
        byteOffset: element.dataOffset,
        formatMetadata: {
          kind: "dfuse-element",
          target_index: element.targetIndex,
          alternate_setting: element.alternateSetting,
          target_name: element.targetName,
          element_index: element.elementIndex,
          start_address: element.address,
          end_address: end,
          length: element.bytes.length,
        },
        bytes: element.bytes,
      };
    }),
    ...(image.limitations.length === 0
      ? {}
      : { coverage: { status: "complete", limitations: image.limitations } }),
    containerIntegrity: {
      algorithm: "dfu-crc32",
      declared_crc32: crcText(image.metadata.suffix_crc),
      observed_crc32: crcText(image.metadata.computed_crc),
    },
  }),
};

/** Decode DfuSe targets into one entry per element, verifying the suffix CRC. */
export class DfuSeArtifactReader extends DecodedRegionArtifactReader<DfuSeImage> {
  constructor(path: string, admitted?: StableRegularFileDescriptor) {
    super(path, "dfuse", dfuSeRegions, admitted);
  }
}
