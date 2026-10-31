import { access, lstat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { PrivateRuntimeRoot } from "../process/PrivateRuntimeRoot.js";
import { readWindowsPrivateRuntimeFile } from "../windows/WindowsPrivateRuntime.js";
import { err, ok, type Result } from "../domain/result.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  assertArtifactReadActive,
  artifactFilePrimaryFacts,
  artifactFileCancellationCause,
  bindArtifactFileCleanup,
  withArtifactRegularFile,
} from "../artifacts/ArtifactFileOperation.js";
import { readArtifactFileChunks } from "../artifacts/readArtifactFileChunks.js";
import { sameRegularFileState } from "../filesystem/RegularFile.js";
import {
  GhidraSessionError,
  bindGhidraSessionFailure,
} from "./GhidraSessionError.js";

/** Local bridge transports used by the current Ghidra session. */
export type GhidraTransportKind = "unix-socket" | "authenticated-loopback-tcp";

/** Private runtime coordinate used to discover one bridge listener. */
export interface GhidraEndpoint {
  readonly transport: GhidraTransportKind;
  readonly path: string;
}

/** Allocate an endpoint that fits the host's Unix sockaddr without moving the project. */
export const createGhidraEndpoint = async (
  runtimeRoot: string,
  transport: GhidraTransportKind,
  platform: NodeJS.Platform,
): Promise<{
  readonly endpoint: GhidraEndpoint;
  readonly socketRoot?: PrivateRuntimeRoot;
}> => {
  const path = join(
    runtimeRoot,
    transport === "unix-socket" ? "bridge.sock" : "bridge-endpoint.json",
  );
  // sockaddr_un includes a terminating NUL: macOS has 104 bytes, Linux 108.
  const maximumPathBytes = platform === "darwin" ? 103 : 107;
  if (
    transport !== "unix-socket" ||
    Buffer.byteLength(path, "utf8") <= maximumPathBytes
  )
    return { endpoint: { transport, path } };
  const socketRoot = await PrivateRuntimeRoot.create({
    parent: "/tmp",
    prefix: "rea-ghidra-socket-",
    platform,
  });
  return {
    endpoint: { transport, path: join(socketRoot.path, "s") },
    socketRoot,
  };
};

/** Exact Node connection target after endpoint discovery. */
export type GhidraConnectTarget =
  | { readonly path: string }
  | { readonly host: "127.0.0.1"; readonly port: number };

const tcpEndpointSchema = z.strictObject({
  host: z.literal("127.0.0.1"),
  port: z.number().int().min(1).max(65_535),
});
// ReaGhidraBridge.serveTcp publishes compact Gson JSON followed by one newline.
// Both fields are fixed ASCII, and the bound includes the longest legal port.
const MAX_TCP_ENDPOINT_BYTES = Buffer.byteLength(
  JSON.stringify({ host: "127.0.0.1", port: 65_535 }) + "\n",
);

/** Observe one endpoint under the same file owner as its startup and finalization. */
export const observeGhidraEndpoint = async (
  endpoint: GhidraEndpoint,
  options: {
    readonly signal?: AbortSignal;
    readonly resourceScope?: ArtifactResourceScope;
  } = {},
): Promise<Result<GhidraConnectTarget | null, GhidraSessionError>> => {
  const resources = options.resourceScope ?? new ArtifactResourceScope();
  try {
    const target = await resources.run(async () => {
      assertArtifactReadActive(options.signal);
      if (endpoint.transport === "unix-socket") {
        await access(endpoint.path);
        assertArtifactReadActive(options.signal);
        return { path: endpoint.path };
      }
      if (process.platform === "win32") {
        const encoded = readWindowsPrivateRuntimeFile(endpoint.path);
        assertArtifactReadActive(options.signal);
        return parseTcpEndpoint(endpoint, encoded);
      }
      return withArtifactRegularFile(
        endpoint.path,
        resources,
        options.signal,
        async ({ handle: file }) => {
          const initial = await file.stat({ bigint: true });
          assertArtifactReadActive(options.signal);
          if (initial.size > BigInt(MAX_TCP_ENDPOINT_BYTES))
            throw endpointFailure(
              endpoint,
              "Ghidra TCP endpoint is invalid",
              new ArtifactReaderFailure(
                "limit",
                `Ghidra endpoint record exceeds its compact publication bound (${initial.size} > ${MAX_TCP_ENDPOINT_BYTES} bytes)`,
              ),
            );
          const input = readArtifactFileChunks(file, {
            end: initial.size,
            signal: options.signal,
          });
          const chunks: Buffer[] = [];
          for await (const chunk of input) chunks.push(Buffer.from(chunk));
          const coverage = input.readCoverage();
          const after = await file.stat({ bigint: true });
          const named = await lstat(endpoint.path, { bigint: true }).catch(
            (cause: unknown) => {
              throw endpointFailure(
                endpoint,
                "Ghidra TCP endpoint changed during observation",
                cause,
              );
            },
          );
          if (
            coverage.kind !== "complete" ||
            coverage.bytes !== initial.size ||
            !sameRegularFileState(initial, after) ||
            !sameRegularFileState(initial, named)
          )
            throw endpointFailure(
              endpoint,
              "Ghidra TCP endpoint changed during observation",
            );
          assertArtifactReadActive(options.signal);
          return parseTcpEndpoint(
            endpoint,
            Buffer.concat(chunks).toString("utf8"),
          );
        },
      );
    });
    return ok(target);
  } catch (cause: unknown) {
    if (
      isMissing(cause) ||
      (process.platform === "win32" && isWindowsEndpointWriterBusy(cause))
    )
      return ok(null);
    return err(observationFailure(endpoint, cause));
  }
};

const parseTcpEndpoint = (
  endpoint: GhidraEndpoint,
  encoded: string,
): GhidraConnectTarget => {
  try {
    return tcpEndpointSchema.parse(JSON.parse(encoded));
  } catch (cause: unknown) {
    throw endpointFailure(endpoint, "Ghidra TCP endpoint is invalid", cause);
  }
};

const observationFailure = (
  endpoint: GhidraEndpoint,
  cause: unknown,
): GhidraSessionError => {
  const { cause: primary, origin } = artifactFilePrimaryFacts(cause);
  let failure =
    origin === "owned-or-classified" && primary instanceof GhidraSessionError
      ? primary
      : cause instanceof ArtifactReaderFailure && cause.reason === "cancelled"
        ? bindGhidraSessionFailure(() => ({
            transport: endpoint.transport,
            endpoint_path: endpoint.path,
          }))("cancelled", "Ghidra endpoint observation was cancelled", cause, {
            cancellation: { reason: artifactFileCancellationCause(cause) },
          })
        : endpointFailure(
            endpoint,
            "Ghidra endpoint observation failed",
            cause,
          );
  if (cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined) {
    const cleanup = new ProviderCleanupError(
      "ghidra",
      cause.cleanup.resources,
      {
        reason: "Ghidra endpoint descriptor cleanup remains incomplete",
      },
      { cause },
    );
    bindArtifactFileCleanup(cause, cleanup);
    failure = failure.withCleanupFailure(cleanup);
  }
  return failure;
};

const endpointFailure = (
  endpoint: GhidraEndpoint,
  message: string,
  cause?: unknown,
): GhidraSessionError =>
  bindGhidraSessionFailure(() => ({
    transport: endpoint.transport,
    endpoint_path: endpoint.path,
  }))("start", message, cause);

const isMissing = (cause: unknown): boolean =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT";

const isWindowsEndpointWriterBusy = (cause: unknown): boolean =>
  cause instanceof Error && "win32Code" in cause && cause.win32Code === 32;
