import {
  HEX_RECORD_ENCODING_LABELS,
  createHexRecordDecoder,
  type HexRecordImage,
} from "../domain/firmware/hexRecords.js";
import type { HexRecordEncoding } from "../domain/firmware/hexRecordSyntax.js";
import {
  DecodedRegionArtifactReader,
  regionFileName,
  type RegionDecoding,
} from "./DecodedRegionArtifactReader.js";
import type { StableRegularFileDescriptor } from "../filesystem/RegularFile.js";

const hexRecordRegions = (
  format: HexRecordEncoding,
): RegionDecoding<HexRecordImage> => ({
  label: HEX_RECORD_ENCODING_LABELS[format],
  keyPrefix: "hex-records",
  createDecoder: (fileBytes) => createHexRecordDecoder(format, fileBytes),
  describe: (image) => ({
    metadata: image.metadata,
    regions: image.regions.map((region) => ({
      path: regionFileName(region.start, region.end),
      byteOffset: null,
      formatMetadata: {
        kind: "hex-record-region",
        start_address: region.start,
        end_address: region.end,
        length: region.bytes.length,
        record_count: region.recordCount,
        first_line: region.firstLine,
        last_line: region.lastLine,
      },
      bytes: region.bytes,
    })),
    ...(image.terminated && image.limitations.length === 0
      ? {}
      : {
          coverage: {
            status: image.terminated ? "complete" : "unknown",
            limitations: image.limitations,
          },
        }),
  }),
});

/** Decode Intel HEX or S-record text into address-contiguous region entries. */
export class HexRecordArtifactReader extends DecodedRegionArtifactReader<HexRecordImage> {
  constructor(
    path: string,
    format: HexRecordEncoding,
    admitted?: StableRegularFileDescriptor,
  ) {
    super(path, format, hexRecordRegions(format), admitted);
  }
}
