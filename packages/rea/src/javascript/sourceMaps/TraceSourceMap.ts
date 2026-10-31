import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { getHeapStatistics } from "node:v8";
import {
  AnyMap,
  TraceMap,
  decodedMappings,
  type SourceMapSegment,
} from "@jridgewell/trace-mapping";
import { z } from "zod";
import { javaScriptRuntime } from "../../domain/runtimeVersion.js";
import { javaScriptWorkerMemoryLimitBytes } from "../../process/JavaScriptWorkerMemoryLimit.js";
import { webSourceOffset } from "../../domain/webSourcePosition.js";
import { resolveJavaScriptSourceMapUrl } from "../../domain/javascript/javascriptSourceMapPaths.js";
import {
  webSourceMapReportSchema,
  type WebSourceMapReport,
  WEB_SOURCE_MAP_LIMITS,
} from "../../domain/webSourceLocation.js";
import type { WebSourcePosition } from "../../domain/webSourcePosition.js";
import {
  inspectSourceMap,
  SourceMapFormatFailure,
  type SourceMapSourceDeclaration,
} from "./SourceMapFormat.js";
import { decodeValidatedSourceMapLeaves } from "./DecodedSourceMap.js";

/** Decode with the pinned upstream codec; preserve every equal-position candidate. */
export const traceSourceMap = (
  text: string,
  url: string,
  position: WebSourcePosition,
): WebSourceMapReport => {
  const inspected = inspectSourceMap(text);
  const decodedLeaves = decodeValidatedSourceMapLeaves(inspected.leaves, url);
  let map: TraceMap;
  if (inspected.format === "regular") {
    const decoded = decodedLeaves[0];
    if (decoded === undefined)
      throw new SourceMapFormatFailure(
        "format",
        "Regular source map has no validated leaf.",
      );
    map = decoded.map;
  } else {
    map = new AnyMap(
      {
        version: 3,
        sections: decodedLeaves.map(({ leaf, map: sectionMap }) => ({
          offset: leaf.offset,
          map: sectionMap,
        })),
      },
      url,
    );
  }
  const rows =
    inspected.format === "regular"
      ? (decodedLeaves[0]?.rows ?? [])
      : decodedMappings(map);
  validateFlattenedRows(inspected, rows, map);
  const matched = greatestPosition(rows, position);
  const segments =
    matched === null
      ? []
      : (rows[matched.line - 1] ?? []).filter(
          (segment) => segment[0] === matched.column,
        );
  let bytes = 0;
  const matches: WebSourceMapReport["matches"] = [];
  for (const segment of segments) {
    const match = originalMatch(segment, map, url, inspected.declarations);
    bytes += Buffer.byteLength(JSON.stringify(match)) + 1;
    if (bytes > WEB_SOURCE_MAP_LIMITS.outputBytes)
      throw new SourceMapFormatFailure(
        "limit",
        "Complete source-map point evidence exceeds the 32 MiB output budget; no partial evidence was returned.",
      );
    matches.push(match);
  }
  const metadata: unknown = createRequire(import.meta.url)(
    "@jridgewell/trace-mapping/package.json",
  );
  const version = z
    .object({ version: z.string().min(1) })
    .parse(metadata).version;
  const runtime = javaScriptRuntime(process.versions);
  return webSourceMapReportSchema.parse({
    source_map_sha256: createHash("sha256").update(text).digest("hex"),
    url_context: url,
    engine: { id: "jridgewell-trace-mapping", version },
    // Bun reports V8-shaped heap statistics but ignores the codec's heap flags.
    // Its launcher applies the same runtime policy, and the parent verifies it.
    runtime:
      runtime.id === "node"
        ? {
            id: "node-v8",
            version: process.version,
            v8_heap_limit_bytes: getHeapStatistics().heap_size_limit,
          }
        : {
            id: "bun",
            version: runtime.version,
            node_compatibility_version: runtime.nodeCompatibilityVersion,
            v8_heap_limit_bytes: null,
            process_memory_limit_bytes: javaScriptWorkerMemoryLimitBytes(
              WEB_SOURCE_MAP_LIMITS.codecHeapMiB,
            ),
          },
    format: inspected.format,
    reported_file: inspected.reportedFile,
    lookup: {
      requested: position,
      matched_generated_position: matched,
      semantics:
        "greatest generated position <= requested, across lines; all equal-position segments",
      location_units: "one-based lines; zero-based UTF-16 columns",
    },
    matches,
    diagnostics: [],
  });
};

const validateFlattenedRows = (
  inspected: ReturnType<typeof inspectSourceMap>,
  rows: ReturnType<typeof decodedMappings>,
  map: ReturnType<typeof AnyMap>,
): void => {
  for (const row of rows)
    for (const segment of row) {
      if (
        (segment.length !== 1 && segment[1] >= inspected.declarations.length) ||
        (segment.length === 5 && segment[4] >= map.names.length)
      )
        throw new SourceMapFormatFailure(
          "format",
          "Decoded mapping has invalid component count, position, source index or name index.",
        );
    }
};

const greatestPosition = (
  rows: ReturnType<typeof decodedMappings>,
  position: WebSourcePosition,
): WebSourcePosition | null => {
  for (
    let line = Math.min(position.line - 1, rows.length - 1);
    line >= 0;
    line -= 1
  ) {
    let column: number | undefined;
    for (const segment of rows[line] ?? [])
      if (line < position.line - 1 || segment[0] <= position.column)
        column = segment[0];
    if (column !== undefined) return { line: line + 1, column };
  }
  return null;
};
const originalMatch = (
  segment: Readonly<SourceMapSegment>,
  map: TraceMap,
  mapUrl: string,
  declarations: readonly SourceMapSourceDeclaration[],
): WebSourceMapReport["matches"][number] => {
  if (segment.length === 1) return { state: "generated-only" };
  const declaration = declarations[segment[1]];
  if (declaration === undefined)
    throw new SourceMapFormatFailure(
      "format",
      "Mapping references an absent source declaration.",
    );
  const original = { line: segment[2] + 1, column: segment[3] };
  const offset =
    declaration.content === null
      ? undefined
      : webSourceOffset(declaration.content, original);
  return {
    state: "mapped",
    flattened_source_index: segment[1],
    section_path: [...declaration.sectionPath],
    source_index: declaration.sourceIndex,
    reported_source: declaration.source,
    reported_source_root: declaration.root,
    resolved_url: resolveJavaScriptSourceMapUrl(
      declaration.source,
      declaration.root,
      mapUrl,
    ),
    ignored: declaration.ignored,
    content:
      declaration.content === null
        ? { state: "unavailable", reason: "sourcesContent-not-retained" }
        : {
            state: "embedded",
            text: declaration.content,
            utf8_sha256: createHash("sha256")
              .update(declaration.content)
              .digest("hex"),
            utf8_bytes: Buffer.byteLength(declaration.content),
            representation: "UTF-8 encoding of decoded sourcesContent text",
          },
    original_position: {
      ...original,
      offset: offset ?? null,
      content_position:
        declaration.content === null
          ? "content-unavailable"
          : offset === undefined
            ? "outside-embedded-text"
            : "verified-in-embedded-text",
    },
    name: segment.length === 5 ? (map.names[segment[4]] ?? null) : null,
  };
};
