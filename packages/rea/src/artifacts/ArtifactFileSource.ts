import { lstat } from "node:fs/promises";
import { artifactIntegrityDetails } from "../domain/artifactIntegrity.js";
import { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import { readFileHandleChunks } from "../filesystem/readFileHandleChunks.js";
import {
  RegularFileAdmissionFailure,
  openRegularFile,
  sameRegularFileState,
  type StableRegularFileDescriptor,
} from "../filesystem/RegularFile.js";
import {
  artifactSelectedPathErrno,
  assertArtifactReadActive,
} from "./ArtifactFileOperation.js";
import { artifactFileAdmissionFailure } from "./ArtifactFileAdmission.js";
import { hashReadable } from "./ArtifactHash.js";
import { ArtifactReaderFailure } from "./ArtifactReader.js";
import { ArtifactResourceScope } from "./ArtifactResourceScope.js";

/** Verify an admitted descriptor against the regular file still named by its path. */
export const assertArtifactFileSelectedSource = async (
  path: string,
  source: StableRegularFileDescriptor,
  diagnosticLabel: string,
): Promise<void> => {
  const [observed, selected] = await Promise.all([
    source.handle.stat(),
    lstat(path).catch((cause: unknown) => {
      // Admission already established this selected name. Its disappearance
      // or a replaced ancestor is a source change, not an unrelated I/O fault.
      if (artifactSelectedPathErrno(cause) !== undefined)
        throw new ArtifactReaderFailure(
          "integrity",
          `${diagnosticLabel} source identity changed: ${path}`,
          { cause },
        );
      throw cause;
    }),
  ]);
  if (
    !sameRegularFileState(source.initial, observed) ||
    !sameRegularFileState(source.initial, selected)
  )
    throw new ArtifactReaderFailure(
      "integrity",
      `${diagnosticLabel} source identity changed: ${path}`,
    );
};

/** One persistent descriptor and hash binding, borrowing caller-admitted sources. */
export class ArtifactFileSource {
  readonly #scope = new ArtifactResourceScope();
  #owner: OwnedFileHandle | undefined;
  #opening: Promise<StableRegularFileDescriptor> | undefined;
  #boundSha256: string | undefined;

  constructor(
    private readonly path: string,
    private readonly diagnosticLabel: string,
    private readonly admitted?: StableRegularFileDescriptor,
  ) {
    this.#scope.addCloseHook(async () => {
      if (this.#owner !== undefined) {
        await this.#owner.close();
        this.#owner = undefined;
      }
      this.#opening = undefined;
      this.#boundSha256 = undefined;
    });
  }

  /** Verify the admitted descriptor; the selected pathname is not reinterpreted. */
  read(signal?: AbortSignal): Promise<StableRegularFileDescriptor> {
    return this.#scope.run(() => this.#verify(signal));
  }

  /** Verify both the descriptor and the file currently at the caller-selected path. */
  readSelectedPath(signal?: AbortSignal): Promise<StableRegularFileDescriptor> {
    return this.#scope.run(() => this.#verifySelectedPath(signal));
  }

  /** Bind verified bytes to the inventory's expected whole-carrier identity. */
  bindSha256(expectedSha256: string, signal?: AbortSignal): Promise<void> {
    return this.#scope.run(() =>
      this.#bind(
        expectedSha256,
        signal,
        () => this.#verify(signal),
        () => this.#verify(),
      ),
    );
  }

  /** Bind carrier bytes while the selected pathname continues to name the same source. */
  bindSelectedPathSha256(
    expectedSha256: string,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.#scope.run(() =>
      this.#bind(
        expectedSha256,
        signal,
        () => this.#verifySelectedPath(signal),
        () => this.#verifySelectedPath(),
      ),
    );
  }

  /** Join admitted operations before closing; failed descriptor ownership stays retained. */
  close(): Promise<void> {
    return this.#scope.close();
  }

  async #bind(
    expectedSha256: string,
    signal: AbortSignal | undefined,
    verify: () => Promise<StableRegularFileDescriptor>,
    verifyCompletion: () => Promise<StableRegularFileDescriptor>,
  ): Promise<void> {
    const { handle } = await verify();
    const observed =
      this.#boundSha256 ??
      (
        await hashReadable(
          readFileHandleChunks(handle, {
            signal,
            cancellationFailure: (reason) =>
              new ArtifactReaderFailure(
                "cancelled",
                `${this.diagnosticLabel} verification cancelled`,
                { cause: reason },
              ),
          }),
          signal,
        )
      ).sha256;
    // A completed digest needs source validation before late cancellation can
    // decide the outcome; unverified bytes must not establish a contradiction.
    await verifyCompletion();
    if (observed !== expectedSha256)
      throw new ArtifactReaderFailure(
        "integrity",
        `${this.diagnosticLabel} carrier changed after inventory`,
        undefined,
        artifactIntegrityDetails(
          ".",
          { algorithm: "sha256", digest: expectedSha256 },
          observed,
          false,
        ),
      );
    assertArtifactReadActive(signal);
    this.#boundSha256 = observed;
  }

  async #verify(signal?: AbortSignal): Promise<StableRegularFileDescriptor> {
    assertArtifactReadActive(signal);
    this.#opening ??= this.#admit(signal);
    const source = await this.#opening;
    const observed = await source.handle.stat();
    if (!sameRegularFileState(source.initial, observed))
      throw new ArtifactReaderFailure(
        "integrity",
        `${this.diagnosticLabel} source identity changed: ${this.path}`,
      );
    assertArtifactReadActive(signal);
    return source;
  }

  async #verifySelectedPath(
    signal?: AbortSignal,
  ): Promise<StableRegularFileDescriptor> {
    assertArtifactReadActive(signal);
    this.#opening ??= this.#admit(signal);
    const source = await this.#opening;
    await assertArtifactFileSelectedSource(
      this.path,
      source,
      this.diagnosticLabel,
    );
    assertArtifactReadActive(signal);
    return source;
  }

  async #admit(signal?: AbortSignal): Promise<StableRegularFileDescriptor> {
    try {
      if (this.admitted !== undefined)
        return {
          handle: this.admitted.handle,
          initial: this.admitted.initial,
        };
      const source = await openRegularFile(this.path, {
        symlinks: "reject",
        signal,
      });
      this.#owner = new OwnedFileHandle(source.handle);
      return source;
    } catch (cause: unknown) {
      if (cause instanceof RegularFileAdmissionFailure)
        this.#owner = cause.owner;
      throw artifactFileAdmissionFailure(
        this.path,
        this.diagnosticLabel,
        cause,
      );
    }
  }
}
