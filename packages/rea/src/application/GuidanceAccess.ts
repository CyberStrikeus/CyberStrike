import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
import { MANAGED_SKILL_FILES, readSkillFile } from "./SetupSkill.js";
import { PRODUCT_IDENTITY } from "../identity.js";
import {
  readGuidanceSectionInputSchema,
  readGuidanceSectionOutputSchema,
  type ReadGuidanceSectionOutput,
  type SearchGuidanceOutput,
  searchGuidanceInputSchema,
  searchGuidanceOutputSchema,
} from "../contracts/guidanceContracts.js";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  bindRegularFileCleanup,
  RetainedRegularFileCleanupFailure,
} from "./RegularFileRead.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  parseGuidanceSections,
  type GuideSection,
} from "./GuidanceSections.js";

const SKILL_ROOT = `../../skills/${PRODUCT_IDENTITY.skillName}/`;
const SOURCE = "installed_rea_guidance" as const;
const MAX_GUIDE_FILE_BYTES = 1_048_576;
const MAX_GUIDE_BUNDLE_BYTES = 4_194_304;
const sha256 = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

interface GuidanceBundle {
  readonly digest: string;
  readonly sections: readonly GuideSection[];
}

const readPackagedGuide = (
  relativePath: string,
  resources: ArtifactResourceScope,
): Promise<string> =>
  readSkillFile(
    fileURLToPath(new URL(`${SKILL_ROOT}${relativePath}`, import.meta.url)),
    resources,
    MAX_GUIDE_FILE_BYTES,
  );

type GuidanceBundleRead =
  | { readonly kind: "available"; readonly bundle: GuidanceBundle }
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "cleanup"; readonly error: ProviderCleanupError };

const guidanceCleanupFailure = (
  cause: unknown,
  resources: ArtifactResourceScope,
  operation: string,
): ProviderCleanupError => {
  const observation = ArtifactReaderFailure.cleanupObservation(
    cause,
    resources.cleanupResources,
  );
  const error = new ProviderCleanupError(
    "rea",
    resources.cleanupResources,
    { phase: "managed_guidance_read", reason: observation.reason },
    {
      operation,
      cause,
      cleanup: observation,
      remediationAction:
        "Close REA so it can retry releasing the retained guidance file handle. Do not repeat the request until cleanup completes.",
    },
  );
  bindRegularFileCleanup(cause, error);
  return error;
};

const readBundle = async (
  readGuide: (relativePath: string) => Promise<string>,
  resources: ArtifactResourceScope,
  operation: string,
): Promise<GuidanceBundleRead> => {
  const files = new Map<string, string>();
  let bundleBytes = 0;
  try {
    for (const relativePath of MANAGED_SKILL_FILES) {
      const content = await readGuide(relativePath);
      bundleBytes += Buffer.byteLength(content, "utf8");
      if (bundleBytes > MAX_GUIDE_BUNDLE_BYTES)
        return {
          kind: "unavailable",
          message:
            "Installed REA guidance exceeds the 4 MiB bundle allowance; no partial bundle was indexed.",
        };
      files.set(relativePath, content.replaceAll("\r\n", "\n"));
    }
  } catch (cause: unknown) {
    return cause instanceof RetainedRegularFileCleanupFailure ||
      (cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined)
      ? {
          kind: "cleanup",
          error: guidanceCleanupFailure(cause, resources, operation),
        }
      : {
          kind: "unavailable",
          message:
            "Installed REA guidance is missing or unreadable; no complete bundle could be indexed.",
        };
  }
  const digest = sha256(
    [...files]
      .map(([path, content]) => `${path}\0${sha256(content)}\n`)
      .join(""),
  );
  const sections = parseGuidanceSections(files);
  if (sections === undefined)
    return {
      kind: "unavailable",
      message:
        "Installed REA guidance exceeds the 4,096-section or 25,165,824 expanded UTF-16-code-unit index allowance; no partial index was used.",
    };
  return { kind: "available", bundle: { digest, sections } };
};

const words = (text: string): string[] => [
  ...new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []),
];

const GENERIC_QUERY_WORDS: ReadonlySet<string> = new Set([
  "a",
  "about",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "my",
  "of",
  "on",
  "or",
  "should",
  "so",
  "that",
  "the",
  "their",
  "there",
  "they",
  "this",
  "to",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

const sectionLocator = (
  bundle: GuidanceBundle,
  section: GuideSection,
): string => {
  const identity = JSON.stringify({
    v: 1,
    bundle: bundle.digest,
    guide: section.guide,
    ordinal: section.ordinal,
    section: sha256(section.content),
  });
  return `rea-guide-v1.${Buffer.from(identity).toString("base64url")}`;
};

type GuidanceReader = (
  relativePath: string,
  resources: ArtifactResourceScope,
) => Promise<string>;
type GuidanceResult<Value> = Result<
  Value,
  AnalysisInputError | ProviderCleanupError
>;

/** Admit the complete request once; file reads belong to its independent child. */
const runGuidanceOperation = async <Value>(
  resources: ArtifactResourceScope,
  operationName: string,
  operation: (child: ArtifactResourceScope) => Promise<GuidanceResult<Value>>,
): Promise<GuidanceResult<Value>> => {
  try {
    return await resources.run(async () => {
      const child = new ArtifactResourceScope();
      try {
        return await operation(child);
      } finally {
        if (child.hasPending)
          resources.retain({
            kind: "lease",
            resource: "managed guidance operation",
            lease: new AnalysisCleanupLease(() => child.close(), {
              get cleanupResources() {
                return child.cleanupResources;
              },
            }),
          });
        else await child.close();
      }
    });
  } catch (cause: unknown) {
    if (cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined)
      return err(guidanceCleanupFailure(cause, resources, operationName));
    throw cause;
  }
};

/** Reader seams receive the operation child rather than re-entering the root. */
export const searchGuidanceWithReader = (
  input: unknown,
  readGuide: GuidanceReader,
  resources: ArtifactResourceScope,
): Promise<GuidanceResult<SearchGuidanceOutput>> =>
  runGuidanceOperation(resources, "search_guidance", (child) =>
    searchGuidanceInScope(input, (path) => readGuide(path, child), child),
  );

export const readGuidanceSectionWithReader = (
  input: unknown,
  readGuide: GuidanceReader,
  resources: ArtifactResourceScope,
): Promise<GuidanceResult<ReadGuidanceSectionOutput>> =>
  runGuidanceOperation(resources, "read_guidance_section", (child) =>
    readGuidanceSectionInScope(input, (path) => readGuide(path, child), child),
  );

const invalidInput = (
  operation: string,
  input: unknown,
  issues: readonly z.core.$ZodIssue[],
): Result<never, AnalysisInputError> =>
  err(analysisInputErrorFromIssues(operation, issues, input));

export const searchGuidance = async (
  input: unknown,
  resources: ArtifactResourceScope,
): Promise<
  Result<SearchGuidanceOutput, AnalysisInputError | ProviderCleanupError>
> => searchGuidanceWithReader(input, readPackagedGuide, resources);

/** Reader seam keeps packaged-guide drift and missing-file behavior testable. */
const searchGuidanceInScope = async (
  input: unknown,
  readGuide: (relativePath: string) => Promise<string>,
  resources: ArtifactResourceScope,
): Promise<
  Result<SearchGuidanceOutput, AnalysisInputError | ProviderCleanupError>
> => {
  const parsed = searchGuidanceInputSchema.safeParse(input);
  if (!parsed.success)
    return invalidInput("search_guidance", input, parsed.error.issues);
  const cursor =
    parsed.data.cursor === undefined
      ? undefined
      : decodeGuidanceCursor(parsed.data.cursor);
  if (parsed.data.cursor !== undefined && cursor === undefined)
    return invalidInput("search_guidance", input, [
      {
        code: "custom",
        path: ["cursor"],
        message: "Invalid guidance continuation token",
      },
    ]);
  const queryDigest = sha256(parsed.data.query);
  if (cursor !== undefined && cursor.query !== queryDigest)
    return invalidInput("search_guidance", input, [
      {
        code: "custom",
        path: ["cursor"],
        message: "The continuation token belongs to a different query",
      },
    ]);
  const loaded = await readBundle(readGuide, resources, "search_guidance");
  if (loaded.kind === "cleanup") return err(loaded.error);
  if (loaded.kind === "unavailable")
    return ok(
      searchGuidanceOutputSchema.parse({
        status: "bundle_unavailable",
        source: SOURCE,
        content_kind: "documentation",
        message: loaded.message,
      }),
    );
  const bundle = loaded.bundle;

  if (cursor !== undefined && cursor.bundle !== bundle.digest)
    return ok(
      searchGuidanceOutputSchema.parse({
        status: "stale_continuation",
        source: SOURCE,
        content_kind: "documentation",
        message:
          "The installed guidance changed since this search page was issued. Restart the search to continue with current content.",
      }),
    );

  const queryWords = words(parsed.data.query);
  const specificQueryWords = queryWords.filter(
    (word) => !GENERIC_QUERY_WORDS.has(word),
  );
  const queryWordsToMatch = specificQueryWords;
  const ranked = bundle.sections
    .flatMap((section) => {
      const sectionWords = new Set(words(section.content));
      const matchedSpecific = queryWordsToMatch.filter((word) =>
        sectionWords.has(word),
      );
      if (
        queryWordsToMatch.length === 0 ||
        matchedSpecific.length !== queryWordsToMatch.length
      )
        return [];
      const matched = queryWords.filter((word) => sectionWords.has(word));
      const headingWords = new Set(words(section.heading));
      const score =
        matched.length +
        matched.filter((word) => headingWords.has(word)).length * 2;
      return {
        section,
        matched,
        score,
        wordCount: sectionWords.size,
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        // Prefer a focused recipe over a long overview when term scores tie.
        left.wordCount - right.wordCount ||
        compareText(left.section.guide, right.section.guide) ||
        left.section.ordinal - right.section.ordinal,
    );

  if (ranked.length === 0)
    return ok(
      searchGuidanceOutputSchema.parse({
        status: "no_matches",
        source: SOURCE,
        content_kind: "documentation",
        query: parsed.data.query,
        message:
          "No bundled guidance sections matched this query. This does not indicate whether an analysis capability is available.",
        total_matches: 0,
      }),
    );

  const offset = cursor?.offset ?? 0;
  if (cursor !== undefined && offset >= ranked.length)
    return invalidInput("search_guidance", input, [
      {
        code: "custom",
        path: ["cursor"],
        message:
          "The continuation token does not select a remaining result page",
      },
    ]);
  const page = ranked.slice(offset, offset + parsed.data.limit);
  const hasMore = offset + page.length < ranked.length;
  return ok(
    searchGuidanceOutputSchema.parse({
      status: "matches",
      source: SOURCE,
      content_kind: "documentation",
      package: `${PRODUCT_IDENTITY.packageName}@${PRODUCT_IDENTITY.packageVersion}`,
      bundle_sha256: bundle.digest,
      query: parsed.data.query,
      matches: page.map(({ section, matched }) => ({
        guide: section.guide,
        heading: section.heading,
        locator: sectionLocator(bundle, section),
        matched_terms: matched,
        relevance: `Matched ${matched.join(", ")} in this section.`,
        context: contextFor(section.content, matched),
      })),
      total_matches: ranked.length,
      offset,
      limit: parsed.data.limit,
      has_more: hasMore,
      ...(hasMore
        ? {
            next_cursor: encodeGuidanceCursor({
              v: 1,
              bundle: bundle.digest,
              query: queryDigest,
              offset: offset + page.length,
            }),
          }
        : {}),
    }),
  );
};

export const readGuidanceSection = async (
  input: unknown,
  resources: ArtifactResourceScope,
): Promise<
  Result<ReadGuidanceSectionOutput, AnalysisInputError | ProviderCleanupError>
> => readGuidanceSectionWithReader(input, readPackagedGuide, resources);

/** Reader seam keeps packaged-guide drift and missing-file behavior testable. */
const readGuidanceSectionInScope = async (
  input: unknown,
  readGuide: (relativePath: string) => Promise<string>,
  resources: ArtifactResourceScope,
): Promise<
  Result<ReadGuidanceSectionOutput, AnalysisInputError | ProviderCleanupError>
> => {
  const parsed = readGuidanceSectionInputSchema.safeParse(input);
  if (!parsed.success)
    return invalidInput("read_guidance_section", input, parsed.error.issues);
  const identity = decodeLocator(parsed.data.locator);
  if (identity === undefined)
    return invalidInput("read_guidance_section", input, [
      {
        code: "custom",
        path: ["locator"],
        message: "Malformed or unsupported guidance locator",
      },
    ]);
  const loaded = await readBundle(
    readGuide,
    resources,
    "read_guidance_section",
  );
  if (loaded.kind === "cleanup") return err(loaded.error);
  if (loaded.kind === "unavailable")
    return ok(
      readGuidanceSectionOutputSchema.parse({
        status: "bundle_unavailable",
        source: SOURCE,
        content_kind: "documentation",
        message: loaded.message,
      }),
    );
  const bundle = loaded.bundle;
  if (identity.bundle !== bundle.digest)
    return ok(
      readGuidanceSectionOutputSchema.parse({
        status: "stale_locator",
        source: SOURCE,
        content_kind: "documentation",
        message:
          "The installed guidance changed since this locator was issued. Search again for a current locator.",
      }),
    );
  const section = bundle.sections.find(
    (candidate) =>
      candidate.guide === identity.guide &&
      candidate.ordinal === identity.ordinal &&
      sha256(candidate.content) === identity.section,
  );
  if (section === undefined)
    return ok(
      readGuidanceSectionOutputSchema.parse({
        status: "stale_locator",
        source: SOURCE,
        content_kind: "documentation",
        message:
          "The selected section is no longer present in the installed guidance. Search again.",
      }),
    );
  return ok(
    readGuidanceSectionOutputSchema.parse({
      status: "section",
      source: SOURCE,
      content_kind: "documentation",
      package: `${PRODUCT_IDENTITY.packageName}@${PRODUCT_IDENTITY.packageVersion}`,
      bundle_sha256: bundle.digest,
      guide: section.guide,
      heading: section.heading,
      locator: parsed.data.locator,
      content: section.content,
    }),
  );
};

interface LocatorIdentity {
  readonly v: 1;
  readonly bundle: string;
  readonly guide: string;
  readonly ordinal: number;
  readonly section: string;
}

interface GuidanceCursor {
  readonly v: 1;
  readonly bundle: string;
  readonly query: string;
  readonly offset: number;
}

const encodeGuidanceCursor = (cursor: GuidanceCursor): string =>
  `rea-guidance-page-v1.${Buffer.from(JSON.stringify(cursor)).toString("base64url")}`;

const decodeGuidanceCursor = (cursor: string): GuidanceCursor | undefined => {
  const prefix = "rea-guidance-page-v1.";
  if (!cursor.startsWith(prefix)) return undefined;
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor.slice(prefix.length), "base64url").toString("utf8"),
    );
    if (typeof value !== "object" || value === null) return undefined;
    const item = value as Partial<GuidanceCursor>;
    if (
      item.v !== 1 ||
      typeof item.bundle !== "string" ||
      !/^[a-f0-9]{64}$/u.test(item.bundle) ||
      typeof item.query !== "string" ||
      !/^[a-f0-9]{64}$/u.test(item.query) ||
      typeof item.offset !== "number" ||
      !Number.isInteger(item.offset) ||
      item.offset < 1
    )
      return undefined;
    return item as GuidanceCursor;
  } catch {
    return undefined;
  }
};

const decodeLocator = (locator: string): LocatorIdentity | undefined => {
  if (!locator.startsWith("rea-guide-v1.")) return undefined;
  try {
    const value: unknown = JSON.parse(
      Buffer.from(locator.slice("rea-guide-v1.".length), "base64url").toString(
        "utf8",
      ),
    );
    if (typeof value !== "object" || value === null) return undefined;
    const item = value as Partial<LocatorIdentity>;
    if (
      item.v !== 1 ||
      typeof item.bundle !== "string" ||
      !/^[a-f0-9]{64}$/u.test(item.bundle) ||
      typeof item.guide !== "string" ||
      !(MANAGED_SKILL_FILES as readonly string[]).includes(item.guide) ||
      !Number.isInteger(item.ordinal) ||
      typeof item.section !== "string" ||
      !/^[a-f0-9]{64}$/u.test(item.section)
    )
      return undefined;
    return item as LocatorIdentity;
  } catch {
    return undefined;
  }
};

const contextFor = (content: string, matched: readonly string[]): string => {
  const lines = content.split("\n");
  const heading = lines[0] ?? "";
  const terms = new Set(matched);
  let bestIndex = -1;
  let bestScore = 0;
  lines.slice(1).forEach((line, index) => {
    const score = words(line).filter((word) => terms.has(word)).length;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index + 1;
    }
  });
  const excerptStart = bestIndex < 0 ? 1 : Math.max(1, bestIndex - 1);
  const excerptEnd = bestIndex < 0 ? 4 : bestIndex + 2;
  return [heading, ...lines.slice(excerptStart, excerptEnd)]
    .join(" ")
    .replaceAll(/\s+/gu, " ")
    .slice(0, 500);
};

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;
