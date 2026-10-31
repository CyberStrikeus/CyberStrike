import { nodeCodecResult } from "../compression/NodeCodecResult.js";
import { inflateSync } from "node:zlib";
import { visit } from "jsonc-parser";
import { z } from "zod";
import {
  cyclicDependencyIndices,
  type RustAuditableMetadata,
  type RustPackage,
} from "../domain/rust/rustBinary.js";
import { jsonValueByteLength } from "../domain/jsonValueByteLength.js";

/** Selected-file admission limit shared with the stable artifact reader. */
export const RUST_BINARY_INPUT_BYTES = 256 * 1024 * 1024;
/** Compressed zlib stream limit. */
export const RUST_SECTION_BYTES = 1024 * 1024;
/** Inflated JSON may grow by at most this multiple of the compressed stream. */
export const RUST_INFLATE_RATIO = 64;
/** Absolute inflated JSON limit, applied together with the ratio. */
export const RUST_UNCOMPRESSED_BYTES = 8 * 1024 * 1024;
/** Complete normalized report limit. */
export const RUST_OUTPUT_BYTES = 8 * 1024 * 1024;

const JSON_DEPTH = 32;
const packageSchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
  source: z.string().min(1),
  kind: z.enum(["runtime", "build"]).optional(),
  dependencies: z.array(z.int().nonnegative()).optional(),
  features: z.array(z.string().min(1)).optional(),
  root: z.boolean().optional(),
});
const documentVersionSchema = z.object({
  format: z.int().nonnegative().max(0xffff_ffff).optional(),
});
const documentSchema = documentVersionSchema
  .extend({
    packages: z.array(packageSchema),
  })
  .strict();

/** Malformed or unsupported dependency-section bytes. */
export class RustAuditableFormatFailure extends Error {
  constructor(
    readonly kind: "malformed" | "unsupported",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RustAuditableFormatFailure";
  }
}

/** A resource admission limit with explicit semantic units. */
export type RustAuditableConstraint =
  | {
      readonly resource: "memory";
      readonly reported_limits: { readonly maximum_bytes: number };
    }
  | {
      readonly resource: "transport";
      readonly reported_limits: { readonly maximum_output_bytes: number };
    }
  | {
      readonly resource: "capacity";
      readonly reported_limits: { readonly maximum_rustc_hashes: number };
    };

/** Admission refused before retained output or graph expansion. */
export class RustAuditableResourceFailure extends Error {
  constructor(
    readonly constraint: RustAuditableConstraint,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RustAuditableResourceFailure";
  }
}

/** Parsed section payload. Cycles are listed and are not walked. */
export const readAuditableSection = (
  sectionName: RustAuditableMetadata["section_name"],
  fileOffset: number,
  bytes: Buffer,
  options: { readonly peFileAlignment?: number | undefined } = {},
): RustAuditableMetadata => {
  if (bytes.length === 0)
    throw new RustAuditableFormatFailure(
      "malformed",
      "Dependency section is empty",
    );
  if (
    bytes.length > RUST_SECTION_BYTES &&
    options.peFileAlignment === undefined
  )
    throw new RustAuditableResourceFailure(
      {
        resource: "memory",
        reported_limits: { maximum_bytes: RUST_SECTION_BYTES },
      },
      "Dependency section exceeds the 1 MiB compressed limit",
    );
  const inflated = inflateSection(bytes, options.peFileAlignment);
  const document = parseDocument(inflated.bytes);
  const packages = normalizePackages(document.packages);
  const root = rootIndex(packages);
  return {
    section_name: sectionName,
    file_offset: fileOffset,
    section_bytes: bytes.length,
    compressed_bytes: inflated.compressedBytes,
    uncompressed_bytes: inflated.bytes.length,
    format_version: document.format ?? null,
    packages,
    root_package_index: root,
    dependency_edges: packages.flatMap((pkg, fromIndex) =>
      pkg.dependencies.map((toIndex) => ({
        from_index: fromIndex,
        to_index: toIndex,
      })),
    ),
    cyclic_dependency_indices: cyclicDependencyIndices(packages),
  };
};

const inflateSection = (
  bytes: Buffer,
  peFileAlignment: number | undefined,
): {
  readonly bytes: Buffer;
  readonly compressedBytes: number;
} => {
  // Keep inflate allocation bounded before consumed input is known. PE storage
  // can include zero alignment bytes, so the ratio is checked after decoding.
  const allocationMaximum = Math.min(
    RUST_UNCOMPRESSED_BYTES,
    bytes.length * RUST_INFLATE_RATIO,
  );
  let result: ReturnType<typeof nodeCodecResult>;
  try {
    result = nodeCodecResult(
      inflateSync(bytes, {
        info: true,
        maxOutputLength: allocationMaximum,
      }),
    );
  } catch (cause) {
    throw inflateFailure(cause, allocationMaximum);
  }
  const compressedBytes = result.consumedBytes;
  if (compressedBytes > RUST_SECTION_BYTES)
    throw new RustAuditableResourceFailure(
      {
        resource: "memory",
        reported_limits: { maximum_bytes: RUST_SECTION_BYTES },
      },
      "Dependency section exceeds the 1 MiB compressed limit",
    );
  if (peFileAlignment !== undefined && peFileAlignment > 0) {
    const padding = bytes.subarray(compressedBytes);
    const alignedRawSize =
      Math.ceil(compressedBytes / peFileAlignment) * peFileAlignment;
    if (bytes.length !== alignedRawSize || padding.some((byte) => byte !== 0))
      throw new RustAuditableFormatFailure(
        "malformed",
        "Dependency section has bytes after the zlib stream",
      );
  } else if (compressedBytes !== bytes.length) {
    throw new RustAuditableFormatFailure(
      "malformed",
      "Dependency section has bytes after the zlib stream",
    );
  }
  const compressedMaximum = Math.min(
    RUST_UNCOMPRESSED_BYTES,
    compressedBytes * RUST_INFLATE_RATIO,
  );
  if (result.buffer.length > compressedMaximum)
    throw new RustAuditableResourceFailure(
      {
        resource: "memory",
        reported_limits: { maximum_bytes: compressedMaximum },
      },
      "Inflated dependency JSON exceeds the size limit",
    );
  return { bytes: result.buffer, compressedBytes };
};

const inflateFailure = (cause: unknown, maximum: number): Error => {
  const code =
    cause instanceof Error && "code" in cause ? String(cause.code) : "";
  if (code === "ERR_BUFFER_TOO_LARGE")
    return new RustAuditableResourceFailure(
      { resource: "memory", reported_limits: { maximum_bytes: maximum } },
      "Inflated dependency JSON exceeds the size limit",
    );
  if (
    code === "ERR_TRAILING_JUNK_AFTER_STREAM_END" ||
    code.startsWith("Z_") ||
    code === "ERR_INVALID_ARG_TYPE"
  )
    return new RustAuditableFormatFailure(
      "malformed",
      "Dependency section is not a complete zlib stream",
    );
  return cause instanceof Error ? cause : new Error(String(cause));
};

const parseDocument = (bytes: Buffer): z.infer<typeof documentSchema> => {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new RustAuditableFormatFailure(
      "malformed",
      "Dependency JSON is not valid UTF-8",
      { cause },
    );
  }
  assertDepth(text);
  let invalidJson = false;
  let duplicate: string | undefined;
  const objectNames: Set<string>[] = [];
  visit(
    text,
    {
      onObjectBegin: () => {
        objectNames.push(new Set());
      },
      onObjectProperty: (name) => {
        const names = objectNames.at(-1);
        if (names === undefined) return;
        if (names.has(name)) duplicate ??= name;
        names.add(name);
      },
      onObjectEnd: () => {
        objectNames.pop();
      },
      onError: () => {
        invalidJson = true;
      },
    },
    {
      allowTrailingComma: false,
      disallowComments: true,
    },
  );
  if (invalidJson) {
    throw new RustAuditableFormatFailure(
      "malformed",
      "Dependency section JSON is invalid",
    );
  }
  if (duplicate !== undefined)
    throw new RustAuditableFormatFailure(
      "malformed",
      `Dependency JSON contains duplicate field ${JSON.stringify(duplicate)}`,
    );
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new RustAuditableFormatFailure(
      "malformed",
      "Dependency section JSON is invalid",
      { cause },
    );
  }
  const version = documentVersionSchema.safeParse(value);
  if (!version.success)
    throw new RustAuditableFormatFailure(
      "malformed",
      "Dependency JSON does not match the format schema",
      { cause: version.error },
    );
  admitGraphExpansion(value);
  // One malformed package must fail before Zod retains an issue for every field.
  rejectMalformedPackages(value);
  const parsed = documentSchema.safeParse(value);
  if (!parsed.success)
    throw new RustAuditableFormatFailure(
      "malformed",
      "Dependency JSON does not match the package schema",
      { cause: parsed.error },
    );
  return parsed.data;
};

// These are lower bounds on the required normalized representation, not
// guessed per-object heap sizes. Count source arrays before Zod clones them,
// normalization builds edge objects, or SCC analysis creates reverse edges.
const MIN_PACKAGE_OUTPUT_BYTES = JSON.stringify({
  name: "a",
  version: "a",
  source: "a",
  kind: null,
  dependencies: [],
  features: null,
  root: true,
}).length;
const MIN_EDGE_OUTPUT_BYTES = JSON.stringify({
  from_index: 0,
  to_index: 0,
}).length;
const admitGraphExpansion = (value: unknown): void => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("packages" in value) ||
    !Array.isArray(value.packages)
  )
    return;
  const packages: readonly unknown[] = value.packages;
  let minimumBytes =
    packages.length * MIN_PACKAGE_OUTPUT_BYTES +
    Math.max(0, packages.length - 1);
  let edges = 0;
  const admit = () => {
    const edgeBytes = edges * MIN_EDGE_OUTPUT_BYTES + Math.max(0, edges - 1);
    if (minimumBytes + edgeBytes > RUST_OUTPUT_BYTES)
      throw new RustAuditableResourceFailure(
        {
          resource: "transport",
          reported_limits: { maximum_output_bytes: RUST_OUTPUT_BYTES },
        },
        "Dependency graph exceeds the complete report byte budget before expansion",
      );
  };
  const currentEdgeBytes = () =>
    edges * MIN_EDGE_OUTPUT_BYTES + Math.max(0, edges - 1);
  admit();
  for (const pkg of packages) {
    // Shape and index validity remain owned by documentSchema/rootIndex.
    if (
      typeof pkg === "object" &&
      pkg !== null &&
      "features" in pkg &&
      Array.isArray(pkg.features) &&
      pkg.features.every((feature) => typeof feature === "string")
    ) {
      const featureBudget =
        RUST_OUTPUT_BYTES - minimumBytes - currentEdgeBytes() + 4;
      const featureBytes = jsonValueByteLength(
        pkg.features as string[],
        featureBudget,
      );
      minimumBytes += featureBytes - 4;
      admit();
    }
    if (
      typeof pkg !== "object" ||
      pkg === null ||
      !("dependencies" in pkg) ||
      !Array.isArray(pkg.dependencies)
    )
      continue;
    const count = pkg.dependencies.length;
    edges += count;
    minimumBytes += Math.max(0, count * 2 - 1);
    admit();
  }
};

const PACKAGE_FIELDS = new Set([
  "name",
  "version",
  "source",
  "kind",
  "dependencies",
  "features",
  "root",
]);

const rejectMalformedPackages = (value: unknown): void => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("packages" in value) ||
    !Array.isArray(value.packages)
  )
    return;
  for (const [index, pkg] of value.packages.entries()) {
    if (!packageRecord(pkg))
      throw new RustAuditableFormatFailure(
        "malformed",
        `Dependency package ${String(index)} does not match the package schema`,
      );
  }
};

const packageRecord = (
  pkg: unknown,
): pkg is {
  readonly dependencies?: readonly unknown[];
  readonly features?: readonly unknown[];
} => {
  if (typeof pkg !== "object" || pkg === null || Array.isArray(pkg))
    return false;
  const record = pkg as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!PACKAGE_FIELDS.has(key)) return false;
  }
  if (
    !nonEmptyString(record.name) ||
    !nonEmptyString(record.version) ||
    !nonEmptyString(record.source)
  )
    return false;
  if (
    record.kind !== undefined &&
    record.kind !== "runtime" &&
    record.kind !== "build"
  )
    return false;
  if (record.root !== undefined && typeof record.root !== "boolean")
    return false;
  const dependencies = record.dependencies;
  if (
    dependencies !== undefined &&
    (!Array.isArray(dependencies) ||
      !dependencies.every(
        (entry) =>
          typeof entry === "number" && Number.isInteger(entry) && entry >= 0,
      ))
  )
    return false;
  const features = record.features;
  return (
    features === undefined ||
    (Array.isArray(features) && features.every(nonEmptyString))
  );
};

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const assertDepth = (text: string): void => {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === "{" || char === "[") {
      depth += 1;
      if (depth > JSON_DEPTH)
        throw new RustAuditableFormatFailure(
          "malformed",
          "Dependency JSON nesting exceeds 32 levels",
        );
    } else if ((char === "}" || char === "]") && depth > 0) depth -= 1;
  }
};

const normalizePackages = (
  packages: z.infer<typeof documentSchema>["packages"],
): RustPackage[] =>
  packages.map((pkg) => ({
    name: pkg.name,
    version: pkg.version,
    source: pkg.source,
    kind: pkg.kind ?? null,
    dependencies: pkg.dependencies ?? [],
    features: pkg.features ?? null,
    root: pkg.root ?? false,
  }));

const rootIndex = (packages: readonly RustPackage[]): number | null => {
  const roots = packages.flatMap((pkg, index) => (pkg.root ? [index] : []));
  if (roots.length > 1)
    throw new RustAuditableFormatFailure(
      "malformed",
      "Dependency JSON declares more than one root package",
    );
  for (const [index, pkg] of packages.entries()) {
    const outside = pkg.dependencies.find(
      (target) => target >= packages.length,
    );
    if (outside !== undefined)
      throw new RustAuditableFormatFailure(
        "malformed",
        `Dependency index ${String(outside)} from package ${String(index)} is outside the package list`,
      );
  }
  return roots[0] ?? null;
};
