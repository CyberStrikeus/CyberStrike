import { z } from "zod";

import {
  espAppDescriptorSchema,
  espBootloaderDescriptorSchema,
  espFlashImageFactsSchema,
  espFlashImageMetadataSchema,
  espImageMetadataSchema,
  espImageSegmentMetadataSchema,
  uint8,
  uint32,
  type ArtifactFormatMetadata,
} from "../artifactFormatMetadata.js";

type EspFlashImageFacts = z.infer<typeof espFlashImageFactsSchema>;

/**
 * One ESP image in a flash layout's summary view: what tells two app slots
 * apart, where its segments go and its integrity. The complete Evidence
 * keeps its full facts, segments and signature blocks included.
 */
const espImageSummarySchema = z.strictObject({
  status: espFlashImageFactsSchema.shape.status,
  /** The chip target, from the header's `chip_id`; null when unknown. */
  chip: espImageMetadataSchema.shape.chip.unwrap().shape.target.nullable(),
  entry_addr: uint32.nullable(),
  /** The header's segment count. */
  segment_count: uint8.nullable(),
  /** Where each segment that is mapped, loaded or unclassified goes. */
  load_ranges: z.array(
    z.strictObject({
      address: uint32,
      length: uint32,
      classification:
        espImageSegmentMetadataSchema.shape.classification.exclude([
          "not-loaded",
        ]),
    }),
  ),
  signature_block_count: uint8,
  /** The descriptor's identifying fields; null without one. */
  descriptor: z
    .discriminatedUnion("kind", [
      espAppDescriptorSchema.pick({
        kind: true,
        project_name: true,
        version: true,
        idf_ver: true,
        secure_version: true,
        app_elf_sha256: true,
      }),
      espBootloaderDescriptorSchema.pick({
        kind: true,
        version: true,
        idf_ver: true,
        secure_version: true,
      }),
    ])
    .nullable(),
  checksum: espImageMetadataSchema.shape.checksum.shape.status.nullable(),
  appended_sha256:
    espImageMetadataSchema.shape.appended_sha256.shape.status.nullable(),
  coverage: espFlashImageFactsSchema.shape.coverage,
  limitations: z.array(z.string()),
});

/**
 * An ESP flash layout's root facts in the summary view, under their own
 * kind: each nested image is a `summary` instead of its full `facts`.
 */
export const espFlashImageSummaryMetadataSchema =
  espFlashImageMetadataSchema.extend({
    kind: z.literal("esp-flash-image-summary"),
    bootloader: espFlashImageMetadataSchema.shape.bootloader
      .unwrap()
      .omit({ facts: true })
      .extend({ summary: espImageSummarySchema })
      .nullable(),
    apps: z.array(
      espFlashImageMetadataSchema.shape.apps.element
        .omit({ facts: true })
        .extend({ summary: espImageSummarySchema }),
    ),
  });
export type EspFlashImageSummaryMetadata = z.infer<
  typeof espFlashImageSummaryMetadataSchema
>;

const summarizeDescriptor = (
  descriptor: NonNullable<EspFlashImageFacts["image"]>["descriptor"],
): z.infer<typeof espImageSummarySchema>["descriptor"] => {
  if (descriptor === null) return null;
  const { kind, version, idf_ver, secure_version } = descriptor;
  return kind === "app"
    ? {
        kind,
        project_name: descriptor.project_name,
        version,
        idf_ver,
        secure_version,
        app_elf_sha256: descriptor.app_elf_sha256,
      }
    : { kind, version, idf_ver, secure_version };
};

const summarizeImage = (
  facts: EspFlashImageFacts,
): z.infer<typeof espImageSummarySchema> => ({
  status: facts.status,
  chip: facts.image?.chip?.target ?? null,
  entry_addr: facts.image?.header.entry_addr ?? null,
  segment_count: facts.image?.header.segment_count ?? null,
  load_ranges: facts.segments.flatMap(
    ({ load_addr: address, data_len: length, classification }) =>
      classification === "not-loaded"
        ? []
        : [{ address, length, classification }],
  ),
  signature_block_count: facts.signature_blocks.length,
  descriptor: summarizeDescriptor(facts.image?.descriptor ?? null),
  checksum: facts.image?.checksum.status ?? null,
  appended_sha256: facts.image?.appended_sha256.status ?? null,
  coverage: facts.coverage,
  limitations: [...facts.limitations],
});

/** Root facts for the summary view: compact for an ESP flash layout. */
export const summaryRootMetadata = (
  metadata: ArtifactFormatMetadata,
): ArtifactFormatMetadata | EspFlashImageSummaryMetadata => {
  if (metadata.kind !== "esp-flash-image") return metadata;
  const { bootloader, apps, ...rest } = metadata;
  return {
    ...rest,
    kind: "esp-flash-image-summary",
    bootloader:
      bootloader === null
        ? null
        : {
            path: bootloader.path,
            flash_address: bootloader.flash_address,
            region_size: bootloader.region_size,
            summary: summarizeImage(bootloader.facts),
          },
    apps: apps.map(({ path, partition_index, facts }) => ({
      path,
      partition_index,
      summary: summarizeImage(facts),
    })),
  };
};
