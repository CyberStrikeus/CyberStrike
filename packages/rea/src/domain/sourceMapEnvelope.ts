import { z } from "zod";

/** Artifact source declarations do not require generated-position decoding. */
type SourceMapRecord = Readonly<Record<string, unknown>>;

export interface ExternalSourceMapSection {
  readonly section_path: readonly number[];
  readonly url: string;
}

export interface InvalidSourceMapSection {
  readonly section_path: readonly number[];
  readonly reason: string;
}

export interface SourceMapLeaf {
  readonly section_path: readonly number[];
  readonly map: Readonly<Record<string, unknown>>;
}

export type SourceMapSection =
  | { readonly kind: "embedded"; readonly map: SourceMapRecord }
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "invalid"; readonly reason: string };

export type SourceMapSectionList =
  | { readonly kind: "regular" }
  | { readonly kind: "indexed"; readonly sections: readonly unknown[] }
  | { readonly kind: "invalid"; readonly reason: string };

export type SourceMapEnvelope =
  | { readonly status: "invalid"; readonly reason: string }
  | {
      readonly status: "included" | "unsupported" | "malformed";
      readonly leaves: readonly SourceMapLeaf[];
      readonly external_sections: readonly ExternalSourceMapSection[];
      readonly invalid_sections: readonly InvalidSourceMapSection[];
    };

/** ECMA-426 requires a string mapping payload on every regular map leaf. */
export const sourceMapMappingsSchema = z.string();

/**
 * Return the JSON parsing view of retained source-map text. ECMA-426 permits
 * HTTP responses to start with `)]}'`; the first line is transport framing.
 * Keep the original text for artifact identity and Evidence provenance.
 * https://tc39.es/ecma426/#sec-fetchsourcemap
 */
export const sourceMapJsonText = (text: string): string => {
  const withoutBom = text.replace(/^\uFEFF/u, "");
  if (!withoutBom.startsWith(")]}'")) return withoutBom;
  const newline = withoutBom.search(/[\r\n]/u);
  return newline === -1 ? "" : withoutBom.slice(newline);
};

const isRecord = (value: unknown): value is SourceMapRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Classify section ownership once; an external URL takes precedence over map. */
export const classifySourceMapSection = (
  section: unknown,
): SourceMapSection => {
  if (!isRecord(section))
    return {
      kind: "invalid",
      reason: "Indexed source-map section must be an object.",
    };
  if (Object.prototype.hasOwnProperty.call(section, "url"))
    return typeof section.url === "string"
      ? { kind: "external", url: section.url }
      : {
          kind: "invalid",
          reason: "External source-map section URL must be a string.",
        };
  if (!isRecord(section.map))
    return {
      kind: "invalid",
      reason:
        "Indexed source-map section requires an embedded map or external URL.",
    };
  if (!isVersion3Map(section.map))
    return {
      kind: "invalid",
      reason: "Indexed source-map section map is not a version 3 map.",
    };
  return { kind: "embedded", map: section.map };
};

/** A present `sections` member must be an array in every source-map consumer. */
export const classifySourceMapSections = (
  map: unknown,
): SourceMapSectionList => {
  if (!isRecord(map))
    return { kind: "invalid", reason: "Source map must be an object." };
  if (!Object.prototype.hasOwnProperty.call(map, "sections"))
    return { kind: "regular" };
  return Array.isArray(map.sections)
    ? { kind: "indexed", sections: map.sections }
    : {
        kind: "invalid",
        reason: "Indexed source-map sections must be an array.",
      };
};

/** Whether a parsed value has the version-3 map shape. */
const isVersion3Map = (value: unknown): value is SourceMapRecord =>
  isRecord(value) && value.version === 3;

/**
 * Collect valid embedded leaves and retain external or malformed section
 * facts. A map with neither `mappings` nor `sections` is a leaf; callers
 * decide whether that leaf has valid declarations and mappings.
 */
interface SectionPath {
  readonly parent: SectionPath | null;
  readonly index: number;
}

const materializeSectionPath = (path: SectionPath | null): number[] => {
  const result: number[] = [];
  for (let current = path; current !== null; current = current.parent)
    result.push(current.index);
  return result.reverse();
};

const compareSectionPaths = (
  left: readonly number[],
  right: readonly number[],
): number => {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const leftIndex = left[index] ?? 0;
    const rightIndex = right[index] ?? 0;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  }
  return left.length - right.length;
};

/** Walk embedded maps while retaining unsupported and malformed section facts. */
export const inspectSourceMapEnvelope = (root: unknown): SourceMapEnvelope => {
  if (!isVersion3Map(root))
    return { status: "invalid", reason: "Source map is not a version 3 map." };
  const leaves: SourceMapLeaf[] = [];
  const externalSections: {
    readonly path: SectionPath;
    readonly url: string;
  }[] = [];
  const invalidSections: {
    readonly path: SectionPath | null;
    readonly reason: string;
  }[] = [];
  const pending: {
    readonly map: SourceMapRecord;
    readonly path: SectionPath | null;
  }[] = [{ map: root, path: null }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    const map = current.map;
    const sectionList = classifySourceMapSections(map);
    if (sectionList.kind === "invalid") {
      invalidSections.push({ path: current.path, reason: sectionList.reason });
      continue;
    }
    if (sectionList.kind === "indexed") {
      const children: {
        readonly map: SourceMapRecord;
        readonly path: SectionPath;
      }[] = [];
      for (let index = 0; index < sectionList.sections.length; index += 1) {
        const section = sectionList.sections[index];
        const path = { parent: current.path, index };
        const classification = classifySourceMapSection(section);
        if (classification.kind === "external")
          externalSections.push({ path, url: classification.url });
        else if (classification.kind === "invalid")
          invalidSections.push({ path, reason: classification.reason });
        else children.push({ map: classification.map, path });
      }
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child !== undefined) pending.push(child);
      }
    } else
      leaves.push({
        section_path: materializeSectionPath(current.path),
        map,
      });
  }
  const external = externalSections
    .map(({ path, url }) => ({
      section_path: materializeSectionPath(path),
      url,
    }))
    .sort((left, right) =>
      compareSectionPaths(left.section_path, right.section_path),
    );
  const invalid = invalidSections
    .map(({ path, reason }) => ({
      section_path: materializeSectionPath(path),
      reason,
    }))
    .sort((left, right) =>
      compareSectionPaths(left.section_path, right.section_path),
    );
  const status =
    invalid.length > 0
      ? "malformed"
      : external.length > 0
        ? "unsupported"
        : "included";
  return {
    status,
    leaves,
    external_sections: external,
    invalid_sections: invalid,
  };
};
