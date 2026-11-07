import {
  probeBunStandaloneGraph,
  type BunStandaloneProbe,
} from "./bun/BunModuleGraphLayout.js";
import type {
  StableRegularFileDescriptor,
  RegularFileState,
} from "../filesystem/RegularFile.js";
import {
  regularFileState,
  sameRegularFileState,
} from "../filesystem/RegularFile.js";
import { findDotnetBundleHeader } from "./dotnet/DotnetBundle.js";
import { ArtifactReaderFailure } from "./ArtifactReader.js";
import { abortIfNeeded } from "./ArtifactHash.js";
import { locateGodotPck, type GodotPckLocation } from "./GodotPckLocation.js";
import {
  locateNodeSea,
  type NodeSeaLocation,
} from "./nodeSea/NodeSeaLocation.js";
import {
  observePyInstallerCookie,
  type PyInstallerCookie,
  type PyInstallerCookieObservation,
} from "./pyinstaller/CArchiveLayout.js";

/** Completed observations only; omission means unexamined, and null is examined absence. */
export interface ArtifactEmbeddedFormatProbeFacts {
  readonly sourceState: RegularFileState;
  readonly bunStandalone?: BunStandaloneProbe;
  readonly godotPck?: GodotPckLocation | null;
  readonly nodeSea?: NodeSeaLocation | null;
  readonly dotnetBundleHeaderOffset?: number | null;
  readonly pyInstaller?: PyInstallerCookieObservation;
}

/** Share format observations only across admissions of the same unchanged regular file. */
export class ArtifactEmbeddedFormatProbes {
  #facts: ArtifactEmbeddedFormatProbeFacts;

  constructor(
    path: string,
    private readonly source: StableRegularFileDescriptor,
    private readonly signal?: AbortSignal,
    previous?: ArtifactEmbeddedFormatProbeFacts,
  ) {
    abortIfNeeded(signal);
    if (
      previous !== undefined &&
      !sameRegularFileState(previous.sourceState, source.initial)
    )
      throw new ArtifactReaderFailure(
        "integrity",
        `Root artifact changed before inventory: ${path}`,
      );
    this.#facts = previous ?? { sourceState: regularFileState(source.initial) };
  }

  async godotPck(prefix?: Uint8Array): Promise<GodotPckLocation | undefined> {
    abortIfNeeded(this.signal);
    if (this.#facts.godotPck !== undefined)
      return this.#facts.godotPck ?? undefined;
    const location = await locateGodotPck(
      this.source.handle,
      this.source.initial.size,
      this.signal,
      prefix,
    );
    this.#facts = { ...this.#facts, godotPck: location ?? null };
    return location;
  }

  async nodeSea(): Promise<NodeSeaLocation | undefined> {
    abortIfNeeded(this.signal);
    if (this.#facts.nodeSea !== undefined)
      return this.#facts.nodeSea ?? undefined;
    const location = await locateNodeSea(
      this.source.handle,
      this.source.initial.size,
      this.signal,
    );
    this.#facts = { ...this.#facts, nodeSea: location ?? null };
    return location;
  }

  async pyInstaller(): Promise<PyInstallerCookie | undefined> {
    abortIfNeeded(this.signal);
    if (this.#facts.pyInstaller !== undefined)
      return this.#facts.pyInstaller.state === "located"
        ? this.#facts.pyInstaller.cookie
        : undefined;
    const found = await observePyInstallerCookie(
      this.source.handle,
      this.source.initial.size,
      this.signal,
    );
    abortIfNeeded(this.signal);
    if (!found.ok)
      throw new ArtifactReaderFailure(found.error.reason, found.error.message);
    this.#facts = { ...this.#facts, pyInstaller: found.value };
    return found.value.state === "located" ? found.value.cookie : undefined;
  }

  async dotnetBundle(): Promise<number | undefined> {
    abortIfNeeded(this.signal);
    if (this.#facts.dotnetBundleHeaderOffset !== undefined)
      return this.#facts.dotnetBundleHeaderOffset ?? undefined;
    // An apphost inside a recognized CArchive cannot claim its outer carrier.
    const packaged = await this.pyInstaller();
    const header = await findDotnetBundleHeader(
      this.source.handle,
      this.source.initial.size,
      this.signal,
      packaged?.archiveStart ?? this.source.initial.size,
    );
    abortIfNeeded(this.signal);
    this.#facts = { ...this.#facts, dotnetBundleHeaderOffset: header ?? null };
    return header;
  }

  async bunStandalone(): Promise<BunStandaloneProbe> {
    abortIfNeeded(this.signal);
    if (this.#facts.bunStandalone !== undefined)
      return this.#facts.bunStandalone;
    const observed = await probeBunStandaloneGraph(
      this.source.handle,
      this.source.initial.size,
      this.signal,
    );
    abortIfNeeded(this.signal);
    this.#facts = { ...this.#facts, bunStandalone: observed };
    return observed;
  }

  completedFacts(): ArtifactEmbeddedFormatProbeFacts {
    return this.#facts;
  }
}
