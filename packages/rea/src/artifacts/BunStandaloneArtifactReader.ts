import type { BunStandaloneAdmission } from "./bun/BunStandaloneAdmission.js";
import type { StableRegularFileDescriptor } from "../filesystem/RegularFile.js";
import { setImmediate } from "node:timers/promises";
import { Readable, Transform, pipeline } from "node:stream";
import { finished } from "node:stream/promises";
import { artifactExpansionBudgetBytes } from "../domain/artifactExpansionBudget.js";
import type {
  BunStandaloneEntryMetadata,
  BunStandaloneMetadata,
} from "../domain/artifactFormatMetadata.js";
import { jsonValueByteLength } from "../domain/jsonValueByteLength.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { readFileHandleChunks } from "../filesystem/readFileHandleChunks.js";
import { assertArtifactReadActive } from "./ArtifactFileOperation.js";
import {
  normalizeArtifactPath,
  ArtifactPathRegistry,
} from "./ArtifactPaths.js";
import {
  ArtifactReaderFailure,
  copyArtifactEntry,
  sameArtifactEntry,
  type ArtifactEntry,
  type ArtifactReader,
  type ArtifactTraversalOptions,
} from "./ArtifactReader.js";
import { ArtifactFileSource } from "./ArtifactFileSource.js";
import { ArtifactResourceScope } from "./ArtifactResourceScope.js";
import {
  MAX_BUN_RETAINED_BYTES,
  bunFormatFailure,
  bunMetadataBytesLimit,
  probeBunStandaloneGraph,
  loadBunStandaloneGraph,
  type LocatedBunGraph,
} from "./bun/BunModuleGraphLayout.js";
import {
  decodeBunModuleGraph,
  type BunDecodedModule,
} from "./bun/BunModuleGraphMembers.js";

const REGIONS = ["contents", "sourcemap", "bytecode", "module-info"] as const;
type BunRegion = (typeof REGIONS)[number];
const MAX_LOGICAL_PATH_PARTS = 256;
const MAX_LOGICAL_PATH_NODES = 250_000;
interface BunModuleDestination {
  readonly path: string;
  readonly sourcePath?: string;
  readonly limitations?: readonly string[];
}

/** One descriptor and bounded reads of an embedded Bun standalone module graph. */
export class BunStandaloneArtifactReader implements ArtifactReader {
  readonly format = "bun-standalone" as const;
  readonly #scope = new ArtifactResourceScope();
  readonly #entries = new Map<string, ArtifactEntry>();
  readonly #streams = new Set<Readable>();
  readonly #source: ArtifactFileSource;
  #admission: BunStandaloneAdmission | undefined;
  #prepared: Promise<void> | undefined;
  #header: BunStandaloneMetadata | undefined;
  #closing = false;

  constructor(
    path: string,
    admitted?: StableRegularFileDescriptor | BunStandaloneAdmission,
  ) {
    if (admitted !== undefined && "kind" in admitted) {
      this.#admission = admitted;
      this.#source = new ArtifactFileSource(
        path,
        "Bun standalone",
        admitted.source,
      );
    } else
      this.#source = new ArtifactFileSource(path, "Bun standalone", admitted);
  }

  formatMetadata(): BunStandaloneMetadata | undefined {
    return this.#header === undefined ? undefined : { ...this.#header };
  }

  async prepareContainer(
    expectedSha256: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.#scope.run(async () => {
      this.#assertOpen(signal);
      await this.#source.bindSelectedPathSha256(expectedSha256, signal);
    });
  }

  async *entries(
    signal?: AbortSignal,
    _options?: ArtifactTraversalOptions,
  ): AsyncIterable<ArtifactEntry> {
    await this.#scope.run(async () => {
      this.#assertOpen(signal);
      this.#prepared ??= this.#prepare(signal);
      await this.#prepared;
      await this.#source.readSelectedPath(signal);
    });
    let index = 0;
    for (const entry of this.#entries.values()) {
      if (index++ % 256 === 0) await setImmediate();
      this.#assertOpen(signal);
      yield copyArtifactEntry(entry);
    }
  }

  async open(entry: ArtifactEntry, signal?: AbortSignal): Promise<Readable> {
    return this.#scope.run(async () => {
      this.#assertOpen(signal);
      const stored = this.#entries.get(entry.adapterKey);
      if (stored === undefined || !sameArtifactEntry(entry, stored))
        throw new ArtifactReaderFailure(
          "integrity",
          "Bun standalone entry does not match its owning inventory",
        );
      const { handle } = await this.#source.readSelectedPath(signal);
      this.#assertOpen(signal);
      if (stored.byteOffset === null || stored.declaredSize === null)
        throw bunFormatFailure("member has no physical byte range");
      const source =
        stored.declaredSize === 0
          ? Readable.from([])
          : readFileHandleChunks(handle, {
              start: stored.byteOffset,
              end: stored.byteOffset + stored.declaredSize - 1,
              signal,
              cancellationFailure: (reason) =>
                new ArtifactReaderFailure(
                  "cancelled",
                  "Bun standalone read cancelled",
                  { cause: reason },
                ),
            });
      const output = memberStream(stored);
      output.on("error", () => undefined);
      this.#streams.add(output);
      output.once("close", () => this.#streams.delete(output));
      void this.#scope
        .run(
          () =>
            new Promise<void>((resolve) => {
              pipeline(source, output, () => {
                resolve();
              });
            }),
        )
        .catch((cause: unknown) =>
          output.destroy(
            cause instanceof Error
              ? cause
              : new Error("Bun standalone stream ownership failed", { cause }),
          ),
        );
      return output;
    });
  }

  async close(): Promise<void> {
    this.#closing = true;
    for (const stream of this.#streams)
      stream.destroy(
        new ArtifactReaderFailure(
          "unavailable",
          "Bun standalone reader closed",
        ),
      );
    await this.#scope.close();
    await Promise.all(
      [...this.#streams].map((stream) =>
        finished(stream).catch(() => undefined),
      ),
    );
    await this.#source.close();
    this.#entries.clear();
    this.#header = undefined;
    this.#admission = undefined;
    this.#prepared = undefined;
  }

  provenance(): readonly [] {
    return [];
  }

  #assertOpen(signal?: AbortSignal): void {
    assertArtifactReadActive(signal);
    if (this.#closing)
      throw new ArtifactReaderFailure(
        "unavailable",
        "Bun standalone reader is closed",
      );
  }

  async #prepare(signal?: AbortSignal): Promise<void> {
    const source = await this.#source.readSelectedPath(signal);
    const probe =
      this.#admission?.probe ??
      (await probeBunStandaloneGraph(
        source.handle,
        source.initial.size,
        signal,
      ));
    if (probe.status === "absent")
      throw bunFormatFailure("no Bun section or trailer");
    if (probe.failure !== undefined) throw probe.failure;
    if (probe.claim === undefined)
      throw bunFormatFailure("graph claim was not admitted");
    const located = await loadBunStandaloneGraph(
      source.handle,
      probe.claim,
      signal,
    );
    if (located.status === "absent")
      throw bunFormatFailure("no Bun section or trailer");
    if (located.failure !== undefined) throw located.failure;
    if (located.graph === undefined)
      throw bunFormatFailure("graph data was not admitted");
    const decoded = await decodeBunModuleGraph(located.graph);
    const entryModule = decoded.modules[decoded.entryPointId];
    const entryDestination =
      entryModule === undefined ? null : logicalModulePath(entryModule);
    const header: BunStandaloneMetadata = {
      kind: "bun-standalone",
      layout_revision: decoded.revision,
      carrier: located.graph.carrier,
      payload_offset: located.graph.payloadOffset,
      payload_length: located.graph.payloadLength,
      module_count: decoded.modules.length,
      entry_point_id: decoded.entryPointId,
      entry_point_source_name: entryModule?.nameText.text ?? null,
      entry_point_logical_path: entryDestination?.path ?? null,
      compile_exec_argv: decoded.compileExecArgv.text,
      compile_exec_argv_hex: decoded.compileExecArgv.hex,
      flags: decoded.flags,
    };
    let retainedBytes = jsonValueByteLength(header, MAX_BUN_RETAINED_BYTES);
    if (retainedBytes > MAX_BUN_RETAINED_BYTES)
      throw bunMetadataBytesLimit(retainedBytes);
    let declaredPlaintext = 0n;
    const expansionBudget = BigInt(
      artifactExpansionBudgetBytes(located.graph.payloadLength),
    );
    const paths = new ArtifactPathRegistry({
      maxParts: MAX_LOGICAL_PATH_PARTS,
      maxNodes: MAX_LOGICAL_PATH_NODES,
    });
    for (const module of decoded.modules) {
      assertArtifactReadActive(signal);
      const destination =
        module.index === decoded.entryPointId && entryDestination !== null
          ? entryDestination
          : logicalModulePath(module);
      for (const region of REGIONS) {
        const range = regionRange(module, region);
        if (range === null) continue;
        declaredPlaintext += BigInt(range.length);
        if (declaredPlaintext > expansionBudget)
          throw new ArtifactReaderFailure(
            "limit",
            `Bun standalone readable entries declare ${String(declaredPlaintext)} plaintext bytes, exceeding this graph's ${String(expansionBudget)}-byte expansion budget. This release has no runtime override. Host memory and NODE_OPTIONS do not raise it.`,
            { boundary: "capacity" },
          );
        const entry = moduleEntry(
          located.graph,
          module,
          region,
          range,
          destination,
        );
        paths.reservePath(entry.path);
        retainedBytes += jsonValueByteLength(
          entryMetadataJson(entry),
          Math.max(0, MAX_BUN_RETAINED_BYTES - retainedBytes),
        );
        if (retainedBytes > MAX_BUN_RETAINED_BYTES)
          throw bunMetadataBytesLimit(retainedBytes);
        this.#entries.set(entry.adapterKey, entry);
      }
    }
    await this.#source.readSelectedPath(signal);
    this.#assertOpen(signal);
    this.#header = header;
    this.#admission = undefined;
  }
}

const regionRange = (
  module: BunDecodedModule,
  region: BunRegion,
): { readonly offset: number; readonly length: number } | null => {
  if (region === "contents") return module.contents;
  if (region === "sourcemap") return module.sourcemap;
  if (region === "bytecode") return module.bytecode;
  return module.moduleInfo;
};

const moduleEntry = (
  graph: LocatedBunGraph,
  module: BunDecodedModule,
  region: BunRegion,
  range: { readonly offset: number; readonly length: number },
  located: BunModuleDestination,
): ArtifactEntry => {
  const suffix =
    region === "contents"
      ? ""
      : region === "sourcemap"
        ? ".bunmap"
        : region === "bytecode"
          ? ".bytecode"
          : ".module-info";
  const metadata: BunStandaloneEntryMetadata = {
    kind: "bun-standalone-entry",
    index: module.index,
    region,
    source_name: module.nameText.text,
    source_name_hex: module.nameText.hex,
    encoding: module.encoding,
    encoding_name: module.encodingName,
    loader: module.loader,
    loader_name: module.loaderName,
    module_format: module.moduleFormat,
    module_format_name: module.moduleFormatName,
    side: module.side,
    side_name: module.sideName,
    entry_point: module.index === graph.entryPointId,
    sourcemap_bytes: module.sourcemap?.length ?? 0,
    bytecode_bytes: module.bytecode?.length ?? 0,
    module_info_bytes: module.moduleInfo?.length ?? 0,
    bytecode_origin: module.bytecodeOrigin?.text ?? null,
    bytecode_origin_hex: module.bytecodeOrigin?.hex ?? null,
  };
  return {
    path: `${located.path}${suffix}`,
    ...(located.sourcePath === undefined
      ? {}
      : { sourcePath: located.sourcePath }),
    kind: "file",
    declaredSize: range.length,
    compressedSize: null,
    executable: false,
    encrypted: false,
    byteOffset: graph.payloadOffset + range.offset,
    declaredIntegrity: null,
    unpacked: false,
    limitations: [...(located.limitations ?? [])],
    adapterKey: `bun:${String(module.index)}:${region}`,
    formatMetadata: metadata,
  };
};

/**
 * Bun virtual names keep a leading slash (`/$bunfs/...`). Strip one slash
 * when the remainder is a safe relative path, and keep the raw spelling on
 * `sourcePath`. Unsafe, drive, and invalid UTF-8 names fall back to
 * `bun-modules/<index>` so inventory can still retain the module.
 */
const logicalModulePath = (module: BunDecodedModule): BunModuleDestination => {
  const fallback = `bun-modules/${String(module.index)}`;
  const text = module.nameText.text;
  if (text === null || text.length === 0) return { path: fallback };
  const candidate = text.startsWith("/") ? text.slice(1) : text;
  // Preserve virtual source facts without admitting an unbounded logical path tree.
  let parts = 1;
  for (let index = 0; index < candidate.length; index++)
    if (candidate.charCodeAt(index) === 47 && ++parts > MAX_LOGICAL_PATH_PARTS)
      return {
        path: fallback,
        sourcePath: text,
        limitations: [
          `The virtual name exceeds the fixed ${String(MAX_LOGICAL_PATH_PARTS)}-part logical path allowance; an indexed path is used and the original name is retained.`,
        ],
      };

  try {
    return {
      path: normalizeArtifactPath(candidate),
      sourcePath: text,
    };
  } catch (cause: unknown) {
    if (!(cause instanceof ArtifactReaderFailure) || cause.reason !== "path")
      throw cause;
    return { path: fallback, sourcePath: text };
  }
};

const memberStream = (entry: ArtifactEntry): Transform => {
  let bytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(null, chunk);
    },
    flush(callback) {
      callback(
        bytes === entry.declaredSize
          ? null
          : bunFormatFailure(`member ended early: ${entry.path}`),
      );
    },
  });
};

const entryMetadataJson = (entry: ArtifactEntry): JsonValue =>
  entry.formatMetadata === undefined ? null : { ...entry.formatMetadata };
