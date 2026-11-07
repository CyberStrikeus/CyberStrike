import { createHash } from "node:crypto";
import { chmod, mkdir, open, rm, rmdir } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from "node:net";
import { join } from "node:path";

import {
  ArtifactFileCleanupFailure,
  withArtifactFileHandle,
} from "../artifacts/ArtifactFileOperation.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";

import { safeParseJson } from "../domain/safeJson.js";

/** The process that holds a lease, as that process reports itself. */
export interface LeaseOwner {
  readonly runId: string;
  readonly processId: number;
}

export interface OwnedLease {
  /** Bound socket identity for cleanup diagnostics; omission remains unknown. */
  readonly socketPath?: string;
  readonly release: () => Promise<void>;
}

export type LeaseAcquisition =
  | { readonly acquired: true; readonly lease: OwnedLease }
  | { readonly acquired: false; readonly owner: LeaseOwner };

/** Why a lease could be neither acquired nor attributed to its owner. */
export type LeaseFailure =
  | { readonly kind: "directory_create" }
  | { readonly kind: "directory_not_private" }
  | { readonly kind: "directory_permissions" }
  | { readonly kind: "directory_access_denied"; readonly directory: string }
  | { readonly kind: "directory_inspect" }
  | { readonly kind: "directory_close" }
  | { readonly kind: "socket_permissions" }
  | { readonly kind: "recovery_busy"; readonly path: string }
  | { readonly kind: "recovery_create"; readonly path: string }
  | { readonly kind: "recovery_remove"; readonly path: string }
  | { readonly kind: "owner_unverified"; readonly reason: string }
  | { readonly kind: "unrecoverable" };

export type LeaseFailureFactory = (
  failure: LeaseFailure,
  cause?: unknown,
) => Error;

/** Recovery finalization retains its operation outcome and every failed owner. */
export class OwnedLeaseCleanupFailure extends ArtifactReaderFailure {
  override readonly cleanupLeases;
  constructor(
    readonly primary: unknown,
    failure: ArtifactReaderFailure,
  ) {
    super(failure.reason, failure.message, {
      cause: primary,
      cleanup: failure.cleanup,
    });
    this.cleanupLeases = failure.cleanupLeases;
  }
}

/**
 * Hold one named lease for as long as this process keeps it.
 *
 * The lease is a listening local socket, so the operating system ends it when
 * the owning process exits. A crashed owner leaves a socket that refuses
 * connections; recovery replaces only that stale socket. A live owner answers
 * with its own identity, which is reported instead of a PID guess.
 */
export const acquireOwnedLease = async (input: {
  readonly identity: Readonly<Record<string, unknown>>;
  readonly runId: string;
  /** Private per-user directory for POSIX sockets. Unused on Windows. */
  readonly directory: string;
  readonly failure: LeaseFailureFactory;
  readonly resources?: ArtifactResourceScope | undefined;
}): Promise<LeaseAcquisition> => {
  const produced = new WeakSet<Error>();
  const cleanupCauses = new WeakMap<Error, ArtifactReaderFailure>();
  const fail = (failure: LeaseFailure, cause?: unknown): Error => {
    const error = input.failure(failure, cause);
    produced.add(error);
    if (cause instanceof ArtifactReaderFailure) cleanupCauses.set(error, cause);
    return error;
  };
  const key = createHash("sha256")
    .update(JSON.stringify(input.identity))
    .digest("hex")
    .slice(0, 32);
  const resources = input.resources ?? new ArtifactResourceScope();
  const owner = { runId: input.runId, processId: process.pid };
  if (process.platform === "win32") {
    // A named pipe disappears with its last handle, so no stale pipe needs
    // recovery. A pipe that vanished between bind and owner lookup is retried.
    const pipePath = `\\\\.\\pipe\\rea-lease-${key}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const acquisition = await tryAcquireLease(
        pipePath,
        owner,
        fail,
        false,
        resources,
      );
      if (typeof acquisition !== "string") return acquisition;
    }
    throw fail({ kind: "unrecoverable" });
  }
  await ensureLeaseDirectory(input.directory, fail, produced, input.resources);
  const socketPath = join(input.directory, `${key}.sock`);
  const acquisition = await tryAcquireLease(
    socketPath,
    owner,
    fail,
    true,
    resources,
  );
  if (typeof acquisition !== "string") return acquisition;

  // Serialize stale cleanup through the replacement bind: otherwise two
  // recoverers can unlink the socket that one of them has just acquired.
  const recoveryPath = `${socketPath}.recovery`;
  await reserveRecovery(recoveryPath, fail);
  const recoveryOwner = {
    kind: "lease" as const,
    resource: recoveryPath,
    lease: { release: () => rmdir(recoveryPath) },
  };
  let recovered: LeaseAcquisition | "missing" | "stale" | undefined;
  let primary: unknown;
  let failed = false;
  try {
    recovered = await tryAcquireLease(socketPath, owner, fail, true, resources);
    if (recovered === "stale") await rm(socketPath, { force: true });
    if (typeof recovered === "string")
      recovered = await tryAcquireLease(
        socketPath,
        owner,
        fail,
        true,
        resources,
      );
    if (typeof recovered === "string") throw fail({ kind: "unrecoverable" });
  } catch (cause: unknown) {
    failed = true;
    primary = cause;
  }
  const directoryCleanup = await resources.release(recoveryOwner);
  if (directoryCleanup.kind === "failed") {
    const failures = [directoryCleanup];
    if (typeof recovered !== "string" && recovered?.acquired) {
      const socketCleanup = await resources.release({
        kind: "lease",
        resource: recovered.lease.socketPath ?? socketPath,
        lease: recovered.lease,
      });
      if (socketCleanup.kind === "failed") failures.push(socketCleanup);
    }
    const outcome = failed
      ? primary
      : fail(
          { kind: "recovery_remove", path: recoveryPath },
          directoryCleanup.cause,
        );
    throw fail(
      { kind: "recovery_remove", path: recoveryPath },
      new OwnedLeaseCleanupFailure(
        outcome,
        resources.cleanupFailure(
          {
            kind: "failed",
            cause:
              outcome instanceof Error
                ? (cleanupCauses.get(outcome) ?? outcome)
                : outcome,
          },
          [failures[0]!, ...failures.slice(1)],
        ),
      ),
    );
  }
  if (failed) throw primary;
  if (typeof recovered !== "string" && recovered !== undefined)
    return recovered;
  throw fail({ kind: "unrecoverable" });
};

const reserveRecovery = async (
  recoveryPath: string,
  fail: (failure: LeaseFailure, cause?: unknown) => Error,
): Promise<void> => {
  try {
    await mkdir(recoveryPath, { mode: 0o700 });
  } catch (cause: unknown) {
    const busy =
      typeof cause === "object" &&
      cause !== null &&
      Reflect.get(cause, "code") === "EEXIST";
    throw fail(
      busy
        ? { kind: "recovery_busy", path: recoveryPath }
        : { kind: "recovery_create", path: recoveryPath },
      cause,
    );
  }
};

const tryAcquireLease = async (
  socketPath: string,
  owner: LeaseOwner,
  fail: (failure: LeaseFailure, cause?: unknown) => Error,
  securePath: boolean,
  resources: ArtifactResourceScope,
): Promise<LeaseAcquisition | "missing" | "stale"> => {
  const connections = new Set<Socket>();
  const server = createServer((socket) => {
    connections.add(socket);
    socket.once("close", () => connections.delete(socket));
    // A failed owner reply ends only this connection, not the lease owner.
    socket.on("error", () => socket.destroy());
    sendOwner(socket, owner);
  });
  // The lease lives exactly as long as its owning process. A lease retained
  // after unconfirmed cleanup must not keep a completed one-shot command
  // alive; process exit leaves a stale socket that later acquirers recover.
  server.unref();
  if (!(await bind(server, socketPath))) {
    const existingOwner = await readOwner(socketPath, fail);
    return typeof existingOwner === "string"
      ? existingOwner
      : { acquired: false, owner: existingOwner };
  }
  let released = false;
  const lease: OwnedLease = {
    socketPath,
    release: async () => {
      if (released) return;
      // Owner replies do not require peers to close their writable half. End
      // every accepted connection before awaiting the listening server.
      for (const socket of connections) socket.destroy();
      // Node removes the bound socket; never unlink a later owner's socket.
      await closeServer(server);
      released = true;
    },
  };
  if (securePath)
    try {
      await chmod(socketPath, 0o600);
    } catch (cause: unknown) {
      const primary = fail({ kind: "socket_permissions" }, cause);
      const cleanup = await resources.release({
        kind: "lease",
        resource: socketPath,
        lease,
      });
      if (cleanup.kind === "failed")
        throw fail(
          { kind: "socket_permissions" },
          new OwnedLeaseCleanupFailure(
            primary,
            resources.cleanupFailure({ kind: "failed", cause: primary }, [
              cleanup,
            ]),
          ),
        );
      throw primary;
    }
  return { acquired: true, lease };
};

const ensureLeaseDirectory = async (
  directory: string,
  fail: (failure: LeaseFailure, cause?: unknown) => Error,
  produced: WeakSet<Error>,
  resources: ArtifactResourceScope | undefined,
): Promise<void> => {
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  } catch (cause: unknown) {
    throw fail({ kind: "directory_create" }, cause);
  }
  const inspectionFailure = (cause: unknown): Error => {
    if (cause instanceof Error && produced.has(cause)) return cause;
    const accessDenied =
      process.getuid !== undefined &&
      cause instanceof Error &&
      "code" in cause &&
      cause.code === "EACCES";
    return fail(
      accessDenied
        ? { kind: "directory_access_denied", directory }
        : { kind: "directory_inspect" },
      cause,
    );
  };
  // Use O_DIRECTORY|O_NOFOLLOW to open the directory without following symlinks,
  // then inspect and secure that descriptor. Later socket operations still use
  // the path and are not made atomic by this directory validation.
  try {
    const handle = await open(
      directory,
      fsConstants.O_RDONLY |
        (fsConstants.O_DIRECTORY ?? 0) |
        (fsConstants.O_NOFOLLOW ?? 0),
    );
    await withArtifactFileHandle(
      directory,
      handle,
      resources,
      undefined,
      async (handle) => {
        try {
          const directoryStat = await handle.stat();
          if (
            directoryStat.isSymbolicLink() ||
            directoryStat.isDirectory() === false ||
            (process.getuid !== undefined &&
              directoryStat.uid !== process.getuid())
          )
            throw fail({ kind: "directory_not_private" });
          // POSIX permission hardening: chmod on the already-opened descriptor avoids
          // a second TOCTOU window where the directory could be swapped between check
          // and permission fix.
          const posixPermissionsApply = process.getuid !== undefined;
          if (posixPermissionsApply && (directoryStat.mode & 0o077) !== 0) {
            await handle.chmod(0o700);
            // Re-verify permissions on the same opened directory.
            const afterChmod = await handle.stat();
            if (
              afterChmod.isSymbolicLink() ||
              afterChmod.isDirectory() === false ||
              (afterChmod.mode & 0o077) !== 0
            )
              throw fail({ kind: "directory_permissions" });
          }
        } catch (cause: unknown) {
          throw inspectionFailure(cause);
        }
      },
    );
  } catch (cause: unknown) {
    if (cause instanceof ArtifactFileCleanupFailure)
      throw fail({ kind: "directory_close" }, cause);
    throw inspectionFailure(cause);
  }
};

const bind = (server: Server, socketPath: string): Promise<boolean> =>
  new Promise((resolveBind, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.removeListener("listening", onListening);
      if (error.code === "EADDRINUSE") resolveBind(false);
      else reject(error);
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      resolveBind(true);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(socketPath);
  });

const sendOwner = (socket: Socket, owner: LeaseOwner): void => {
  socket.end(`${JSON.stringify(owner)}\n`);
};

const readOwner = (
  socketPath: string,
  fail: (failure: LeaseFailure, cause?: unknown) => Error,
): Promise<LeaseOwner | "missing" | "stale"> =>
  new Promise((resolveOwner, rejectOwner) => {
    const socket = createConnection(socketPath);
    socket.setEncoding("utf8");
    let response = "";
    let settled = false;
    const reject = (reason: string, cause?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      rejectOwner(fail({ kind: "owner_unverified", reason }, cause));
    };
    const timer = setTimeout(() => reject("owner response timed out"), 250);
    const finish = (owner: LeaseOwner | "missing" | "stale"): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolveOwner(owner);
    };
    socket.on("data", (chunk: string) => {
      response += chunk;
      const newline = response.indexOf("\n");
      if (newline < 0) return;
      const parsed = safeParseJson(response.slice(0, newline));
      if (!parsed.ok) {
        reject("malformed owner response");
        return;
      }
      const value: unknown = parsed.value;
      const runId =
        typeof value === "object" && value !== null
          ? Reflect.get(value, "runId")
          : undefined;
      const processId =
        typeof value === "object" && value !== null
          ? Reflect.get(value, "processId")
          : undefined;
      if (
        typeof runId === "string" &&
        runId.length > 0 &&
        typeof processId === "number" &&
        Number.isSafeInteger(processId) &&
        processId > 0
      )
        finish({ runId, processId });
      else reject("invalid owner identity");
    });
    socket.on("error", (cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT") finish("missing");
      else if (cause.code === "ECONNREFUSED") finish("stale");
      else reject(cause.code ?? "owner connection failed", cause);
    });
    socket.on("end", () => reject("owner closed without a complete response"));
  });

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolveClose, reject) => {
    if (!server.listening) {
      resolveClose();
      return;
    }
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
