import { TraceMap, decodedMappings } from "@jridgewell/trace-mapping";
import {
  SourceMapFormatFailure,
  type SourceMapLeaf,
} from "./SourceMapFormat.js";

/** Determine whether a leaf-local mapping falls before its enclosing boundary. */
const isBeforeSourceMapLeafStop = (
  leaf: SourceMapLeaf,
  line: number,
  column: number,
): boolean => {
  if (leaf.stop === null) return true;
  const generatedLine = leaf.offset.line + line;
  const generatedColumn = column + (line === 0 ? leaf.offset.column : 0);
  return (
    generatedLine < leaf.stop.line ||
    (generatedLine === leaf.stop.line && generatedColumn < leaf.stop.column)
  );
};

/** Decode leaf mappings and validate producer indices before any consumer publishes them. */
export const decodeValidatedSourceMapLeaves = (
  leaves: readonly SourceMapLeaf[],
  mapUrl: string,
  check?: () => void,
): readonly {
  readonly leaf: SourceMapLeaf;
  readonly map: TraceMap;
  readonly rows: ReturnType<typeof decodedMappings>;
}[] =>
  leaves.map((leaf) => {
    check?.();
    const map = new TraceMap(leaf.codecMap, mapUrl);
    const rows = decodedMappings(map);
    for (const [line, row] of rows.entries()) {
      if ((line & 255) === 0) check?.();
      for (const segment of row) {
        const generatedLine = leaf.offset.line + line;
        const generatedColumn =
          segment[0] + (line === 0 ? leaf.offset.column : 0);
        if (!isBeforeSourceMapLeafStop(leaf, line, segment[0]))
          throw new SourceMapFormatFailure(
            "section-overlap",
            "Embedded source-map mappings overlap the following section boundary.",
          );
        if (
          !Number.isSafeInteger(generatedLine) ||
          !Number.isSafeInteger(generatedColumn) ||
          ![1, 4, 5].includes(segment.length) ||
          segment.some((value) => !Number.isSafeInteger(value) || value < 0) ||
          (segment.length !== 1 && segment[1] >= leaf.map.sources.length) ||
          (segment.length === 5 && segment[4] >= leaf.map.names.length)
        )
          throw new SourceMapFormatFailure(
            "format",
            "Decoded local or absolute position, source index or name index is invalid.",
          );
      }
    }
    return { leaf, map, rows };
  });
