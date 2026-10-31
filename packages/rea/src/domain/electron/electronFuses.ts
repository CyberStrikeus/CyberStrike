import { z } from "zod";

import { digestSchema } from "../digests.js";
import {
  absoluteLocalPathStringSchema,
  localPathStringSchema,
} from "../localPath.js";

/** ASCII sentinel that introduces an Electron fuse wire in an Electron binary. */
export const ELECTRON_FUSE_SENTINEL = "dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX";

/** Wire bytes from the Electron fuse wire: disabled, enabled, and removed. */
export const ELECTRON_FUSE_STATE_BYTES = {
  disabled: 0x30,
  enabled: 0x31,
  removed: 0x72,
} as const;

/**
 * FuseV1 index order. An index past this table, or any index on another wire
 * version, keeps a null name and its raw byte.
 */
export const ELECTRON_FUSE_V1_NAMES = [
  "RunAsNode",
  "EnableCookieEncryption",
  "EnableNodeOptionsEnvironmentVariable",
  "EnableNodeCliInspectArguments",
  "EnableEmbeddedAsarIntegrityValidation",
  "OnlyLoadAppFromAsar",
  "LoadBrowserProcessSpecificV8Snapshot",
  "GrantFileProtocolExtraPrivileges",
  "WasmTrapHandlers",
] as const;

const FUSE_IMPLICATIONS = [
  {
    subject: "node_cli_inspect_arguments",
    fuseIndex: 3,
    enabled: "honored",
    inactive: "not_honored",
  },
  {
    subject: "electron_run_as_node",
    fuseIndex: 0,
    enabled: "honored",
    inactive: "not_honored",
  },
  {
    subject: "embedded_asar_integrity_validation",
    fuseIndex: 4,
    enabled: "enforced",
    inactive: "not_enforced",
  },
  {
    subject: "only_load_app_from_asar",
    fuseIndex: 5,
    enabled: "restricted_to_app_asar",
    inactive: "not_restricted_to_app_asar",
  },
] as const;

const OTHER_MEANS_LIMITATION =
  "Fuse state does not prove the application enables Inspector through other means, such as app.commandLine or a remote-debugging switch in application code.";
const MISSING_SENTINEL_LIMITATION =
  "A missing sentinel means fuse state is unknown, not that every fuse is disabled.";

const byteSchema = z.int().min(0).max(255);
const fuseStateSchema = z.enum(["enabled", "disabled", "removed", "unknown"]);

/** One fuse byte, with a version-1 name when the pinned table covers its index. */
export const electronFuseSchema = z.strictObject({
  index: z.int().nonnegative(),
  name: z.string().min(1).nullable(),
  state: fuseStateSchema,
  raw_byte: byteSchema,
});

const electronFuseSentinelSchema = z.strictObject({
  sentinel_offset: z.int().nonnegative(),
  wire_version: byteSchema.nullable(),
  declared_length: byteSchema.nullable(),
  fuses: z.array(electronFuseSchema),
  complete: z.boolean(),
});

const electronFuseSliceSchema = z.strictObject({
  index: z.int().nonnegative(),
  file_offset: z.int().nonnegative(),
  size: z.int().nonnegative(),
  architecture: z.string().min(1).nullable(),
  hidden: z.boolean().exactOptional(),
  sentinel_count: z.int().nonnegative(),
  sentinels: z.array(electronFuseSentinelSchema),
});

const implicationLocation = {
  relationship: z.literal("derivation"),
  slice_index: z.int().nonnegative(),
  sentinel_offset: z.int().nonnegative(),
};

/** Derived runtime meaning of one observed fuse byte. The fuse bytes stay observed. */
export const electronFuseImplicationSchema = z.discriminatedUnion("subject", [
  z.strictObject({
    ...implicationLocation,
    subject: z.literal("node_cli_inspect_arguments"),
    fuse_index: z.literal(3),
    outcome: z.enum(["honored", "not_honored", "unknown"]),
  }),
  z.strictObject({
    ...implicationLocation,
    subject: z.literal("electron_run_as_node"),
    fuse_index: z.literal(0),
    outcome: z.enum(["honored", "not_honored", "unknown"]),
  }),
  z.strictObject({
    ...implicationLocation,
    subject: z.literal("embedded_asar_integrity_validation"),
    fuse_index: z.literal(4),
    outcome: z.enum(["enforced", "not_enforced", "unknown"]),
  }),
  z.strictObject({
    ...implicationLocation,
    subject: z.literal("only_load_app_from_asar"),
    fuse_index: z.literal(5),
    outcome: z.enum([
      "restricted_to_app_asar",
      "not_restricted_to_app_asar",
      "unknown",
    ]),
  }),
]);

/** Inline fuse observation for one selected app bundle or Electron executable. */
export const electronFuseReportSchema = z
  .strictObject({
    artifact: z
      .strictObject({
        selected_path: localPathStringSchema,
        resolved_path: localPathStringSchema,
        sha256: digestSchema,
        bytes: z.int().nonnegative(),
        format: z.enum(["mach-o", "mach-o-universal", "pe", "elf"]),
      })
      .describe(
        "Caller-selected path, resolved regular file, and the container that was read",
      ),
    slices: z
      .array(electronFuseSliceSchema)
      .describe(
        "One entry per universal Mach-O slice, or a single entry for a thin Mach-O, PE, or ELF file. Sentinel offsets are file-absolute.",
      ),
    runtime_implications: z
      .array(electronFuseImplicationSchema)
      .describe(
        "Derivations from version-1 fuse bytes. Each entry names the fuse index it came from.",
      ),
    limitations: z.array(z.string().min(1)),
  })
  .superRefine((report, context) => {
    validateReportBounds(report, context);
  });

export const inspectElectronFusesInputSchema = z.strictObject({
  path: absoluteLocalPathStringSchema.describe(
    "Absolute filesystem path to a macOS .app bundle, Electron Framework binary, Windows PE executable, or Linux ELF executable",
  ),
});

export type ElectronFuseState = z.infer<typeof fuseStateSchema>;
export type ElectronFuseSentinel = z.infer<typeof electronFuseSentinelSchema>;
export type ElectronFuseSlice = z.infer<typeof electronFuseSliceSchema>;
export type ElectronFuseImplication = z.infer<
  typeof electronFuseImplicationSchema
>;
export type ElectronFuseReport = z.infer<typeof electronFuseReportSchema>;
export type InspectElectronFusesInput = z.infer<
  typeof inspectElectronFusesInputSchema
>;

/** Decode one fuse wire byte. Any other value stays unknown and keeps the raw byte. */
export const electronFuseState = (byte: number): ElectronFuseState => {
  if (byte === ELECTRON_FUSE_STATE_BYTES.disabled) return "disabled";
  if (byte === ELECTRON_FUSE_STATE_BYTES.enabled) return "enabled";
  if (byte === ELECTRON_FUSE_STATE_BYTES.removed) return "removed";
  return "unknown";
};

/** Pinned version-1 name, or null when this wire version or index has no table entry. */
export const electronFuseName = (
  wireVersion: number,
  index: number,
): string | null =>
  wireVersion === 1 ? (ELECTRON_FUSE_V1_NAMES[index] ?? null) : null;

/**
 * Attach derivations and reading limitations without choosing among multiple
 * sentinels. Embedded ASAR integrity is compiled only for Mach-O and PE, so an
 * ELF byte stays observed and its enforcement outcome stays unknown.
 */
export const describeElectronFuseFindings = (
  slices: readonly ElectronFuseSlice[],
  container: ElectronFuseReport["artifact"]["format"],
): {
  readonly runtime_implications: ElectronFuseImplication[];
  readonly limitations: string[];
} => {
  const runtime_implications: ElectronFuseImplication[] = [];
  const limitations = [OTHER_MEANS_LIMITATION, MISSING_SENTINEL_LIMITATION];
  for (const slice of slices) {
    if (slice.sentinel_count === 0)
      limitations.push(
        `Slice ${slice.index} at file offset ${slice.file_offset} contains no Electron fuse sentinel; fuse state for that slice is unknown, not disabled.`,
      );
    else if (slice.sentinel_count > 1)
      limitations.push(
        `Slice ${slice.index} at file offset ${slice.file_offset} contains ${slice.sentinel_count} Electron fuse sentinels; every sentinel is reported and none is selected.`,
      );
    for (const sentinel of slice.sentinels)
      describeSentinel(
        slice.index,
        sentinel,
        container,
        runtime_implications,
        limitations,
      );
  }
  return { runtime_implications, limitations };
};

/** Electron compiles this validation for macOS (Mach-O) and Windows (PE) only. */
const embeddedAsarIntegrityApplies = (
  container: ElectronFuseReport["artifact"]["format"],
): boolean =>
  container === "mach-o" ||
  container === "mach-o-universal" ||
  container === "pe";

const describeSentinel = (
  sliceIndex: number,
  sentinel: ElectronFuseSentinel,
  container: ElectronFuseReport["artifact"]["format"],
  implications: ElectronFuseImplication[],
  limitations: string[],
): void => {
  if (!sentinel.complete)
    limitations.push(
      `Electron fuse wire at file offset ${sentinel.sentinel_offset} is truncated; fuse bytes past the slice stay unknown.`,
    );
  if (sentinel.wire_version === null) return;
  if (sentinel.wire_version !== 1) {
    limitations.push(
      `Electron fuse wire at file offset ${sentinel.sentinel_offset} uses wire version ${sentinel.wire_version}; version 1 is the only pinned name table, so runtime implications for this wire are unknown.`,
    );
    return;
  }
  for (const spec of FUSE_IMPLICATIONS) {
    const fuse = sentinel.fuses.find((item) => item.index === spec.fuseIndex);
    if (fuse === undefined) {
      limitations.push(
        `Electron fuse wire at file offset ${sentinel.sentinel_offset} does not include fuse index ${spec.fuseIndex}; that runtime implication is unknown.`,
      );
      continue;
    }
    const applicabilityUnknown =
      spec.subject === "embedded_asar_integrity_validation" &&
      !embeddedAsarIntegrityApplies(container);
    if (applicabilityUnknown)
      limitations.push(
        `Electron compiles embedded ASAR integrity validation only on macOS and Windows; the observed fuse byte at file offset ${sentinel.sentinel_offset} does not establish enforcement.`,
      );
    implications.push(
      implicationFor(spec, applicabilityUnknown ? "unknown" : fuse.state, {
        slice_index: sliceIndex,
        sentinel_offset: sentinel.sentinel_offset,
      }),
    );
  }
};

const implicationFor = (
  spec: (typeof FUSE_IMPLICATIONS)[number],
  state: ElectronFuseState,
  location: {
    readonly slice_index: number;
    readonly sentinel_offset: number;
  },
): ElectronFuseImplication => {
  const outcome =
    state === "enabled"
      ? spec.enabled
      : state === "unknown"
        ? "unknown"
        : spec.inactive;
  return {
    relationship: "derivation",
    subject: spec.subject,
    fuse_index: spec.fuseIndex,
    outcome,
    ...location,
  } as ElectronFuseImplication;
};

const validateReportBounds = (
  report: ElectronFuseReport,
  context: z.RefinementCtx,
): void => {
  const size = report.artifact.bytes;
  for (const [sliceIndex, slice] of report.slices.entries()) {
    if (slice.index !== sliceIndex)
      context.addIssue({
        code: "custom",
        path: ["slices", sliceIndex, "index"],
        message: "Slice index does not match its position in the report.",
      });
    if (slice.sentinel_count !== slice.sentinels.length)
      context.addIssue({
        code: "custom",
        path: ["slices", sliceIndex, "sentinel_count"],
        message: "Sentinel count does not match the reported sentinels.",
      });
    if (slice.file_offset > size || slice.size > size - slice.file_offset)
      context.addIssue({
        code: "custom",
        path: ["slices", sliceIndex],
        message: "Slice range extends outside the selected artifact.",
      });
    for (const [sentinelIndex, sentinel] of slice.sentinels.entries())
      validateSentinel(slice, sentinel, sliceIndex, sentinelIndex, context);
  }
  const expected = new Set(
    describeElectronFuseFindings(
      report.slices,
      report.artifact.format,
    ).runtime_implications.map(implicationKey),
  );
  for (const [index, implication] of report.runtime_implications.entries()) {
    if (!expected.has(implicationKey(implication)))
      context.addIssue({
        code: "custom",
        path: ["runtime_implications", index],
        message:
          "Runtime implication is not supported by the reported fuse bytes and applicability.",
      });
    const slice = report.slices[implication.slice_index];
    if (
      slice?.sentinels.some(
        (sentinel) => sentinel.sentinel_offset === implication.sentinel_offset,
      ) !== true
    )
      context.addIssue({
        code: "custom",
        path: ["runtime_implications", index],
        message: "Runtime implication does not reference a reported sentinel.",
      });
  }
};

const implicationKey = (fact: ElectronFuseImplication): string =>
  JSON.stringify([
    fact.slice_index,
    fact.sentinel_offset,
    fact.subject,
    fact.fuse_index,
    fact.outcome,
  ]);

const validateSentinel = (
  slice: ElectronFuseSlice,
  sentinel: ElectronFuseSentinel,
  sliceIndex: number,
  sentinelIndex: number,
  context: z.RefinementCtx,
): void => {
  const sentinelEnd = sentinel.sentinel_offset + ELECTRON_FUSE_SENTINEL.length;
  const wireEnd =
    sentinelEnd +
    (sentinel.wire_version === null ? 0 : 1) +
    (sentinel.declared_length === null ? 0 : 1) +
    sentinel.fuses.length;
  if (wireEnd > slice.file_offset + slice.size)
    context.addIssue({
      code: "custom",
      path: ["slices", sliceIndex, "sentinels", sentinelIndex],
      message: "Reported wire header or fuse bytes extend outside the slice.",
    });
  if (
    sentinel.sentinel_offset < slice.file_offset ||
    sentinelEnd > slice.file_offset + slice.size
  )
    context.addIssue({
      code: "custom",
      path: [
        "slices",
        sliceIndex,
        "sentinels",
        sentinelIndex,
        "sentinel_offset",
      ],
      message: "Sentinel is outside its slice.",
    });
  if (sentinel.wire_version === null && sentinel.declared_length !== null)
    context.addIssue({
      code: "custom",
      path: [
        "slices",
        sliceIndex,
        "sentinels",
        sentinelIndex,
        "declared_length",
      ],
      message: "A wire without a version byte cannot declare a fuse count.",
    });
  if (
    sentinel.complete &&
    (sentinel.declared_length === null ||
      sentinel.fuses.length !== sentinel.declared_length)
  )
    context.addIssue({
      code: "custom",
      path: ["slices", sliceIndex, "sentinels", sentinelIndex, "complete"],
      message: "A complete wire must contain every declared fuse byte.",
    });
  if (
    !sentinel.complete &&
    sentinel.declared_length !== null &&
    sentinel.fuses.length >= sentinel.declared_length
  )
    context.addIssue({
      code: "custom",
      path: ["slices", sliceIndex, "sentinels", sentinelIndex, "complete"],
      message: "An incomplete wire must omit at least one declared fuse byte.",
    });
  for (const [fuseIndex, fuse] of sentinel.fuses.entries()) {
    if (fuse.index !== fuseIndex)
      context.addIssue({
        code: "custom",
        path: [
          "slices",
          sliceIndex,
          "sentinels",
          sentinelIndex,
          "fuses",
          fuseIndex,
          "index",
        ],
        message: "Fuse index does not match its wire position.",
      });
    if (fuse.state !== electronFuseState(fuse.raw_byte))
      context.addIssue({
        code: "custom",
        path: [
          "slices",
          sliceIndex,
          "sentinels",
          sentinelIndex,
          "fuses",
          fuseIndex,
          "state",
        ],
        message: "Fuse state does not match its raw byte.",
      });
    if (
      sentinel.wire_version !== null &&
      fuse.name !== electronFuseName(sentinel.wire_version, fuse.index)
    )
      context.addIssue({
        code: "custom",
        path: [
          "slices",
          sliceIndex,
          "sentinels",
          sentinelIndex,
          "fuses",
          fuseIndex,
          "name",
        ],
        message: "Fuse name does not match the pinned version-1 table.",
      });
  }
};
