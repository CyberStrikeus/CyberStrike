import { z } from "zod";
import { WEB_SOURCE_MAP_LIMITS } from "../../domain/webSourceLocation.js";
import {
  classifySourceMapSection,
  classifySourceMapSections,
  sourceMapJsonText,
  sourceMapMappingsSchema,
} from "../../domain/sourceMapEnvelope.js";
import type { SourceMapSection } from "../../domain/sourceMapEnvelope.js";
import type { EncodedSourceMapXInput } from "@jridgewell/trace-mapping";

const leafSchema = z.object({
  version: z.literal(3),
  file: z.string().nullable().optional(),
  sourceRoot: z.string().nullable().optional(),
  sources: z.array(z.string().nullable()),
  sourcesContent: z.array(z.string().nullable()).nullable().optional(),
  names: z.array(z.string()).default([]),
  mappings: sourceMapMappingsSchema.regex(/^[A-Za-z0-9+/,;]*$/u),
  ignoreList: z.array(z.int().min(0)).optional(),
  x_google_ignoreList: z.array(z.int().min(0)).optional(),
});
const mapHeaderSchema = z.object({
  version: z.literal(3),
  file: z.string().nullable().optional(),
  sections: z.unknown().optional(),
});
const sectionSchema = z.object({
  offset: z.object({
    line: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
    column: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
  }),
  map: z.unknown().optional(),
  url: z.unknown().optional(),
});
type Offset = { readonly line: number; readonly column: number };
interface PendingMap {
  readonly value: unknown;
  readonly path: readonly number[];
  readonly offset: Offset;
  readonly stop: Offset | null;
}

/** Shared structural constraints configurable only for stricter consumers. */
export interface SourceMapStructureBudget {
  records: number;
}

export interface SourceMapStructureOptions {
  readonly profile?: "browser-collection";
  readonly budget?: SourceMapStructureBudget;
  readonly check?: () => void;
}

/** A decoder-profile failure with an actionable producer constraint. */
export class SourceMapFormatFailure extends Error {
  constructor(
    readonly reason: "format" | "unsupported" | "limit" | "section-overlap",
    message: string,
  ) {
    super(message);
  }
}

/** Raw declaration identity, separate from flattened engine URL identity. */
export interface SourceMapSourceDeclaration {
  readonly sectionPath: readonly number[];
  readonly sourceIndex: number;
  readonly source: string | null;
  readonly root: string | null;
  readonly content: string | null;
  readonly ignored: boolean;
}

/** Validated leaf with absolute first-line offsets and its enclosing section boundary. */
export interface SourceMapLeaf {
  readonly map: z.output<typeof leafSchema>;
  readonly codecMap: EncodedSourceMapXInput;
  readonly offset: Offset;
  readonly stop: Offset | null;
}

const codecLeaf = (
  map: z.output<typeof leafSchema>,
): EncodedSourceMapXInput => ({
  version: 3,
  ...(map.file === undefined ? {} : { file: map.file }),
  ...(typeof map.sourceRoot === "string" ? { sourceRoot: map.sourceRoot } : {}),
  sources: map.sources,
  ...(map.sourcesContent == null ? {} : { sourcesContent: map.sourcesContent }),
  names: map.names,
  mappings: map.mappings,
  ...(map.ignoreList === undefined ? {} : { ignoreList: map.ignoreList }),
  ...(map.x_google_ignoreList === undefined
    ? {}
    : { x_google_ignoreList: map.x_google_ignoreList }),
});

const compare = (a: Offset, b: Offset): number =>
  a.line - b.line || a.column - b.column;
const addOffset = (base: Offset, offset: Offset): Offset => {
  const result = {
    line: base.line + offset.line,
    column: offset.column + (offset.line === 0 ? base.column : 0),
  };
  if (
    !Number.isSafeInteger(result.line) ||
    !Number.isSafeInteger(result.column) ||
    result.line >= WEB_SOURCE_MAP_LIMITS.decodedRows
  )
    throw new SourceMapFormatFailure(
      "limit",
      "Indexed offset exceeds the 262144 generated-row decoder budget.",
    );
  return result;
};

const consumeRecords = (budget: { records: number }, count: number): void => {
  if (count > WEB_SOURCE_MAP_LIMITS.decodedRecords - budget.records)
    throw new SourceMapFormatFailure(
      "limit",
      `Source-map structure exceeds the ${WEB_SOURCE_MAP_LIMITS.decodedRecords}-record decoder budget.`,
    );
  budget.records += count;
};

const addSections = ({
  node,
  pending,
  rawSections,
  budget,
  options,
}: {
  readonly node: PendingMap;
  readonly pending: PendingMap[];
  readonly rawSections: readonly unknown[];
  readonly budget: { records: number };
  readonly options: SourceMapStructureOptions;
}): void => {
  options.check?.();
  consumeRecords(budget, rawSections.length);
  const sections = z.array(sectionSchema).parse(rawSections);
  const embeddedMaps: Extract<
    SourceMapSection,
    { readonly kind: "embedded" }
  >["map"][] = [];
  for (const [index, section] of sections.entries()) {
    if ((index & 255) === 0) options.check?.();
    const previous = sections[index - 1];
    if (previous !== undefined && compare(section.offset, previous.offset) < 0)
      throw new SourceMapFormatFailure(
        "format",
        "Indexed section offsets must be in nondecreasing order.",
      );
    const classification = classifySourceMapSection(section);
    if (classification.kind === "external")
      throw new SourceMapFormatFailure(
        "unsupported",
        `External source-map section URL is not fetched: ${classification.url}`,
      );
    if (classification.kind === "invalid")
      throw new SourceMapFormatFailure(
        "format",
        `${classification.reason} Section path: ${JSON.stringify([...node.path, index])}.`,
      );
    embeddedMaps.push(classification.map);
  }
  for (let index = sections.length - 1; index >= 0; index -= 1) {
    const section = sections[index];
    if (section === undefined) continue;
    const map = embeddedMaps[index];
    if (map === undefined)
      throw new SourceMapFormatFailure(
        "format",
        "Validated indexed section map is unavailable.",
      );
    const next = sections[index + 1];
    const nextOffset =
      next === undefined ? null : addOffset(node.offset, next.offset);
    const stop =
      nextOffset === null
        ? node.stop
        : node.stop === null || compare(nextOffset, node.stop) < 0
          ? nextOffset
          : node.stop;
    const offset = addOffset(node.offset, section.offset);
    pending.push({
      value: map,
      path: [...node.path, index],
      offset,
      stop,
    });
  }
};

const inspectMappingLayout = (
  mappings: string,
  check?: () => void,
): { lines: number; segments: number } => {
  let lines = 1;
  let segments = 0;
  let components = 0;
  let inSegment = false;
  let continued = false;
  let digits = 0;
  const finish = (): void => {
    if (continued)
      throw new SourceMapFormatFailure(
        "format",
        "Source-map VLQ ends with an unfinished continuation.",
      );
    if (inSegment && ![1, 4, 5].includes(components))
      throw new SourceMapFormatFailure(
        "format",
        "Source-map segment requires one, four or five VLQ components.",
      );
  };
  let index = 0;
  for (const character of mappings) {
    if ((index++ & 0x3fff) === 0) check?.();
    if (character === "," || character === ";") {
      finish();
      inSegment = false;
      components = 0;
      if (character === ";") lines += 1;
    } else {
      digits += 1;
      if (
        (digits === 7 && !/[A-Dg-j]/u.test(character)) ||
        (digits > 7 && character !== "A" && character !== "g")
      )
        throw new SourceMapFormatFailure(
          "format",
          "Source-map VLQ exceeds the format's 32-bit quantity representation.",
        );
      if (!inSegment) segments += 1;
      inSegment = true;
      continued = /[g-z0-9+/]/u.test(character);
      if (!continued) {
        components += 1;
        digits = 0;
      }
    }
    if (
      segments > WEB_SOURCE_MAP_LIMITS.decodedSegments ||
      lines > WEB_SOURCE_MAP_LIMITS.decodedRows
    )
      throw new SourceMapFormatFailure(
        "limit",
        "Source-map layout exceeds the 262144 segment/generated-row decoder budget.",
      );
  }
  finish();
  return { lines, segments };
};

const inspectLeaf = (
  node: PendingMap,
  budget: { records: number },
  options: SourceMapStructureOptions,
): z.output<typeof leafSchema> => {
  options.check?.();
  consumeRecords(budget, 1);
  if (
    typeof node.value !== "object" ||
    node.value === null ||
    Array.isArray(node.value)
  )
    return leafSchema.parse(node.value);
  const rawMap = node.value as Readonly<Record<string, unknown>>;
  const rawSources = rawMap.sources;
  const rawNames = rawMap.names;
  const rawContents = rawMap.sourcesContent;
  consumeRecords(budget, Array.isArray(rawSources) ? rawSources.length : 0);
  consumeRecords(budget, Array.isArray(rawNames) ? rawNames.length : 0);
  consumeRecords(budget, Array.isArray(rawContents) ? rawContents.length : 0);
  options.check?.();
  const leaf = leafSchema.parse(node.value);
  const layout = inspectMappingLayout(leaf.mappings, options.check);
  consumeRecords(budget, layout.segments + layout.lines);
  if (
    layout.segments > WEB_SOURCE_MAP_LIMITS.decodedSegments ||
    node.offset.line + layout.lines > WEB_SOURCE_MAP_LIMITS.decodedRows
  )
    throw new SourceMapFormatFailure(
      "limit",
      "Source-map layout exceeds the 262144 segment/generated-row decoder budget.",
    );
  return leaf;
};

/** Validate structure before allocation, retaining raw declarations and section boundaries. */
export const inspectSourceMap = (
  text: string,
): ReturnType<typeof inspectSourceMapValue> => {
  const jsonText = sourceMapJsonText(text);
  const value: unknown = JSON.parse(jsonText);
  return inspectSourceMapValue(value);
};

/** Return validated leaves when a consumer needs decoded rows after preflight. */
export const inspectSourceMapValue = (
  value: unknown,
  options: SourceMapStructureOptions = {},
): {
  readonly format: "regular" | "indexed";
  readonly reportedFile: string | null;
  readonly declarations: readonly SourceMapSourceDeclaration[];
  readonly leaves: readonly SourceMapLeaf[];
} => {
  options.check?.();
  const root = mapHeaderSchema.parse(value);
  const declarations: SourceMapSourceDeclaration[] = [];
  const leaves: SourceMapLeaf[] = [];
  const pending: PendingMap[] = [
    { value, path: [], offset: { line: 0, column: 0 }, stop: null },
  ];
  const budget = options.budget ?? { records: 0 };
  while (pending.length > 0) {
    options.check?.();
    const node = pending.pop();
    if (node === undefined) break;
    if (node.path.length > WEB_SOURCE_MAP_LIMITS.sectionDepth)
      throw new SourceMapFormatFailure(
        "limit",
        "Indexed source-map nesting exceeds the 64-level decoder stack budget.",
      );
    const sections = classifySourceMapSections(node.value);
    if (sections.kind === "invalid")
      throw new SourceMapFormatFailure("format", sections.reason);
    if (sections.kind === "indexed") {
      addSections({
        node,
        pending,
        rawSections: sections.sections,
        budget,
        options,
      });
      continue;
    }
    const leaf = inspectLeaf(node, budget, options);
    leaves.push({
      map: leaf,
      codecMap: codecLeaf(leaf),
      offset: node.offset,
      stop: node.stop,
    });
    if (options.profile !== "browser-collection") {
      const ignoredSources = new Set(
        leaf.ignoreList ?? leaf.x_google_ignoreList ?? [],
      );
      for (const [sourceIndex, source] of leaf.sources.entries())
        declarations.push({
          sectionPath: node.path,
          sourceIndex,
          source,
          root: leaf.sourceRoot ?? null,
          content: leaf.sourcesContent?.[sourceIndex] ?? null,
          ignored: ignoredSources.has(sourceIndex),
        });
    }
  }
  return {
    format: root.sections === undefined ? "regular" : "indexed",
    reportedFile: root.file ?? null,
    declarations,
    leaves,
  };
};
