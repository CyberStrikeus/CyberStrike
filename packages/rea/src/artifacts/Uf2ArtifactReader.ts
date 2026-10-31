import { createUf2Decoder, type Uf2Image } from "../domain/firmware/uf2.js";
import {
  DecodedRegionArtifactReader,
  regionFileName,
  type RegionDecoding,
} from "./DecodedRegionArtifactReader.js";
import type { StableRegularFileDescriptor } from "../filesystem/RegularFile.js";

/** Families are separate address spaces, so each names its own directory. */
const familyDirectory = (familyId: number | null): string =>
  familyId === null
    ? "no-family"
    : `family-0x${familyId.toString(16).padStart(8, "0")}`;

const uf2Regions: RegionDecoding<Uf2Image> = {
  label: "UF2",
  keyPrefix: "uf2",
  createDecoder: createUf2Decoder,
  describe: (image) => ({
    metadata: image.metadata,
    regions: image.regions.map((region) => ({
      path: `${familyDirectory(region.familyId)}/${regionFileName(region.start, region.end)}`,
      byteOffset: null,
      formatMetadata: {
        kind: "uf2-region",
        family_id: region.familyId,
        family_name: region.familyName,
        start_address: region.start,
        end_address: region.end,
        length: region.bytes.length,
        block_count: region.blockCount,
        first_file_block: region.firstFileBlock,
        last_file_block: region.lastFileBlock,
      },
      bytes: region.bytes,
    })),
    ...(image.complete && image.limitations.length === 0
      ? {}
      : {
          coverage: {
            status: image.complete ? "complete" : "unknown",
            limitations: image.limitations,
          },
        }),
  }),
};

/** Decode UF2 blocks into each family's address-contiguous region entries. */
export class Uf2ArtifactReader extends DecodedRegionArtifactReader<Uf2Image> {
  constructor(path: string, admitted?: StableRegularFileDescriptor) {
    super(path, "uf2", uf2Regions, admitted);
  }
}
