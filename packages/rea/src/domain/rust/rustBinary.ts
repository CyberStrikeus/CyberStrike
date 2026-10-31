import { z } from "zod";
import { digestSchema } from "../digests.js";
import {
  absoluteLocalPathStringSchema,
  localPathStringSchema,
} from "../localPath.js";
import { binaryMetadataArchitecture } from "../binaryMetadataArchitecture.js";
import {
  machoSelectionContainsRange,
  selectedSliceAgreesWithReport,
  machoSliceArchitectureSchema,
  machoTargetSelectionSchema,
} from "../apple/machoTargetSelection.js";

/** Known revisions used to interpret compatible cargo-auditable documents. */
export const RUST_AUDITABLE_FORMAT_VERSIONS = [0, 1, 8] as const;

const index = z.int().nonnegative();
const rustcHash = z.string().regex(/^[0-9a-f]{40}$/u);
export const rustPackageFeaturesSchema = z.array(z.string().min(1)).nullable();

/** One embedded package, with omitted kind and root preserved as null and false. */
export const rustPackageSchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
  source: z.string().min(1),
  kind: z.enum(["runtime", "build"]).nullable(),
  dependencies: z.array(index),
  features: rustPackageFeaturesSchema.default(null),
  root: z.boolean(),
});

const dependencyEdgeSchema = z.strictObject({
  from_index: index,
  to_index: index,
});

/** zlib JSON from one `.dep-v0` section, in the section's package order. */
export const rustAuditableMetadataSchema = z.strictObject({
  section_name: z.enum([".dep-v0", "__DATA,.dep-v0"]),
  file_offset: index,
  /** Stored section range, including accepted PE file-alignment bytes. */
  section_bytes: z.int().positive(),
  /** Bytes consumed by the zlib stream; the inflate ratio uses this size. */
  compressed_bytes: z.int().positive(),
  uncompressed_bytes: z.int().positive(),
  /** Original embedded revision; null means the source omitted the field. */
  format_version: z.int().nonnegative().max(0xffff_ffff).nullable(),
  packages: z.array(rustPackageSchema),
  root_package_index: index.nullable(),
  dependency_edges: z.array(dependencyEdgeSchema),
  cyclic_dependency_indices: z.array(index),
});

/** Inferred compiler id from read-only `/rustc/<40-hex>/` paths. */
export const rustcCommitSchema = z.strictObject({
  evidence_kind: z.literal("inferred"),
  hashes: z
    .array(
      z.strictObject({
        hash: rustcHash,
        file_offset: index,
      }),
    )
    .min(1),
});

/** One explicit local executable or library, independent of a disassembler target. */
export const inspectRustBinaryInputSchema = z.strictObject({
  path: absoluteLocalPathStringSchema.describe(
    "Absolute filesystem path to the selected executable or library",
  ),
  architecture: machoSliceArchitectureSchema.exactOptional(),
});

/** Bounded cargo-auditable observation. A missing section is null, not an empty dependency list. */
export const rustBinarySchema = z
  .strictObject({
    artifact: z.strictObject({
      path: localPathStringSchema,
      sha256: digestSchema,
      bytes: index,
    }),
    format: z.enum(["elf", "pe", "macho"]),
    architecture: z.string(),
    bits: z.union([z.literal(32), z.literal(64)]),
    byte_order: z.enum(["little", "big"]),
    /** The universal slice that was read; file offsets stay inside it. */
    selected_slice: machoTargetSelectionSchema.exactOptional(),
    auditable_metadata: rustAuditableMetadataSchema.nullable(),
    rustc_commit: rustcCommitSchema.nullable(),
    limitations: z.array(z.string()),
  })
  .superRefine((report, context) => {
    const metadata = report.auditable_metadata;
    if (metadata !== null) {
      checkSection(report.artifact.bytes, metadata, context);
      checkPackages(metadata, context);
    }
    checkRustc(report.artifact.bytes, report.rustc_commit, context);
    checkSlice(report, context);
  });

export type RustPackage = z.infer<typeof rustPackageSchema>;
export type RustAuditableMetadata = z.infer<typeof rustAuditableMetadataSchema>;
export type RustBinary = z.infer<typeof rustBinarySchema>;
export type InspectRustBinaryInput = z.infer<
  typeof inspectRustBinaryInputSchema
>;

const issue = (
  context: z.RefinementCtx,
  path: (string | number)[],
  message: string,
): void => {
  context.addIssue({ code: "custom", path, message });
};

const inside = (fileBytes: number, offset: number, size: number): boolean =>
  offset <= fileBytes && size <= fileBytes - offset;

const checkSection = (
  fileBytes: number,
  metadata: RustAuditableMetadata,
  context: z.RefinementCtx,
): void => {
  if (
    !inside(fileBytes, metadata.file_offset, metadata.section_bytes) ||
    metadata.compressed_bytes > metadata.section_bytes
  )
    issue(
      context,
      ["auditable_metadata", "file_offset"],
      "Dependency section range is outside the selected artifact or shorter than its compressed stream.",
    );
};

const checkPackages = (
  metadata: RustAuditableMetadata,
  context: z.RefinementCtx,
): void => {
  const roots: number[] = [];
  const edgesByPackage = new Map<
    number,
    z.infer<typeof dependencyEdgeSchema>[]
  >();
  for (const [position, edge] of metadata.dependency_edges.entries()) {
    if (
      edge.from_index >= metadata.packages.length ||
      edge.to_index >= metadata.packages.length
    ) {
      issue(
        context,
        ["auditable_metadata", "dependency_edges", position],
        "Dependency edge index is outside the package list.",
      );
      continue;
    }
    const grouped = edgesByPackage.get(edge.from_index);
    if (grouped === undefined) edgesByPackage.set(edge.from_index, [edge]);
    else grouped.push(edge);
  }
  for (const [packageIndex, pkg] of metadata.packages.entries()) {
    if (pkg.root) roots.push(packageIndex);
    const edges = edgesByPackage.get(packageIndex) ?? [];
    if (
      edges.length !== pkg.dependencies.length ||
      edges.some((edge, index) => edge.to_index !== pkg.dependencies[index])
    )
      issue(
        context,
        ["auditable_metadata", "dependency_edges"],
        "Dependency edges do not match package dependency indices.",
      );
    if (pkg.dependencies.some((target) => target >= metadata.packages.length))
      issue(
        context,
        ["auditable_metadata", "packages", packageIndex, "dependencies"],
        "Dependency index is outside the package list.",
      );
  }
  const root = metadata.root_package_index;
  if (
    root === null ? roots.length !== 0 : roots.length !== 1 || roots[0] !== root
  )
    issue(
      context,
      ["auditable_metadata", "root_package_index"],
      "Root package index does not match packages marked root.",
    );
  const cycles = cyclicDependencyIndices(metadata.packages);
  if (
    cycles.length !== metadata.cyclic_dependency_indices.length ||
    cycles.some(
      (index, position) =>
        metadata.cyclic_dependency_indices[position] !== index,
    )
  )
    issue(
      context,
      ["auditable_metadata", "cyclic_dependency_indices"],
      "Cyclic dependency indices do not match the cycles in package dependencies.",
    );
};

/** Package indices that participate in a dependency cycle, in ascending order. */
export const cyclicDependencyIndices = (
  packages: readonly { readonly dependencies: readonly number[] }[],
): number[] => {
  const edges = packages.map((pkg) => pkg.dependencies);
  const order = dependencyPostorder(edges);
  const reversed = reversedDependencyEdges(edges);
  const seen = new Uint8Array(edges.length);
  const cyclic = new Set<number>();
  for (let cursor = order.length - 1; cursor >= 0; cursor -= 1) {
    const start = order[cursor];
    if (start === undefined || seen[start] === 1) continue;
    const component = dependencyComponent(start, reversed, seen);
    if (dependencyComponentInCycle(component, edges))
      for (const index of component) cyclic.add(index);
  }
  return [...cyclic].sort((left, right) => left - right);
};

interface DependencyWalkFrame {
  readonly index: number;
  edge: number;
}

const dependencyPostorder = (
  edges: readonly (readonly number[])[],
): number[] => {
  const seen = new Uint8Array(edges.length);
  const order: number[] = [];
  for (let start = 0; start < edges.length; start += 1) {
    if (seen[start] === 1) continue;
    const stack: DependencyWalkFrame[] = [{ index: start, edge: 0 }];
    seen[start] = 1;
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      const next = edges[frame.index]?.[frame.edge];
      if (next === undefined) {
        stack.pop();
        order.push(frame.index);
        continue;
      }
      frame.edge += 1;
      if (seen[next] === 0) {
        seen[next] = 1;
        stack.push({ index: next, edge: 0 });
      }
    }
  }
  return order;
};

const reversedDependencyEdges = (
  edges: readonly (readonly number[])[],
): number[][] => {
  const reversed = Array.from({ length: edges.length }, () => [] as number[]);
  for (let from = 0; from < edges.length; from += 1)
    for (const to of edges[from] ?? []) reversed[to]?.push(from);
  return reversed;
};

const dependencyComponent = (
  start: number,
  reversed: readonly (readonly number[])[],
  seen: Uint8Array,
): number[] => {
  const component: number[] = [];
  const stack = [start];
  seen[start] = 1;
  while (stack.length > 0) {
    const index = stack.pop();
    if (index === undefined) break;
    component.push(index);
    for (const next of reversed[index] ?? []) {
      if (seen[next] === 0) {
        seen[next] = 1;
        stack.push(next);
      }
    }
  }
  return component;
};

const dependencyComponentInCycle = (
  component: readonly number[],
  edges: readonly (readonly number[])[],
): boolean => {
  if (component.length > 1) return true;
  const only = component[0];
  return only !== undefined && (edges[only]?.includes(only) ?? false);
};

const checkSlice = (report: RustBinary, context: z.RefinementCtx): void => {
  const slice = report.selected_slice;
  if (slice === undefined) return;
  const ranges = [
    { offset: slice.offset, bytes: 0 },
    ...(report.auditable_metadata === null
      ? []
      : [
          {
            offset: report.auditable_metadata.file_offset,
            bytes: report.auditable_metadata.section_bytes,
          },
        ]),
    ...(report.rustc_commit?.hashes.map(({ file_offset: offset }) => ({
      offset,
      bytes: 48,
    })) ?? []),
  ];
  if (
    !selectedSliceAgreesWithReport(
      slice,
      report.format,
      binaryMetadataArchitecture(report.architecture),
    ) ||
    ranges.some(
      ({ offset, bytes }) =>
        !machoSelectionContainsRange(
          slice,
          report.artifact.bytes,
          offset,
          bytes,
        ),
    )
  )
    issue(
      context,
      ["selected_slice"],
      "Selected universal slice must be a FAT slice of the artifact whose CPU matches the report's Mach-O architecture and that contains the reported file offsets.",
    );
};

const checkRustc = (
  fileBytes: number,
  commit: RustBinary["rustc_commit"],
  context: z.RefinementCtx,
): void => {
  if (commit === null) return;
  const seen = new Set<string>();
  for (const [position, entry] of commit.hashes.entries()) {
    if (seen.has(entry.hash) || !inside(fileBytes, entry.file_offset, 48))
      issue(
        context,
        ["rustc_commit", "hashes", position],
        "rustc path hash is duplicated or its file offset is outside the artifact.",
      );
    seen.add(entry.hash);
  }
};
