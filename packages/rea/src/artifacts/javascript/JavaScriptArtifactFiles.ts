import type { AsarHeaderAdmission } from "../../config/asarHeaderAdmission.js";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import type { Readable } from "node:stream";

import { compareUnicodeCodePoints } from "../../domain/unicodeCodePointOrder.js";
import { AsarArtifactReader } from "../AsarArtifactReader.js";
import type { ArtifactResourceScope } from "../ArtifactResourceScope.js";
import {
  ArtifactPathRegistry,
  normalizeArtifactPath,
} from "../ArtifactPaths.js";
import {
  ArtifactReaderFailure,
  type ArtifactEntry,
  type ArtifactReader,
} from "../ArtifactReader.js";
import { streamChunkToBuffer } from "../StreamBytes.js";
import { hashReadableToCompletion } from "../ArtifactHash.js";
import type { ArtifactOccurrence } from "../../domain/artifactGraph.js";
import type { ArtifactInventorySnapshot } from "../../domain/artifactInventorySnapshot.js";
import { AnalysisInputError } from "../../domain/analysisErrorCore.js";
import { isJavaScriptSourcePath } from "../../domain/javascript/javascriptArtifactFiles.js";

import type {
  JavaScriptArtifactFileKind,
  JavaScriptArtifactFile,
  JavaScriptArtifactContainer,
  JavaScriptUnanalyzedArtifactFile,
  JavaScriptUnanalyzedArtifactLookup,
  JavaScriptArtifactFileSet,
} from "../../domain/javascript/javascriptArtifactFiles.js";

interface ExpectedFile {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly inventoryArtifactId: string;
  readonly kind: JavaScriptArtifactFileKind;
}

interface ExpectedContainer {
  readonly hash_status: ArtifactOccurrence["hash_status"];
  readonly format: ArtifactOccurrence["artifact_format"];
  readonly inventory: JavaScriptArtifactContainer | null;
}

interface ReadContext {
  readonly resources: ArtifactResourceScope;
  readonly expected: ReadonlyMap<string, ExpectedFile>;
  readonly expectedContainers: ReadonlyMap<string, ExpectedContainer>;
  readonly registry: ArtifactPathRegistry;
  readonly files: JavaScriptArtifactFile[];
  readonly containers: JavaScriptArtifactContainer[];
  readonly signal: AbortSignal | undefined;
  readonly asarHeaderAdmission: AsarHeaderAdmission | undefined;
  readonly selectedPaths: ReadonlyMap<string, number> | undefined;
  textBytes: number;
  invalidUtf8: number;
}

interface ReadTextInput {
  readonly reader: ArtifactReader;
  readonly entry: ArtifactEntry;
  readonly expected: ExpectedFile;
}

/** Verify inventoried entries; acquire text only inside the caller's scope. */
export const readJavaScriptArtifactFiles = async (
  reader: ArtifactReader,
  snapshot: ArtifactInventorySnapshot,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
  sourcePaths?: readonly string[],
  asarHeaderAdmission?: AsarHeaderAdmission,
): Promise<JavaScriptArtifactFileSet> => {
  const inventory = expectedInventory(snapshot);
  const expected = inventory.files;
  const selectedPaths =
    sourcePaths === undefined
      ? undefined
      : new Map([...new Set(sourcePaths)].map((path, index) => [path, index]));
  const undiscoveredPath = sourcePaths?.find(
    (path) =>
      relevantKind(path) !== undefined &&
      !expected.has(path) &&
      !inventory.unavailableFiles.has(path) &&
      snapshot.occurrences[
        lowerBound(snapshot.occurrences, path, (entry) => entry.logical_path)
      ]?.logical_path !== path,
  );
  if (undiscoveredPath !== undefined && snapshot.coverage.status === "unknown")
    throw new ArtifactReaderFailure(
      "unavailable",
      `Selected source discovery is unavailable under incomplete artifact traversal: ${undiscoveredPath}`,
      {
        partialObservation: { kind: "artifact-inventory", inventory: snapshot },
      },
    );
  const issues = (sourcePaths ?? []).flatMap((path, index) =>
    expected.has(path) || inventory.unavailableFiles.has(path)
      ? []
      : [
          {
            path: ["source_paths", index],
            reason: "invalid_value" as const,
            message:
              "Select an exact relevant file path from the artifact inventory; no globs or path aliases.",
          },
        ],
  );
  if (issues.length > 0)
    throw new AnalysisInputError(
      "analyze_javascript_application",
      undefined,
      issues,
    );
  if (reader instanceof AsarArtifactReader) {
    const root = snapshot.nodes.find(
      ({ artifact_id }) => artifact_id === snapshot.manifest.root_artifact_id,
    );
    if (root === undefined)
      throw new ArtifactReaderFailure(
        "integrity",
        "Root artifact node is missing",
      );
    await verifyEntryBytes(
      await reader.openContainer(signal),
      { path: ".", sha256: root.sha256, bytes: root.size },
      signal,
    );
  }
  if (inventory.ambiguousPath !== undefined)
    throw new ArtifactReaderFailure(
      "path",
      `JavaScript artifact path collision: ${JSON.stringify(inventory.ambiguousPath)}. Multiple occurrences share this normalized logical path; inventory retains each occurrence.`,
      {
        partialObservation: { kind: "artifact-inventory", inventory: snapshot },
      },
    );
  const unavailablePath = sourcePaths?.find((path) =>
    inventory.unavailableFiles.has(path),
  );
  if (unavailablePath !== undefined)
    throw new ArtifactReaderFailure(
      "unavailable",
      `Selected inventoried source bytes are unavailable: ${unavailablePath}`,
      {
        partialObservation: { kind: "artifact-inventory", inventory: snapshot },
      },
    );
  const context: ReadContext = {
    resources,
    expected,
    expectedContainers: inventory.containers,
    registry: new ArtifactPathRegistry(),
    files: [],
    containers: [],
    signal,
    asarHeaderAdmission,
    selectedPaths,
    textBytes: 0,
    invalidUtf8: 0,
  };
  await visitReader(reader, "", snapshot.manifest.root_sha256, context);
  const files = context.files.sort((left, right) => {
    const leftPriority = selectedPaths?.get(left.path) ?? Infinity;
    const rightPriority = selectedPaths?.get(right.path) ?? Infinity;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return compareUnicodeCodePoints(left.path, right.path);
  });
  const unanalyzedFiles = createUnanalyzedArtifactLookup(
    snapshot,
    context.containers,
  );
  const unavailableRelevantFiles = [...inventory.unavailableFiles]
    .sort(compareUnicodeCodePoints)
    .flatMap((path) => {
      const unavailable = unanalyzedFiles.get(path);
      return unavailable === undefined ? [] : [unavailable];
    });
  assertExpectedFilesWereVisited(expected, files);
  return {
    files,
    unanalyzed_files: unanalyzedFiles,
    unavailable_relevant_files: unavailableRelevantFiles,
    containers: context.containers.sort((left, right) =>
      compareUnicodeCodePoints(left.path, right.path),
    ),
    text_bytes_read: context.textBytes,
    invalid_utf8_files: context.invalidUtf8,
    ...(sourcePaths === undefined
      ? {}
      : {
          source_selection: {
            requested_paths: [...sourcePaths],
            unselected_files: files.filter(
              ({ text }) =>
                !text.included && text.reason === "outside-analysis-scope",
            ).length,
          },
        }),
  };
};

const visitReader = async (
  reader: ArtifactReader,
  prefix: string,
  containerSha256: string,
  context: ReadContext,
): Promise<void> => {
  const stack: Array<{
    readonly reader: ArtifactReader;
    readonly prefix: string;
    readonly containerSha256: string;
    readonly iterator: AsyncIterator<ArtifactEntry>;
  }> = [
    {
      reader,
      prefix,
      containerSha256,
      iterator: reader.entries(context.signal)[Symbol.asyncIterator](),
    },
  ];
  const ownedReaders: {
    readonly reader: ArtifactReader;
    readonly path: string;
  }[] = [];
  let failure: { readonly cause: unknown } | undefined;
  try {
    while (stack.length > 0) {
      const frame = stack.at(-1);
      if (frame === undefined) break;
      const next = await frame.iterator.next();
      if (next.done) {
        stack.pop();
        continue;
      }
      const entry = next.value;
      abortIfNeeded(context.signal);
      const path = normalizeArtifactPath(
        frame.prefix === "" ? entry.path : `${frame.prefix}/${entry.path}`,
      );
      const nestedAsar = isFilesystemAsar(entry, path);
      context.registry.add(path, nestedAsar ? "directory" : entry.kind);
      if (nestedAsar) {
        const container = context.expectedContainers.get(path);
        // Inventory deliberately does not expand unverified or unavailable
        // nested archives. Keep the same boundary here when reconstruction
        // reads the active entries again.
        if (container === undefined)
          throw new ArtifactReaderFailure(
            "integrity",
            `Nested ASAR was not present in inventory: ${path}`,
          );
        if (container.hash_status === "mismatched") continue;
        if (container.hash_status === "unavailable") continue;
        if (container.hash_status !== "verified")
          throw new ArtifactReaderFailure(
            "integrity",
            `Nested ASAR was not integrity-verified: ${path}`,
          );
        // Inventory expands an ASAR-named file only when its bytes are an
        // ASAR. One it recorded as ordinary bytes has no members to read.
        if (container.format !== "asar") continue;
        const inventory = container.inventory;
        if (inventory === null)
          throw new ArtifactReaderFailure(
            "integrity",
            `Verified nested ASAR has no inventory node: ${path}`,
          );
        await verifyEntryBytes(
          await frame.reader.open(entry, context.signal),
          inventory,
          context.signal,
        );
        context.containers.push(inventory);
        const nested = new AsarArtifactReader(
          entry.adapterKey,
          context.asarHeaderAdmission === undefined
            ? {}
            : { headerAdmission: context.asarHeaderAdmission },
        );
        ownedReaders.push({ reader: nested, path });
        stack.push({
          reader: nested,
          prefix: path,
          containerSha256: inventory.sha256,
          iterator: nested.entries(context.signal)[Symbol.asyncIterator](),
        });
        await nested.prepareContainer(inventory.sha256, context.signal);
        continue;
      }
      const expected = context.expected.get(path);
      if (expected === undefined) continue;
      const text = await readText(context, {
        reader: frame.reader,
        entry,
        expected,
      });
      context.files.push({
        path,
        container_sha256: frame.containerSha256,
        sha256: expected.sha256,
        bytes: expected.bytes,
        inventory_artifact_id: expected.inventoryArtifactId,
        kind: expected.kind,
        unpacked: entry.unpacked,
        text,
      });
    }
  } catch (cause: unknown) {
    failure = { cause };
  } finally {
    for (const { iterator, prefix, reader } of stack.reverse()) {
      try {
        await iterator.return?.();
      } catch (cause: unknown) {
        failure = {
          cause: ArtifactReaderFailure.withCleanup(
            failure === undefined ? cause : failure.cause,
            ArtifactReaderFailure.cleanupObservation(
              cause,
              `JavaScript artifact traversal for ${prefix || reader.format}`,
            ),
          ),
        };
      }
    }
    for (const owned of ownedReaders.reverse()) {
      const resource = `nested ASAR reader for ${owned.path}`;
      const cleanup = await context.resources.release({
        kind: "reader",
        reader: owned.reader,
        resource,
      });
      if (cleanup.kind === "failed") {
        failure = {
          cause: context.resources.cleanupFailure(
            failure === undefined
              ? { kind: "completed" }
              : { kind: "failed", cause: failure.cause },
            [cleanup],
          ),
        };
      }
    }
  }
  if (failure !== undefined) throw failure.cause;
};

const readText = async (
  context: ReadContext,
  input: ReadTextInput,
): Promise<JavaScriptArtifactFile["text"]> => {
  if (
    context.selectedPaths !== undefined &&
    !context.selectedPaths.has(input.expected.path)
  ) {
    // Keep the inventory/acquisition identity check without allocating or
    // decoding an unrelated source's text.
    await verifyEntryBytes(
      await input.reader.open(input.entry, context.signal),
      input.expected,
      context.signal,
    );
    return { included: false, reason: "outside-analysis-scope" };
  }
  if (input.expected.kind === "native-addon") {
    await verifyEntryBytes(
      await input.reader.open(input.entry, context.signal),
      input.expected,
      context.signal,
    );
    return { included: false, reason: "not-applicable" };
  }
  const bytes = await readAll(
    await input.reader.open(input.entry, context.signal),
    context.signal,
  );
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== input.expected.sha256 || bytes.length !== input.expected.bytes)
    throw new ArtifactReaderFailure(
      "integrity",
      `Artifact entry changed after inventory: ${input.expected.path}`,
    );
  context.textBytes += bytes.length;
  try {
    return {
      included: true,
      value: new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM:
          input.expected.kind === "javascript" ||
          input.expected.kind === "html",
      }).decode(bytes),
    };
  } catch (cause: unknown) {
    // Non-UTF8 bytes are counted; the fixed reason preserves the schema.
    void cause;
    context.invalidUtf8 += 1;
    return { included: false, reason: "invalid-utf8" };
  }
};

const verifyEntryBytes = async (
  stream: Readable,
  expected: Pick<ExpectedFile, "path" | "sha256" | "bytes">,
  signal?: AbortSignal,
): Promise<void> => {
  const digest = await hashReadableToCompletion(stream, signal);
  if (digest.sha256 !== expected.sha256 || digest.bytes !== expected.bytes)
    throw new ArtifactReaderFailure(
      "integrity",
      `Artifact entry changed after inventory: ${expected.path}`,
    );
  abortIfNeeded(signal);
};

const expectedInventory = (
  snapshot: ArtifactInventorySnapshot,
): {
  readonly files: ReadonlyMap<string, ExpectedFile>;
  readonly containers: ReadonlyMap<string, ExpectedContainer>;
  readonly unavailableFiles: ReadonlySet<string>;
  readonly ambiguousPath: string | undefined;
} => {
  const nodes = new Map(snapshot.nodes.map((node) => [node.artifact_id, node]));
  const files = new Map<string, ExpectedFile>();
  const containers = new Map<string, ExpectedContainer>();
  const unavailableFiles = new Set<string>();
  const seenPaths = new Map<string, boolean>();
  let ambiguousPath: string | undefined;
  for (const occurrence of snapshot.occurrences) {
    if (occurrence.logical_path === ".") continue;
    const isNestedAsar =
      occurrence.entry_kind === "file" &&
      occurrence.logical_path.toLowerCase().endsWith(".asar");
    const kind = relevantKind(occurrence.logical_path);
    if (
      occurrence.entry_kind === "file" &&
      (isNestedAsar || kind !== undefined)
    ) {
      const available = occurrence.artifact_id !== null;
      const priorAvailable = seenPaths.get(occurrence.logical_path);
      if (priorAvailable !== undefined) {
        // Unavailable siblings cannot bind content to the wrong occurrence.
        // Keep them as unknown; any available sibling makes the shared path
        // ambiguous for acquisition, regardless of encounter order.
        if (priorAvailable || available)
          ambiguousPath ??= occurrence.logical_path;
        continue;
      }
      seenPaths.set(occurrence.logical_path, available);
    }
    if (occurrence.artifact_id === null) {
      if (occurrence.entry_kind === "file" && kind !== undefined)
        unavailableFiles.add(occurrence.logical_path);
      if (isNestedAsar)
        containers.set(occurrence.logical_path, {
          hash_status: occurrence.hash_status,
          format: occurrence.artifact_format,
          inventory: null,
        });
      continue;
    }
    const node = nodes.get(occurrence.artifact_id);
    if (node === undefined)
      throw new ArtifactReaderFailure(
        "integrity",
        `Artifact inventory node is missing: ${occurrence.logical_path}`,
      );
    // Inventory occurrences can have content identities for directories too.
    // Suffixes only describe file candidates; a directory such as
    // node_modules/@zip.js remains a graph node and must never be opened.
    if (occurrence.entry_kind !== "file") continue;
    if (isNestedAsar)
      containers.set(occurrence.logical_path, {
        hash_status: occurrence.hash_status,
        format: occurrence.artifact_format,
        inventory: {
          path: occurrence.logical_path,
          sha256: node.sha256,
          bytes: node.size,
          inventory_artifact_id: node.artifact_id,
        },
      });
    if (kind === undefined) continue;
    files.set(occurrence.logical_path, {
      path: occurrence.logical_path,
      sha256: node.sha256,
      bytes: node.size,
      inventoryArtifactId: node.artifact_id,
      kind,
    });
  }
  return { files, containers, unavailableFiles, ambiguousPath };
};

/** Canonical snapshot arrays are already ordered by code-point identity. */
const lowerBound = <T>(
  rows: readonly T[],
  key: string,
  identity: (row: T) => string,
): number => {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const row = rows[middle];
    if (row !== undefined && compareUnicodeCodePoints(identity(row), key) < 0)
      low = middle + 1;
    else high = middle;
  }
  return low;
};

const createUnanalyzedArtifactLookup = (
  snapshot: ArtifactInventorySnapshot,
  containers: readonly JavaScriptArtifactContainer[],
): JavaScriptUnanalyzedArtifactLookup => {
  const requested = new Map<
    string,
    JavaScriptUnanalyzedArtifactFile | undefined
  >();
  const directories = new Map<string, Map<string | undefined, boolean>>();
  const containerIds = new Map(
    containers.map((container) => [container.path, container.sha256]),
  );
  const containerFor = (path: string): string => {
    let prefix = path;
    for (;;) {
      const slash = prefix.lastIndexOf("/");
      if (slash < 0) return snapshot.manifest.root_sha256;
      prefix = prefix.slice(0, slash);
      const sha256 = containerIds.get(prefix);
      if (sha256 !== undefined) return sha256;
    }
  };
  const isOpaque = (occurrence: ArtifactOccurrence): boolean =>
    occurrence.entry_kind === "file" &&
    relevantKind(occurrence.logical_path) === undefined;
  const isUnavailableRelevant = (occurrence: ArtifactOccurrence): boolean =>
    occurrence.entry_kind === "file" &&
    occurrence.artifact_id === null &&
    relevantKind(occurrence.logical_path) !== undefined;
  return {
    coverage: snapshot.coverage,
    get(path) {
      if (requested.has(path)) return requested.get(path);
      const index = lowerBound(
        snapshot.occurrences,
        path,
        (entry) => entry.logical_path,
      );
      const occurrence = snapshot.occurrences[index];
      const next = snapshot.occurrences[index + 1];
      const kind = relevantKind(path);
      if (
        occurrence?.logical_path === path &&
        next?.logical_path === path &&
        (isOpaque(occurrence) || isUnavailableRelevant(occurrence))
      ) {
        const ambiguous: JavaScriptUnanalyzedArtifactFile = {
          path,
          container_sha256: containerFor(path),
          sha256: null,
          bytes: null,
          inventory_artifact_id: null,
          ...(kind === undefined ? {} : { kind }),
          limitations: [
            "Multiple inventory occurrences share this normalized path; content identity is unknown.",
          ],
        };
        requested.set(path, ambiguous);
        return ambiguous;
      }
      const id =
        occurrence?.logical_path === path &&
        (isOpaque(occurrence) || isUnavailableRelevant(occurrence))
          ? occurrence.artifact_id
          : undefined;
      const candidate =
        id == null
          ? undefined
          : snapshot.nodes[
              lowerBound(snapshot.nodes, id, (entry) => entry.artifact_id)
            ];
      const node = candidate?.artifact_id === id ? candidate : undefined;
      const file =
        occurrence?.logical_path !== path ||
        (!isOpaque(occurrence) && !isUnavailableRelevant(occurrence))
          ? undefined
          : {
              path,
              container_sha256: containerFor(path),
              sha256: node?.sha256 ?? null,
              bytes: node?.size ?? occurrence.declared_size,
              inventory_artifact_id: occurrence.artifact_id,
              inventory_occurrence_id: occurrence.occurrence_id,
              ...(kind === undefined ? {} : { kind }),
              artifact_kind: occurrence.artifact_kind,
              hash_status: occurrence.hash_status,
              limitations: occurrence.limitations,
            };
      requested.set(path, file);
      return file;
    },
    hasDirectory(path, containerSha256) {
      let results = directories.get(path);
      const previous = results?.get(containerSha256);
      if (previous !== undefined) return previous;
      const prefix = `${path}/`;
      let present = false;
      for (
        let index = lowerBound(
          snapshot.occurrences,
          prefix,
          (entry) => entry.logical_path,
        );
        index < snapshot.occurrences.length;
        index += 1
      ) {
        const entry = snapshot.occurrences[index];
        if (entry === undefined || !entry.logical_path.startsWith(prefix))
          break;
        if (
          (isOpaque(entry) || isUnavailableRelevant(entry)) &&
          (containerSha256 === undefined ||
            containerFor(entry.logical_path) === containerSha256)
        ) {
          present = true;
          break;
        }
      }
      if (results === undefined) {
        results = new Map();
        directories.set(path, results);
      }
      results.set(containerSha256, present);
      return present;
    },
  };
};

const readAll = async (
  stream: Readable,
  signal?: AbortSignal,
): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const raw of stream) {
    abortIfNeeded(signal);
    const chunk = streamChunkToBuffer(raw);
    bytes += chunk.length;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes);
};

const assertExpectedFilesWereVisited = (
  expected: ReadonlyMap<string, ExpectedFile>,
  actual: readonly JavaScriptArtifactFile[],
): void => {
  const observed = new Set(actual.map(({ path }) => path));
  for (const path of expected.keys())
    if (!observed.has(path))
      throw new ArtifactReaderFailure(
        "integrity",
        `Relevant artifact entry disappeared after inventory: ${path}`,
      );
};

const relevantKind = (path: string): JavaScriptArtifactFileKind | undefined => {
  const lower = path.toLowerCase();
  if (lower === "package.json" || lower.endsWith("/package.json"))
    return "package-json";
  if (lower.endsWith(".json")) return "json";
  if (isJavaScriptSourcePath(path)) return "javascript";
  if (/\.html?$/u.test(lower)) return "html";
  if (lower.endsWith(".map")) return "source-map";
  if (lower.endsWith(".node")) return "native-addon";
  return undefined;
};

const isFilesystemAsar = (entry: ArtifactEntry, path: string): boolean =>
  entry.kind === "file" &&
  path.toLowerCase().endsWith(".asar") &&
  isAbsolute(entry.adapterKey);

const abortIfNeeded = (signal?: AbortSignal): void => {
  if (signal?.aborted === true)
    throw new ArtifactReaderFailure(
      "cancelled",
      "JavaScript artifact reconstruction cancelled",
      { cause: signal.reason },
    );
};
