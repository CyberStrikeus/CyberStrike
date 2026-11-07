import { z } from "zod";
import { digestSchema, prefixedDigestSchema } from "./digests.js";
import {
  absoluteLocalPathStringSchema,
  localPathStringSchema,
} from "./localPath.js";
import { artifactTraversalOmissionKindSchema } from "./artifactGraph.js";

export const desktopFamilySchema = z.enum([
  "dotnet",
  "unity-mono",
  "unity-il2cpp",
  "unreal",
  "godot",
  "gamemaker",
  "electron",
]);
export const inspectDesktopApplicationInputSchema = z.strictObject({
  path: absoluteLocalPathStringSchema,
  max_entries: z.number().int().positive().max(100_000).default(20_000),
  max_probe_bytes: z
    .number()
    .int()
    .min(4096)
    .max(64 * 1024 * 1024)
    .default(8 * 1024 * 1024),
});
export type InspectDesktopApplicationInput = z.infer<
  typeof inspectDesktopApplicationInputSchema
>;

const byteOffset = z.number().int().nonnegative();
const fact = <Kind extends string, Value extends z.ZodType>(
  kind: Kind,
  value: Value,
) => z.strictObject({ kind: z.literal(kind), offset: byteOffset, value });
const desktopFactSchema = z.discriminatedUnion("kind", [
  fact(
    "pe-cli-directory",
    z.strictObject({ rva: byteOffset, bytes: byteOffset }),
  ),
  fact(
    "unity-assembly-reference",
    z.strictObject({
      name: z.string(),
      token: z.string(),
      managed_directory: z.string(),
    }),
  ),
  fact(
    "native-image-header",
    z.union([
      z.strictObject({ format: z.literal("pe"), machine: byteOffset }),
      z.strictObject({
        format: z.enum(["elf", "mach-o"]),
        signature: z.string(),
      }),
    ]),
  ),
  fact(
    "il2cpp-metadata-header",
    z.strictObject({
      magic: z.literal("0xfab11baf"),
      raw_version: byteOffset.nullable(),
    }),
  ),
  fact(
    "godot-pck-header",
    z.strictObject({
      pack_version: byteOffset,
      engine_version: z.array(byteOffset).length(3),
      placement: z.enum(["standalone", "embedded-trailer"]),
    }),
  ),
  fact(
    "unityfs-header",
    z.strictObject({
      format_version: byteOffset,
      engine_version: z.string(),
      flags: byteOffset,
      declared_size: byteOffset.nullable(),
    }),
  ),
  fact(
    "gamemaker-form-header",
    z.strictObject({
      container: z.literal("FORM"),
      first_chunk: z.literal("GEN8"),
    }),
  ),
  z.strictObject({
    kind: z.literal("il2cpp-library-convention"),
    offset: z.null(),
    value: z.string(),
  }),
  z.strictObject({
    kind: z.literal("electron-asar-convention"),
    offset: z.null(),
    value: z.string(),
  }),
  z.strictObject({
    kind: z.literal("unreal-container-convention"),
    offset: byteOffset.nullable(),
    value: z.union([
      z.string(),
      z.strictObject({ format: z.literal("IoStore TOC") }),
    ]),
  }),
]);
export type DesktopFact = z.infer<typeof desktopFactSchema>;

export const desktopFileSchema = z.strictObject({
  file_id: prefixedDigestSchema("dsf"),
  path: z.string(),
  local_path: localPathStringSchema,
  kind: z.enum(["file", "directory", "symlink"]),
  bytes: z.number().int().nonnegative().nullable(),
  identity: z
    .strictObject({
      device: z.string(),
      inode: z.string(),
      size: z.string(),
      mode: z.string(),
      mtime_ns: z.string(),
      ctime_ns: z.string(),
    })
    .nullable(),
  read_status: z.enum(["not-selected", "examined", "partial", "unavailable"]),
  ranges: z.array(
    z.strictObject({
      offset: z.number().int().nonnegative(),
      bytes: z.number().int().nonnegative(),
      sha256: digestSchema,
    }),
  ),
  facts: z.array(desktopFactSchema),
  issues: z.array(z.string()),
});
export type DesktopFile = z.infer<typeof desktopFileSchema>;
export const desktopOmissionSchema = z.strictObject({
  omission_id: prefixedDigestSchema("dso"),
  path: z.string(),
  kind: artifactTraversalOmissionKindSchema,
});
export type DesktopOmission = z.infer<typeof desktopOmissionSchema>;
export const desktopCandidateSchema = z.strictObject({
  candidate_id: prefixedDigestSchema("dsc"),
  family: desktopFamilySchema,
  confidence: z.enum(["derived", "inferred"]),
  basis_file_ids: z.array(prefixedDigestSchema("dsf")).min(1),
  rationale: z.string(),
});
export const desktopComponentSchema = z.strictObject({
  component_id: prefixedDigestSchema("dsm"),
  name: z.string(),
  category: z.enum(["mod-loader", "protection"]),
  basis_file_ids: z.array(prefixedDigestSchema("dsf")).min(1),
  confidence: z.literal("inferred"),
  runtime_presence: z.literal("unknown"),
});
export const desktopProbeSchema = z.strictObject({
  probe_id: prefixedDigestSchema("dsp"),
  operation: z.enum([
    "inspect_managed_artifact",
    "inspect_il2cpp_metadata",
    "open_binary",
    "analyze_javascript_application",
  ]),
  path: localPathStringSchema,
  file_id: prefixedDigestSchema("dsf"),
  rationale: z.string(),
  confidence: z.literal("inferred"),
});
export const desktopCoverageSchema = z.strictObject({
  status: z.enum(["complete-within-scan", "partial"]),
  entries_examined: z.number().int().nonnegative(),
  files_probed: z.number().int().nonnegative(),
  bytes_read: z.number().int().nonnegative(),
  symlinks_not_followed: z.number().int().nonnegative(),
  special_entries_omitted: z.number().int().nonnegative(),
  limits: z.strictObject({
    max_entries:
      inspectDesktopApplicationInputSchema.shape.max_entries.removeDefault(),
    max_probe_bytes:
      inspectDesktopApplicationInputSchema.shape.max_probe_bytes.removeDefault(),
  }),
});
export const desktopApplicationSchema = z.strictObject({
  root: z.strictObject({
    path: localPathStringSchema,
    canonical_path: localPathStringSchema,
    namespace_id: prefixedDigestSchema("dsr"),
    identity: z.strictObject({ device: z.string(), inode: z.string() }),
    snapshot_sha256: digestSchema,
    identity_scope: z.literal("examined-metadata-and-read-ranges"),
  }),
  files: z.array(desktopFileSchema),
  omissions: z.array(desktopOmissionSchema),
  candidates: z.array(desktopCandidateSchema),
  components: z.array(desktopComponentSchema),
  next_probes: z.array(desktopProbeSchema),
  coverage: desktopCoverageSchema,
  limitations: z.array(z.string()),
});
export type DesktopApplication = z.infer<typeof desktopApplicationSchema>;
