import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  realpath,
  rmdir,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  ArtifactFileCleanupFailure,
  bindArtifactFileCleanup,
} from "../../artifacts/ArtifactFileOperation.js";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";

import {
  DECOMPILE_DIRECTORY_FUNCTIONS_DIRECTORY,
  DECOMPILE_DIRECTORY_INDEX_NAME,
  DECOMPILE_DIRECTORY_JOURNAL_NAME,
  decompileDirectoryIndexSchema,
  decompileJournalHeaderSchema,
  decompileJournalLineSchema,
  isDecompileFunctionRelativePath,
  type DecompileDirectoryFunctionRecord,
  type DecompileJournalHeader,
} from "../../contracts/decompileDirectory.js";
import {
  AnalysisOutputError,
  AnalysisResourceConstraintError,
  type AnalysisInputError,
} from "../../domain/analysisErrorCore.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../../domain/analysisErrorCleanup.js";
import { isPathWithinRoot } from "../../domain/localPath.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  acquireOwnedLease,
  OwnedLeaseCleanupFailure,
  type LeaseFailure,
  type OwnedLease,
} from "../../process/OwnedLease.js";
import type { RetainedResourceScope } from "../AnalysisProvider.js";
import { ExportResources } from "./exportResources.js";
import { decompileInputError } from "./inputError.js";
import { compareProcedureAddresses } from "./selection.js";

export interface ExportIdentity {
  readonly targetSha256: string | null;
  readonly provider: DecompileJournalHeader["provider"];
  readonly analysisProfileDigest: string | null;
  readonly layout: DecompileJournalHeader["layout"];
}

export type OutputPlacement =
  | { readonly mode: "create"; readonly root: string }
  | { readonly mode: "resume"; readonly root: string };

/** Refuse a bad path before provider work. This does not create a directory. */
export const classifyOutputPath = async (
  requested: string,
  resume: boolean,
): Promise<Result<OutputPlacement, AnalysisError>> => {
  const stripped = requested.replace(/\/+$/u, "");
  const name = basename(stripped);
  if (stripped.length === 0 || name === "" || name === "." || name === "..")
    return err(
      decompileInputError(
        "output_directory",
        "The output directory name is invalid.",
      ),
    );
  const listed = await lstat(stripped).then(
    (stat) => stat,
    (cause: unknown) => cause,
  );
  if (!isDirectoryStat(listed)) {
    if (resume && nodeCode(listed) === "ENOENT")
      return err(
        decompileInputError(
          "output_directory",
          "Resume requires an existing export directory. Omit resume to start a new export.",
        ),
      );
    return missingOrRejected(stripped, listed);
  }
  if (!resume)
    return err(
      decompileInputError(
        "output_directory",
        "Output directory already exists. Pass resume to continue an export that matches this target and analysis profile.",
      ),
    );
  const root = await realpath(stripped).catch((cause: unknown) => cause);
  return typeof root === "string"
    ? ok({ mode: "resume", root })
    : err(
        decompileInputError(
          "output_directory",
          "The output directory could not be resolved.",
        ),
      );
};

/** Owns one export directory and its append-only journal. */
export class DecompileExport {
  private constructor(
    readonly root: string,
    private readonly journal: FileHandle,
    private readonly records: Map<string, DecompileDirectoryFunctionRecord>,
    private readonly written: Map<string, DecompileDirectoryFunctionRecord>,
    private readonly paths: PathReservations,
    private readonly identity: ExportIdentity,
    private readonly resources: ExportResources,
  ) {}

  static open(input: {
    readonly placement: OutputPlacement;
    readonly identity: ExportIdentity;
    readonly resourceScope?: RetainedResourceScope | undefined;
  }): Promise<Result<DecompileExport, AnalysisError>> {
    return input.placement.mode === "create"
      ? DecompileExport.#create(
          input.placement.root,
          input.identity,
          input.resourceScope,
        )
      : DecompileExport.#resume(
          input.placement.root,
          input.identity,
          input.resourceScope,
        );
  }

  /** The latest journal outcome for an address. */
  record(address: string): DecompileDirectoryFunctionRecord | undefined {
    return this.records.get(address);
  }

  /**
   * The last successful write for an address. A later failure, such as a
   * transient read error, does not erase the checksum that verifies the file.
   */
  lastWritten(address: string): DecompileDirectoryFunctionRecord | undefined {
    return this.written.get(address);
  }

  /**
   * Stable relative path for an address. The first path the journal gave this
   * address wins, even when a later failure record names no path.
   */
  pathFor(address: string): string {
    const owned = this.paths.byAddress.get(address);
    if (owned !== undefined) return owned;
    const relativePath = allocateFunctionPath(
      address,
      this.paths.byPortablePath,
    );
    reservePath(this.paths, relativePath, address);
    return relativePath;
  }

  async append(
    record: DecompileDirectoryFunctionRecord,
  ): Promise<Result<void, AnalysisError>> {
    const line = decompileJournalLineSchema.safeParse({
      kind: "function",
      ...record,
    });
    if (!line.success || line.data.kind !== "function")
      return err(
        new AnalysisOutputError(
          "decompile_all",
          "decompile journal record is invalid",
        ),
      );
    const written = await this.journal
      .writeFile(`${JSON.stringify(line.data)}\n`)
      .then(() => this.journal.sync())
      .then(
        () => true,
        () => false,
      );
    if (!written)
      return err(
        new AnalysisOutputError(
          "decompile_all",
          "decompile journal could not be updated",
        ),
      );
    // The journal schema owns the parsed snapshot, including nested fields;
    // the caller may have changed its input while the append was pending.
    const { kind: _kind, ...committed } = line.data;
    this.records.set(committed.address, committed);
    if (committed.status === "written")
      this.written.set(committed.address, committed);
    if (committed.relative_path !== undefined)
      reservePath(this.paths, committed.relative_path, committed.address);
    return ok(undefined);
  }

  async writeIndex(input: {
    readonly layoutStatus: "address" | "debug_layout_unavailable";
    readonly limitations: readonly string[];
  }): Promise<Result<void, AnalysisError>> {
    // Appends update this owner only after journal sync; resume parses once.
    // Reuse those committed facts instead of re-reading and reinterpreting them.
    const index = decompileDirectoryIndexSchema.safeParse({
      version: 1,
      target_sha256: this.identity.targetSha256,
      provider: this.identity.provider,
      analysis_profile_digest: this.identity.analysisProfileDigest,
      layout: this.identity.layout,
      layout_status: input.layoutStatus,
      limitations: [...input.limitations],
      functions: [...this.records.values()].sort((left, right) =>
        compareProcedureAddresses(left.address, right.address),
      ),
    });
    if (!index.success)
      return err(
        new AnalysisOutputError(
          "decompile_all",
          "decompile index could not be built",
        ),
      );
    return writeOwnedIndex(
      this.root,
      `${JSON.stringify(index.data, null, 2)}\n`,
      this.resources,
    );
  }

  commitFunctionFile(relativePath: string, bytes: Buffer): Promise<FileCommit> {
    return commitFunctionFile(this.root, relativePath, bytes, this.resources);
  }

  hashFile(relativePath: string, signal?: AbortSignal): Promise<string> {
    return this.resources.hashFile(join(this.root, relativePath), signal);
  }

  /** Failed cleanup retains the same files and lease for a later session retry. */
  close(): Promise<Result<void, AnalysisError>> {
    return this.resources.close();
  }

  static async #create(
    root: string,
    identity: ExportIdentity,
    scope: RetainedResourceScope | undefined,
  ): Promise<Result<DecompileExport, AnalysisError>> {
    const created = await createPrivateDirectory(root);
    if (!created.ok) return created;
    // The directory exists before its journal, so a resume that starts in
    // between takes the same lease and cannot write alongside this export.
    const lease = await acquireExportLease(root, scope);
    // Even an empty directory may now have another lease holder preparing its
    // journal. Without the lease, preserve it rather than disrupting that run.
    if (!lease.ok) {
      lease.error.retainDiagnostics({ created_output_directory: root });
      return lease;
    }
    const resources = new ExportResources(
      root,
      lease.value.identity,
      lease.value.lease,
      scope,
    );
    const functions = await prepareFunctionsDirectory(root, resources);
    if (!functions.ok) return resources.failedInitialization(functions.error);
    const opened = await seedJournal(root, identity, resources);
    if (!opened.ok) return resources.failedInitialization(opened.error);
    return ok(
      new DecompileExport(
        root,
        opened.value,
        new Map(),
        new Map(),
        { byPortablePath: new Map(), byAddress: new Map() },
        identity,
        resources,
      ),
    );
  }

  static async #resume(
    root: string,
    identity: ExportIdentity,
    scope: RetainedResourceScope | undefined,
  ): Promise<Result<DecompileExport, AnalysisError>> {
    // The lease is held before the journal is read, so no other run appends
    // between this read and this run's own appends, repair or index.
    const lease = await acquireExportLease(root, scope);
    if (!lease.ok) return lease;
    const resources = new ExportResources(
      root,
      lease.value.identity,
      lease.value.lease,
      scope,
    );
    const opened = await openResumedJournal(root, identity, resources);
    if (!opened.ok) {
      const closed = await resources.close();
      return closed.ok
        ? opened
        : err(
            analysisErrorWithCleanupFailure(
              opened.error,
              closed.error,
              "decompile_all",
            ).bindCleanupDependencies([closed.error]),
          );
    }
    return ok(
      new DecompileExport(
        root,
        opened.value.handle,
        opened.value.journal.records,
        opened.value.journal.written,
        opened.value.journal.paths,
        identity,
        resources,
      ),
    );
  }
}

const openResumedJournal = async (
  root: string,
  identity: ExportIdentity,
  resources: ExportResources,
): Promise<
  Result<
    { readonly handle: FileHandle; readonly journal: OpenedJournal },
    AnalysisError
  >
> => {
  const opened = await readJournal(root, identity, resources);
  if (!opened.ok) return opened;
  const functions = await prepareFunctionsDirectory(root, resources);
  if (!functions.ok) return functions;
  const handle = await openJournal(root, "a");
  if (!handle.ok) return handle;
  resources.ownFile(
    handle.value,
    join(root, DECOMPILE_DIRECTORY_JOURNAL_NAME),
    true,
  );
  // Drop a torn final line left by a crash so the next append starts a line.
  const repaired =
    opened.value.committedBytes === opened.value.journalBytes ||
    (await handle.value.truncate(opened.value.committedBytes).then(
      () => true,
      () => false,
    ));
  if (!repaired) {
    return err(
      decompileInputError(
        "output_directory",
        "The decompile journal could not be repaired after an interrupted write.",
      ),
    );
  }
  return ok({ handle: handle.value, journal: opened.value });
};

export type FileCommit =
  | { readonly status: "written"; readonly sha256: string }
  | { readonly status: "matched"; readonly sha256: string }
  | { readonly status: "conflict" }
  | { readonly status: "io" }
  | { readonly status: "error"; readonly error: AnalysisError };

/**
 * Publish bytes with `link`, which fails when the final name exists.
 * A matching existing file is adopted. A different file is left unchanged.
 */
const commitFunctionFile = async (
  root: string,
  relativePath: string,
  bytes: Buffer,
  resources: ExportResources,
): Promise<FileCommit> => {
  if (!isDecompileFunctionRelativePath(relativePath)) return { status: "io" };
  const finalPath = join(root, relativePath);
  if (!isPathWithinRoot(root, finalPath)) return { status: "io" };
  const digest = sha256(bytes);
  const linked = await resources.publish(bytes, finalPath, "link").then(
    () => true,
    (cause: unknown) => cause,
  );
  if (linked === true) return { status: "written", sha256: digest };
  if (linked instanceof ArtifactReaderFailure && linked.cleanup !== undefined)
    return {
      status: "error",
      error: exportOutputFailure(
        "decompile function publication cleanup failed",
        linked,
      ),
    };
  if (nodeCode(linked) !== "EEXIST") return { status: "io" };
  const existing = await resources
    .hashFile(finalPath)
    .catch((cause: unknown) => cause);
  if (
    existing instanceof ArtifactReaderFailure &&
    existing.cleanup !== undefined
  )
    return {
      status: "error",
      error: exportOutputFailure(
        "decompile file verification cleanup failed",
        existing,
      ),
    };
  if (typeof existing !== "string") return { status: "io" };
  return existing === digest
    ? { status: "matched", sha256: digest }
    : { status: "conflict" };
};

const missingOrRejected = async (
  stripped: string,
  listed: unknown,
): Promise<Result<OutputPlacement, AnalysisError>> => {
  if (isSymlinkStat(listed))
    return err(
      decompileInputError(
        "output_directory",
        "The output directory must be a real directory, not a symlink.",
      ),
    );
  if (isStat(listed))
    return err(
      decompileInputError(
        "output_directory",
        "The output path exists and is not a directory.",
      ),
    );
  if (nodeCode(listed) !== "ENOENT")
    return err(
      decompileInputError(
        "output_directory",
        "The output directory could not be inspected.",
      ),
    );
  const parent = await realpath(dirname(stripped)).catch(
    (cause: unknown) => cause,
  );
  if (typeof parent !== "string")
    return err(
      decompileInputError(
        "output_directory",
        "The output directory's parent does not exist.",
      ),
    );
  return ok({ mode: "create", root: join(parent, basename(stripped)) });
};

const createPrivateDirectory = async (
  root: string,
): Promise<Result<void, AnalysisError>> => {
  const created = await mkdir(root, { mode: 0o700 }).catch(
    (cause: unknown) => cause,
  );
  if (created !== undefined)
    return err(
      nodeCode(created) === "EEXIST"
        ? decompileInputError(
            "output_directory",
            "Output directory already exists. Pass resume to continue an export that matches this target and analysis profile.",
          )
        : decompileInputError(
            "output_directory",
            "The output directory could not be created.",
          ),
    );
  // This call created the directory, so it owns removing it when the
  // directory cannot be made private. Leaving it would block a fresh export
  // and a resume alike, because no journal exists yet.
  const secured = await chmod(root, 0o700).catch((cause: unknown) => cause);
  if (secured === undefined) return ok(undefined);
  // The directory is still empty, so a non-recursive removal fails closed on
  // a path that another process filled meanwhile or replaced with a file or
  // symlink.
  const removed = await rmdir(root).then(
    () => true,
    () => false,
  );
  return err(
    decompileInputError(
      "output_directory",
      removed
        ? "The output directory could not be secured."
        : "The output directory could not be secured, and the directory this call created could not be removed. Remove it before retrying.",
    ),
  );
};

const prepareFunctionsDirectory = async (
  root: string,
  resources: ExportResources,
): Promise<Result<void, AnalysisError>> => {
  const directory = join(root, DECOMPILE_DIRECTORY_FUNCTIONS_DIRECTORY);
  const created = await mkdir(directory, { mode: 0o700 }).catch(
    (cause: unknown) => cause,
  );
  if (created !== undefined && nodeCode(created) !== "EEXIST")
    return err(
      decompileInputError(
        "output_directory",
        "The functions directory could not be created.",
      ),
    );
  const stat = await lstat(directory, { bigint: true }).catch(
    (cause: unknown) => cause,
  );
  if (!isDirectoryStat(stat) || !hasFileIdentity(stat))
    return err(
      decompileInputError(
        "output_directory",
        "The functions directory is not a real directory.",
      ),
    );
  resources.ownFunctionsDirectory(stat);
  const secured = await chmod(directory, 0o700).catch(
    (cause: unknown) => cause,
  );
  return secured === undefined
    ? ok(undefined)
    : err(
        decompileInputError(
          "output_directory",
          "The functions directory could not be secured.",
        ),
      );
};

const seedJournal = async (
  root: string,
  identity: ExportIdentity,
  resources: ExportResources,
): Promise<Result<FileHandle, AnalysisError>> => {
  const header = decompileJournalHeaderSchema.safeParse({
    kind: "header",
    version: 1,
    target_sha256: identity.targetSha256,
    provider: identity.provider,
    analysis_profile_digest: identity.analysisProfileDigest,
    layout: identity.layout,
  });
  if (!header.success)
    return err(
      new AnalysisOutputError(
        "decompile_all",
        "decompile journal header is invalid",
      ),
    );
  const opened = await openJournal(root, "wx");
  if (!opened.ok) return opened;
  resources.ownFile(
    opened.value,
    join(root, DECOMPILE_DIRECTORY_JOURNAL_NAME),
    true,
  );
  const seeded = await opened.value
    .writeFile(`${JSON.stringify(header.data)}\n`)
    .then(() => opened.value.sync())
    .then(() => chmod(join(root, DECOMPILE_DIRECTORY_JOURNAL_NAME), 0o600))
    .then(
      () => true,
      () => false,
    );
  if (seeded) return opened;
  return err(
    decompileInputError(
      "output_directory",
      "The decompile journal could not be created.",
    ),
  );
};

/** Absent on Windows, where the journal's lstat check is the only guard. */
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

const JOURNAL_FLAGS = {
  wx: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW,
  a: constants.O_WRONLY | constants.O_APPEND | NO_FOLLOW,
} as const;

/** The journal is never opened through a symlink: repair truncates it. */
const openJournal = async (
  root: string,
  flag: "wx" | "a",
): Promise<Result<FileHandle, AnalysisError>> => {
  const handle = await open(
    join(root, DECOMPILE_DIRECTORY_JOURNAL_NAME),
    JOURNAL_FLAGS[flag],
    0o600,
  ).catch((cause: unknown) => cause);
  return isFileHandle(handle)
    ? ok(handle)
    : err(
        decompileInputError(
          "output_directory",
          "The decompile journal could not be opened.",
        ),
      );
};

interface OpenedJournal {
  readonly records: Map<string, DecompileDirectoryFunctionRecord>;
  readonly written: Map<string, DecompileDirectoryFunctionRecord>;
  readonly paths: PathReservations;
  /** Byte length of the newline-terminated lines. */
  readonly committedBytes: number;
  /** Byte length of the journal file as read. */
  readonly journalBytes: number;
}

/** Read the journal only when it is a regular file, not a symlink. */
const readJournalBytes = async (
  root: string,
  resources: ExportResources,
): Promise<unknown> => {
  const path = join(root, DECOMPILE_DIRECTORY_JOURNAL_NAME);
  const stat = await lstat(path).catch((cause: unknown) => cause);
  if (!isStat(stat)) return stat;
  if (!stat.isFile()) return new Error("journal is not a regular file");
  const handle = await open(path, constants.O_RDONLY | NO_FOLLOW).catch(
    (cause: unknown) => cause,
  );
  if (!isFileHandle(handle)) return handle;
  const close = resources.ownFile(handle, path);
  const bytes = await handle.readFile().catch((cause: unknown) => cause);
  return (await close())
    ? bytes
    : new Error("decompile journal read handle could not be closed");
};

const readJournal = async (
  root: string,
  identity: ExportIdentity,
  resources: ExportResources,
): Promise<Result<OpenedJournal, AnalysisError>> => {
  const bytes = await readJournalBytes(root, resources);
  if (!(bytes instanceof Buffer))
    return err(
      nodeCode(bytes) === "ENOENT"
        ? decompileInputError(
            "output_directory",
            "Resume requires decompile-journal.jsonl in the output directory. An export stopped before its journal was written has no functions to keep; choose a new output directory, or remove this one if it is yours.",
          )
        : decompileInputError(
            "output_directory",
            "The decompile journal could not be read.",
          ),
    );
  const parsed = parseJournal(bytes);
  if (!parsed.ok) return parsed;
  const unknown = unknownIdentity(parsed.value.header, identity);
  if (unknown !== undefined) return err(unknown);
  return sameIdentity(parsed.value.header, identity)
    ? ok({
        records: parsed.value.records,
        written: parsed.value.written,
        paths: parsed.value.paths,
        committedBytes: parsed.value.committedBytes,
        journalBytes: parsed.value.journalBytes,
      })
    : err(
        decompileInputError(
          "output_directory",
          "The decompile journal does not match this target, provider, analysis profile, or layout.",
        ),
      );
};

const parseJournal = (
  bytes: Buffer,
): Result<
  OpenedJournal & { readonly header: DecompileJournalHeader },
  AnalysisError
> => {
  // Every committed line ends with a newline. Bytes after the last newline are
  // an interrupted append and are not part of the journal. Offsets are bytes,
  // so damaged UTF-8 cannot move the truncation point.
  const committedBytes = bytes.lastIndexOf(0x0a) + 1;
  const lines = bytes.subarray(0, committedBytes).toString("utf8").split("\n");
  lines.pop();
  const header = decompileJournalHeaderSchema.safeParse(parseJson(lines[0]));
  if (!header.success) return err(incompatibleJournal());
  const records = new Map<string, DecompileDirectoryFunctionRecord>();
  const written = new Map<string, DecompileDirectoryFunctionRecord>();
  // A path stays reserved by the first address that used it, even when that
  // address's latest record no longer names it.
  const paths: PathReservations = {
    byPortablePath: new Map(),
    byAddress: new Map(),
  };
  for (const line of lines.slice(1)) {
    const parsed = decompileJournalLineSchema.safeParse(parseJson(line));
    if (!parsed.success || parsed.data.kind !== "function")
      return err(incompatibleJournal());
    const { kind: _kind, ...record } = parsed.data;
    const path = record.relative_path;
    if (path !== undefined) {
      const owner = paths.byPortablePath.get(portablePathKey(path));
      if (owner !== undefined && owner !== record.address)
        return err(incompatibleJournal());
      reservePath(paths, path, record.address);
    }
    records.set(record.address, record);
    if (record.status === "written") written.set(record.address, record);
  }
  return ok({
    header: header.data,
    records,
    written,
    paths,
    committedBytes,
    journalBytes: bytes.length,
  });
};

/** Resume needs both identities known. Two unknown digests are not a match. */
const unknownIdentity = (
  header: DecompileJournalHeader,
  identity: ExportIdentity,
): AnalysisInputError | undefined => {
  if (header.target_sha256 === null || identity.targetSha256 === null)
    return decompileInputError(
      "output_directory",
      "Resume requires an observed target SHA-256 for both the journal and this target.",
    );
  if (
    header.analysis_profile_digest === null ||
    identity.analysisProfileDigest === null
  )
    return decompileInputError(
      "output_directory",
      "Resume requires an analysis profile digest for both the journal and this provider.",
    );
  return undefined;
};

const sameIdentity = (
  header: DecompileJournalHeader,
  identity: ExportIdentity,
): boolean =>
  header.target_sha256 === identity.targetSha256 &&
  header.analysis_profile_digest === identity.analysisProfileDigest &&
  header.layout === identity.layout &&
  header.provider.id === identity.provider.id &&
  header.provider.name === identity.provider.name &&
  header.provider.version === identity.provider.version;

const incompatibleJournal = (): AnalysisInputError =>
  decompileInputError(
    "output_directory",
    "The decompile journal is not a compatible export.",
  );

const parseJson = (line: string | undefined): unknown => {
  if (line === undefined) return undefined;
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
};

/** Function file paths: each path has one owning address, each address keeps its first path. */
interface PathReservations {
  readonly byPortablePath: Map<string, string>;
  readonly byAddress: Map<string, string>;
}

/** Generated and admitted function paths are ASCII; fold only their lookup key. */
const portablePathKey = (path: string): string => path.toLowerCase();

const reservePath = (
  paths: PathReservations,
  path: string,
  address: string,
): void => {
  const key = portablePathKey(path);
  if (!paths.byPortablePath.has(key)) paths.byPortablePath.set(key, address);
  if (!paths.byAddress.has(address)) paths.byAddress.set(address, path);
};

const allocateFunctionPath = (
  address: string,
  used: ReadonlyMap<string, string>,
): string => {
  const base = sanitizeAddress(address);
  const directory = DECOMPILE_DIRECTORY_FUNCTIONS_DIRECTORY;
  const plain = `${directory}/${base}.c`;
  if (!used.has(portablePathKey(plain))) return plain;
  const suffix = createHash("sha256").update(address).digest("hex").slice(0, 8);
  let candidate = `${directory}/${base}-${suffix}.c`;
  let discriminator = 0;
  // Terminates: `used` is finite.
  while (used.has(portablePathKey(candidate))) {
    discriminator += 1;
    candidate = `${directory}/${base}-${suffix}-${discriminator.toString(16)}.c`;
  }
  return candidate;
};

const sanitizeAddress = (address: string): string => {
  const cleaned = address
    .replace(/[^A-Za-z0-9._-]+/gu, "_")
    .replace(/^\.+/u, "")
    .slice(0, 120);
  return cleaned.length === 0 ? "function" : cleaned;
};

/** Private per-user parent of export lease sockets; it outlives individual runs. */
const DECOMPILE_EXPORT_LEASE_DIRECTORY = join(
  "/tmp",
  `rea-decompile-${(process.getuid?.() ?? 0).toString()}`,
);

/**
 * Hold the output directory for this run. The lease names the directory by
 * device and inode, so two spellings of one directory share it, and it ends
 * when this process exits, so a crashed run leaves no lock behind.
 */
const acquireExportLease = async (
  root: string,
  scope: RetainedResourceScope | undefined,
): Promise<
  Result<
    {
      readonly lease: OwnedLease;
      readonly identity: { readonly dev: bigint; readonly ino: bigint };
    },
    AnalysisError
  >
> => {
  const stat = await lstat(root, { bigint: true }).catch(
    (cause: unknown) => cause,
  );
  if (!isDirectoryStat(stat) || !hasFileIdentity(stat))
    return err(
      decompileInputError(
        "output_directory",
        "The output directory could not be inspected.",
      ),
    );
  const leaseResources = new ArtifactResourceScope();
  try {
    const acquisition = await acquireOwnedLease({
      identity: {
        operation: "decompile_all",
        device: stat.dev.toString(),
        inode: stat.ino.toString(),
      },
      runId: randomUUID(),
      directory: DECOMPILE_EXPORT_LEASE_DIRECTORY,
      failure: exportLeaseFailure,
      resources: leaseResources,
    });
    return acquisition.acquired
      ? ok({ lease: acquisition.lease, identity: stat })
      : err(
          new AnalysisResourceConstraintError(
            "decompile_all",
            "capacity",
            `another decompile_all run (process ${acquisition.owner.processId.toString()}) is using this output directory`,
            { holder_process_id: acquisition.owner.processId },
            {
              retryable: true,
              remediationAction:
                "Wait for the other decompile_all run on this output directory to finish, then retry with resume.",
            },
          ),
        );
  } catch (cause: unknown) {
    if (leaseResources.hasPending)
      scope?.retain(
        {
          close: () => leaseResources.close(),
          get cleanupResources() {
            return leaseResources.cleanupResources;
          },
        },
        "decompile lease directory",
      );
    return err(
      cause instanceof AnalysisError
        ? cause
        : new AnalysisOutputError(
            "decompile_all",
            "output directory lease could not be acquired",
            { cause },
          ),
    );
  }
};

const exportLeaseFailure = (
  failure: LeaseFailure,
  cause?: unknown,
): AnalysisOutputError => {
  const primary =
    cause instanceof OwnedLeaseCleanupFailure
      ? cause.primary
      : cause instanceof ArtifactFileCleanupFailure &&
          cause.fileCleanupFailure.outcome.kind === "failed"
        ? cause.fileCleanupFailure.outcome.cause
        : undefined;
  const error = new AnalysisOutputError(
    "decompile_all",
    "output directory lease could not be acquired",
    {
      ...(cause === undefined ? {} : { cause }),
      ...(primary instanceof AnalysisError ? { cleanupPrimary: primary } : {}),
      ...(cause instanceof ArtifactFileCleanupFailure ||
      cause instanceof OwnedLeaseCleanupFailure
        ? { cleanup: cause.cleanup }
        : {}),
      userMessage:
        primary instanceof AnalysisError
          ? (primary.userMessage ?? exportLeaseMessage(failure))
          : exportLeaseMessage(failure),
    },
  );
  bindArtifactFileCleanup(cause, error);
  return error;
};

const exportLeaseMessage = (failure: LeaseFailure): string => {
  switch (failure.kind) {
    case "owner_unverified":
      return `Another process holds this output directory's lease but did not identify itself (${failure.reason}). Retry after it finishes.`;
    case "recovery_busy":
      return `Another run is recovering this output directory's lease at ${JSON.stringify(failure.path)}. Retry shortly. If no REA process is running, remove that directory.`;
    case "recovery_remove":
      return `REA could not remove its lease recovery directory at ${JSON.stringify(failure.path)}. Check its write access before retrying.`;
    case "unrecoverable":
      return "REA could not take this output directory's lease. Retry after other decompile_all runs finish.";
    case "socket_permissions":
      return "REA could not secure its lease socket permissions.";
    case "directory_close":
      return "REA could not confirm closure of its output lease directory handle.";
    case "directory_access_denied":
      return `REA could not access its lease directory at ${JSON.stringify(failure.directory)}. Restore owner-only permissions (0700) on a directory you own, then retry.`;
    case "directory_create":
    case "directory_not_private":
    case "directory_permissions":
    case "directory_inspect":
    case "recovery_create":
      return `REA could not use its private lease directory ${JSON.stringify(DECOMPILE_EXPORT_LEASE_DIRECTORY)}. Check that it is a directory owned by this user with permissions 0700.`;
  }
};

const hasFileIdentity = (
  value: unknown,
): value is { readonly dev: bigint; readonly ino: bigint } =>
  typeof value === "object" &&
  value !== null &&
  "dev" in value &&
  "ino" in value &&
  typeof value.dev === "bigint" &&
  typeof value.ino === "bigint";

const writeOwnedIndex = async (
  root: string,
  text: string,
  resources: ExportResources,
): Promise<Result<void, AnalysisError>> => {
  try {
    await resources.publish(
      text,
      join(root, DECOMPILE_DIRECTORY_INDEX_NAME),
      "rename",
    );
    return ok(undefined);
  } catch (cause: unknown) {
    return err(
      exportOutputFailure(
        cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined
          ? "decompile index publication cleanup failed"
          : "decompile index could not be written",
        cause,
      ),
    );
  }
};

/** Preserve the publisher's parsed failure and exact cleanup authority. */
export const exportOutputFailure = (
  message: string,
  cause: unknown,
): AnalysisOutputError => {
  const error = new AnalysisOutputError("decompile_all", message, {
    cause,
    ...(cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined
      ? { cleanup: cause.cleanup }
      : {}),
  });
  bindArtifactFileCleanup(cause, error);
  return error;
};

export const sha256 = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

const isFileHandle = (value: unknown): value is FileHandle =>
  typeof value === "object" &&
  value !== null &&
  "write" in value &&
  "sync" in value &&
  "close" in value;

const isDirectoryStat = (value: unknown): boolean =>
  isStat(value) && value.isDirectory() && !value.isSymbolicLink();

const isSymlinkStat = (value: unknown): boolean =>
  isStat(value) && value.isSymbolicLink();

const isStat = (
  value: unknown,
): value is {
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
} =>
  typeof value === "object" &&
  value !== null &&
  "isDirectory" in value &&
  "isFile" in value &&
  "isSymbolicLink" in value &&
  typeof value.isDirectory === "function" &&
  typeof value.isSymbolicLink === "function";

const nodeCode = (cause: unknown): string | undefined =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  typeof cause.code === "string"
    ? cause.code
    : undefined;
