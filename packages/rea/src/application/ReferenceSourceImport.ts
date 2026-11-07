import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";
import {
  createHistoricalSourceGraph,
  historicalSourceInventoryHasPartialFacts,
  historicalSourceLanguages,
  historicalSourceManifests,
  historicalSourceParseFailureKey,
  historicalSourceRelationshipKey,
  type HistoricalSourceGraph,
  type HistoricalSourceGraphInput,
} from "../domain/referenceSourceGraph.js";
import { err, ok, type Result } from "../domain/result.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import type { AnalysisCleanupObservation } from "../domain/analysisErrorBase.js";
import { readReferenceSource } from "../reference/ReferenceSourceReader.js";
import type {
  ReferenceSourceExclusionKind,
  ReferenceSourceRead,
  ReferenceSourceReaderError,
} from "../reference/ReferenceSourceReaderTypes.js";
import { parseReferenceSourceEntries } from "./ReferenceSourceImportEntries.js";
import { readReferenceSourceVcs } from "./ReferenceSourceVcsAdapter.js";
import type {
  ReferenceSourceImportError,
  ReferenceSourceImportOptions,
} from "./ReferenceSourceImportTypes.js";
import {
  prepareReferenceSourceImport,
  type PreparedReferenceSourceImport,
} from "./ReferenceSourceImportPolicy.js";

const failure = (
  code: ReferenceSourceImportError["code"],
  message: string,
): ReferenceSourceImportError => ({
  tag: "reference-source-import",
  code,
  message,
});

const cancelled = (
  partial?: ReferenceSourceRead,
): ReferenceSourceImportError => ({
  ...failure("cancelled", "Reference source import cancelled"),
  ...(partial === undefined ? {} : { partial }),
});

const isAborted = (signal?: AbortSignal): boolean => signal?.aborted === true;

const deduplicateRelationships = (
  relationships: HistoricalSourceGraphInput["relationships"],
): HistoricalSourceGraphInput["relationships"] => {
  const seen = new Set<string>();
  const result: HistoricalSourceGraphInput["relationships"] = [];
  for (const relationship of relationships) {
    const key = historicalSourceRelationshipKey(relationship);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(relationship);
  }
  return result;
};

/** Sort parse failures deterministically while retaining distinct reasons. */
export const normalizeHistoricalSourceParseFailures = (
  failures: HistoricalSourceGraphInput["parse_failures"],
): HistoricalSourceGraphInput["parse_failures"] =>
  [...failures]
    .sort((left, right) =>
      compareUnicodeCodePoints(
        historicalSourceParseFailureKey(left),
        historicalSourceParseFailureKey(right),
      ),
    )
    .filter((value, index, array) => {
      if (index === 0) return true;
      const previous = array[index - 1];
      return (
        previous === undefined ||
        historicalSourceParseFailureKey(value) !==
          historicalSourceParseFailureKey(previous)
      );
    });

const buildProvenance = (
  options: ReferenceSourceImportOptions,
): HistoricalSourceGraphInput["provenance"] => ({
  importer: options.importer ?? "rea-reference-source-import",
  importer_version: options.importerVersion ?? null,
  caller: options.caller,
});

const sortExclusions = (
  exclusions: HistoricalSourceGraphInput["exclusions"],
): HistoricalSourceGraphInput["exclusions"] =>
  [...exclusions].sort((left, right) => {
    const byPath = compareUnicodeCodePoints(left.path, right.path);
    if (byPath !== 0) return byPath;
    const byReason = compareUnicodeCodePoints(left.reason, right.reason);
    if (byReason !== 0) return byReason;
    return compareUnicodeCodePoints(
      "pattern" in left ? left.pattern : "",
      "pattern" in right ? right.pattern : "",
    );
  });

const createShouldExclude =
  (
    exclusions: HistoricalSourceGraphInput["exclusions"],
    secrets: PreparedReferenceSourceImport["secrets"],
    ignored: PreparedReferenceSourceImport["ignored"],
  ): ((path: string, kind: ReferenceSourceExclusionKind) => boolean) =>
  (path, kind) => {
    // An entry of unknown kind may be a directory, so directory-only rules
    // must still exclude it; this fails closed for caller-marked secrets.
    const patternPaths =
      kind === "directory"
        ? [`${path}/`]
        : kind === "unknown"
          ? [path, `${path}/`]
          : [path];
    const firstMatch = (matcher: Pick<typeof secrets, "test">) => {
      const results = patternPaths.map((patternPath) =>
        matcher.test(patternPath),
      );
      return results.find(({ ignored }) => ignored) ?? results[0];
    };
    const secretMatch = firstMatch(secrets);
    if (secretMatch?.ignored === true) {
      if (!secretMatch.rule)
        throw new Error(`Ignored secret path has no matching rule: ${path}`);
      exclusions.push({
        path,
        entry_kind: kind,
        reason: "configured-secret",
        pattern: secretMatch.rule.pattern,
      });
      return true;
    }
    const match = firstMatch(ignored);
    if (match?.ignored !== true) return false;
    if (!match.rule)
      throw new Error(`Ignored path has no matching rule: ${path}`);
    const reason = match.rule.mark;
    if (
      reason !== "project-ignored" &&
      reason !== "default-ignored" &&
      reason !== "caller-excluded"
    )
      throw new Error(`Ignored path has unknown rule origin: ${path}`);
    exclusions.push({
      path,
      entry_kind: kind,
      reason,
      pattern: match.rule.pattern,
    });
    return true;
  };

/**
 * Import a reference source directory into a committed historical source graph.
 *
 * The import is deterministic, parallel-safe, and never executes source, hooks,
 * git subprocesses, or network requests. Paths explicitly excluded by the
 * caller's reference-source policy are omitted from the graph.
 */
export const importReferenceSource = async (
  options: ReferenceSourceImportOptions,
  resources: ArtifactResourceScope,
): Promise<Result<HistoricalSourceGraph, ReferenceSourceImportError>> => {
  if (isAborted(options.signal)) return err(cancelled());
  const prepared = await prepareReferenceSourceImport(options, resources);
  if (!prepared.ok) return prepared;
  const { ignored, root, secrets } = prepared.value;
  if (isAborted(options.signal)) return err(cancelled());

  const exclusions: HistoricalSourceGraphInput["exclusions"] = [];
  const shouldExclude = createShouldExclude(exclusions, secrets, ignored);

  const [readResult, vcsResult] = await Promise.all([
    readReferenceSource(root, resources, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      shouldExclude,
      beforeDirectory: prepared.value.beforeDirectory,
    }),
    readReferenceSourceVcs(root, resources, options.signal),
  ]);

  if (!readResult.ok)
    return err(
      combineReadFailures(
        readResult.error,
        vcsResult.ok ? undefined : vcsResult.error,
        readResult.error.partial,
      ),
    );
  if (!vcsResult.ok)
    return err(
      combineReadFailures(vcsResult.error, undefined, readResult.value),
    );

  const vcs = vcsResult.value;

  if (isAborted(options.signal)) return err(cancelled(readResult.value));

  const read = readResult.value;
  const { entries, relationships, parseFailures, limitations } =
    parseReferenceSourceEntries(read, exclusions, options.signal);

  if (isAborted(options.signal)) return err(cancelled(read));

  const uniqueRelationships = deduplicateRelationships(relationships);
  const uniqueFailures = normalizeHistoricalSourceParseFailures(parseFailures);

  const sortedEntries = [...entries].sort((left, right) =>
    compareUnicodeCodePoints(left.path, right.path),
  );
  const sortedExclusions = sortExclusions(exclusions);
  const sortedLimitations = [...limitations].sort(compareUnicodeCodePoints);

  const input: HistoricalSourceGraphInput = {
    schema: "HistoricalSourceGraph",
    authority: "historical-reference",
    root_alias: "$REFERENCE_ROOT",
    inventory_state: historicalSourceInventoryHasPartialFacts({
      entries: sortedEntries,
      relationships: uniqueRelationships,
      parse_failures: uniqueFailures,
      exclusions: sortedExclusions,
      limitations: sortedLimitations,
    })
      ? "partial"
      : "complete",
    entries: sortedEntries,
    relationships: uniqueRelationships.sort((left, right) =>
      compareUnicodeCodePoints(
        historicalSourceRelationshipKey(left),
        historicalSourceRelationshipKey(right),
      ),
    ),
    parse_failures: uniqueFailures,
    exclusions: sortedExclusions,
    languages: historicalSourceLanguages(sortedEntries),
    manifests: historicalSourceManifests(sortedEntries),
    vcs,
    provenance: buildProvenance(options),
    limitations: sortedLimitations,
  };

  try {
    return ok(createHistoricalSourceGraph(input));
  } catch (cause: unknown) {
    return err(
      failure(
        "parse",
        cause instanceof Error ? cause.message : "Graph failed validation",
      ),
    );
  }
};

const combineReadFailures = (
  primary: ReferenceSourceReaderError,
  other: ReferenceSourceReaderError | undefined,
  partial: ReferenceSourceRead | undefined,
): ReferenceSourceImportError => {
  const code =
    primary.code === "cancelled" || other?.code === "cancelled"
      ? "cancelled"
      : primary.code;
  const cleanup = mergeCleanup(primary.cleanup, other?.cleanup);
  const message =
    other === undefined
      ? primary.message
      : `${primary.message}; additional reference metadata failure: ${other.message}`;
  const cause =
    other === undefined
      ? primary.cause
      : new AggregateError(
          [primary, other],
          "Reference source inventory and metadata both failed",
          { cause: primary },
        );
  return {
    ...failure(code, message),
    ...(primary.remediationAction === undefined || code !== primary.code
      ? {}
      : { remediationAction: primary.remediationAction }),
    ...(cleanup === undefined ? {} : { cleanup }),
    ...(partial === undefined ? {} : { partial }),
    ...(cause === undefined ? {} : { cause }),
  };
};

const mergeCleanup = (
  first: AnalysisCleanupObservation | undefined,
  second: AnalysisCleanupObservation | undefined,
): AnalysisCleanupObservation | undefined => {
  if (first === undefined) return second;
  if (second === undefined) return first;
  return {
    reason: `${first.reason}; ${second.reason}`,
    resources: [...new Set([...first.resources, ...second.resources])],
  };
};
