import { fileURLToPath } from "node:url";

import { mediaTypeEssence } from "../../domain/analysisView/recordedMediaType.js";
import {
  ArtifactResourceRetryFailure,
  type ArtifactResourceScope,
} from "../../artifacts/ArtifactResourceScope.js";
import { STATE_INTAKE_LIMIT_BYTES } from "../../application/environment/environmentStateDocument.js";
import { isExactJsonNumber } from "../../domain/exactJsonNumber.js";
import { paddedBase64ByteLength } from "../../domain/paddedBase64.js";
import { err, ok, type Result } from "../../domain/result.js";
import { safeParseJson } from "../../domain/safeJson.js";
import {
  RegularFileCapacityError,
  readStableFileBytes,
} from "../../filesystem/readStableFileBytes.js";
import {
  RegularFileCleanupFailure,
  withOwnedRegularFile,
} from "../../filesystem/OwnedRegularFile.js";

/** Why a named file or download could not be read, or a call was cancelled: a category naming neither the uri nor the content. */
export type IntakeFailure =
  | "not-found"
  | "permission"
  | "not-regular-file"
  | "changed"
  | "read-failed"
  | "timeout"
  | "http-status"
  | "network"
  | "cancelled";

/** A JSON-RPC error the data plane answers with; `data` locates a document problem, names an intake failure or states the response budget. */
export interface RpcError {
  readonly code: number;
  readonly message: string;
  readonly data?:
    | { readonly path: string }
    | { readonly reason: IntakeFailure }
    | { readonly max_response_bytes: number; readonly reply_bytes: number };
}

const INVALID_PARAMS = -32602;
/** The data plane could not complete an operation whose params were valid. */
export const SERVER_ERROR = -32000;

/** A call the server's stop or its caller's departure ended before it could change the state. */
export const CANCELLED: RpcError = {
  code: SERVER_ERROR,
  message: "the call was cancelled and left the state unchanged",
  data: { reason: "cancelled" },
};

/** An https state download must finish within this time. */
export const STATE_FETCH_TIMEOUT_MS = 30_000;

/** Fetches one https state document; injectable so tests make no external requests. */
export type StateFetcher = (url: URL, signal: AbortSignal) => Promise<Response>;

/** Redirects are refused so a download never leaves the https origin the caller named. */
export const fetchStateDocument: StateFetcher = (url, signal) =>
  fetch(url, { signal, redirect: "error" });

/** How `data/add` reaches documents a uri names; injectable so tests make no external requests and need not wait. */
export interface StateIntake {
  readonly fetchState: StateFetcher;
  readonly timeoutMs: number;
}

/** The intake a served environment uses. */
export const DEFAULT_STATE_INTAKE: StateIntake = {
  fetchState: fetchStateDocument,
  timeoutMs: STATE_FETCH_TIMEOUT_MS,
};

/** Stands in for a number that native JSON parsing or serialization would change. */
const NOT_EXACT_JSON = Symbol("not exact JSON");

/** Mark values native parsing would change, so validation refuses them rather than storing an altered value. */
export const exactJsonReviver = (
  _key: string,
  value: unknown,
  context?: { readonly source?: string },
): unknown =>
  typeof value === "number" && !isExactJsonNumber(value, context?.source)
    ? NOT_EXACT_JSON
    : value;

export const invalidParams = (detail: string, path?: string): RpcError => ({
  code: INVALID_PARAMS,
  message: `invalid params: ${detail}`,
  ...(path === undefined ? {} : { data: { path } }),
});

const TOO_LARGE = invalidParams(
  `the state document exceeds ${String(STATE_INTAKE_LIMIT_BYTES)} bytes`,
);

const unreadable = (reason: IntakeFailure): RpcError => ({
  ...invalidParams("the file uri does not name a readable regular file"),
  data: { reason },
});

const fetchFailed = (reason: IntakeFailure): RpcError => ({
  code: SERVER_ERROR,
  message: "the state document could not be downloaded",
  data: { reason },
});

const FILE_FAILURES: ReadonlyMap<string, IntakeFailure> = new Map([
  ["ENOENT", "not-found"],
  ["ENOTDIR", "not-found"],
  ["EACCES", "permission"],
  ["EPERM", "permission"],
  ["EISDIR", "not-regular-file"],
  ["ENOTFILE", "not-regular-file"],
  ["ESTALE", "changed"],
]);

/** The coarse category of a file open or read failure, from its error code. */
const fileFailure = (cause: unknown): IntakeFailure =>
  (cause instanceof Error && "code" in cause
    ? FILE_FAILURES.get(String(cause.code))
    : undefined) ?? "read-failed";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const MAX_INLINE_BASE64_CHARACTERS =
  Math.ceil(STATE_INTAKE_LIMIT_BYTES / 3) * 4;

/** Parse loaded bytes as UTF-8 JSON, marking values parsing would change; the content is never echoed. */
const parseDocumentBytes = (bytes: Uint8Array): Result<unknown, RpcError> => {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return err(invalidParams("the file is not UTF-8 text"));
  }
  const parsed = safeParseJson(text, exactJsonReviver);
  return parsed.ok
    ? ok(parsed.value)
    : err(invalidParams("the file is not JSON"));
};

const CLOSE_FAILED: RpcError = {
  code: SERVER_ERROR,
  message:
    "the state file could not be closed; the server retries the close before the next file read and at shutdown",
};

const STILL_OPEN: RpcError = {
  code: SERVER_ERROR,
  message:
    "an earlier state file is still open after its close failed, so no file was read",
};

/** Read one regular file within the intake limit; a descriptor whose close fails stays with `files`, which retries it before each later read. */
const readStateFile = async (
  path: string,
  files: ArtifactResourceScope,
): Promise<Result<Buffer, RpcError>> => {
  try {
    return ok(
      await files.run(() =>
        withOwnedRegularFile(
          path,
          {
            symlinks: "follow",
            retainFailedClose: (owner) =>
              files.retain({
                kind: "file-handle",
                resource: path,
                handle: owner,
              }),
          },
          ({ handle }) =>
            readStableFileBytes(handle, path, STATE_INTAKE_LIMIT_BYTES, {
              symlinks: "follow",
            }),
        ),
      ),
    );
  } catch (cause: unknown) {
    if (cause instanceof RegularFileCleanupFailure) return err(CLOSE_FAILED);
    if (cause instanceof ArtifactResourceRetryFailure) return err(STILL_OPEN);
    return err(
      cause instanceof RegularFileCapacityError
        ? TOO_LARGE
        : unreadable(fileFailure(cause)),
    );
  }
};

/** Settles only by rejecting when the signal aborts; the rejection is always handled. */
const abortion = (signal: AbortSignal): Promise<never> => {
  const aborted = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
  });
  aborted.catch(() => undefined);
  return aborted;
};

/** What ends a download: its time limit or the caller's cancellation; `failure` names which, or a network failure when neither did. */
interface DownloadBounds {
  readonly signal: AbortSignal;
  readonly failure: () => IntakeFailure;
}

const downloadBounds = (
  timeoutMs: number,
  cancel: AbortSignal,
): DownloadBounds => {
  const timeout = AbortSignal.timeout(timeoutMs);
  return {
    signal: AbortSignal.any([timeout, cancel]),
    failure: () =>
      cancel.aborted ? "cancelled" : timeout.aborted ? "timeout" : "network",
  };
};

/** Read a response body within the intake limit and the download's bounds, whether or not the fetcher ties the body to the signal. */
const readCapped = async (
  body: ReadableStream<Uint8Array> | null,
  bounds: DownloadBounds,
): Promise<Result<Buffer, RpcError>> => {
  if (body === null) return ok(Buffer.alloc(0));
  const reader = body.getReader();
  const aborted = abortion(bounds.signal);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) return ok(Buffer.concat(chunks, total));
      total += value.byteLength;
      if (total > STATE_INTAKE_LIMIT_BYTES) {
        await reader.cancel().catch(() => undefined);
        return err(TOO_LARGE);
      }
      chunks.push(value);
    }
  } catch {
    void reader.cancel().catch(() => undefined);
    return err(fetchFailed(bounds.failure()));
  }
};

/** Download one https document within the time and size limits, ending it when `cancel` aborts. */
const downloadState = async (
  url: URL,
  intake: StateIntake,
  cancel: AbortSignal,
): Promise<Result<Buffer, RpcError>> => {
  const bounds = downloadBounds(intake.timeoutMs, cancel);
  const fetching = Promise.resolve().then(() =>
    intake.fetchState(url, bounds.signal),
  );
  let response: Response;
  try {
    response = await Promise.race([fetching, abortion(bounds.signal)]);
  } catch {
    // A response that arrives after the download ended is released unread.
    void fetching
      .then(
        (late) => late.body?.cancel(),
        () => undefined,
      )
      .catch(() => undefined);
    return err(fetchFailed(bounds.failure()));
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (!response.ok || declared > STATE_INTAKE_LIMIT_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return err(
      response.ok
        ? TOO_LARGE
        : {
            ...fetchFailed("http-status"),
            message: `the state document download answered HTTP ${String(response.status)}`,
          },
    );
  }
  return readCapped(response.body, bounds);
};

const NETWORK_SHARE = invalidParams(
  "a file:// uri names a path on this host, not a network share",
);

/** A path that names a host before its first segment, as `\\server\share` or `//server/share` does. */
const UNC_PATH = /^[\\/]{2}/u;

/** The local path a `file://` uri names; another host or a UNC path would open a network share, so neither is opened. */
const localFilePath = (url: URL): Result<string, RpcError> => {
  if (url.host !== "" && url.host !== "localhost") return err(NETWORK_SHARE);
  if (UNC_PATH.test(url.pathname)) return err(NETWORK_SHARE);
  let path: string;
  try {
    path = fileURLToPath(url);
  } catch {
    return err(invalidParams("a file:// uri names a local absolute path"));
  }
  return UNC_PATH.test(path) ? err(NETWORK_SHARE) : ok(path);
};

/** The bytes a file part carries inline or names by a `file://` or `https://` uri; `cancel` ends a download. */
const fileBytes = async (
  file: Readonly<Record<string, unknown>>,
  intake: StateIntake,
  cancel: AbortSignal,
  files: ArtifactResourceScope,
): Promise<Result<Uint8Array, RpcError>> => {
  if (typeof file.bytes === "string" && file.uri === undefined) {
    if (file.bytes.length > MAX_INLINE_BASE64_CHARACTERS) return err(TOO_LARGE);
    const byteLength = paddedBase64ByteLength(file.bytes);
    if (byteLength === undefined)
      return err(invalidParams("the file part's bytes are not base64"));
    if (byteLength > STATE_INTAKE_LIMIT_BYTES) return err(TOO_LARGE);
    return ok(Buffer.from(file.bytes, "base64"));
  }
  if (
    typeof file.uri !== "string" ||
    file.bytes !== undefined ||
    !URL.canParse(file.uri)
  )
    return err(
      invalidParams("a file part carries exactly one of bytes or a uri"),
    );
  const url = new URL(file.uri);
  if (url.protocol === "https:") return downloadState(url, intake, cancel);
  if (url.protocol !== "file:")
    return err(invalidParams("a file uri is a file:// or https:// URL"));
  const path = localFilePath(url);
  return path.ok ? readStateFile(path.value, files) : path;
};

/** The state document one `data/add` part carries, parsed but not yet validated; `cancel` ends a download and `files` owns file descriptors whose close failed. */
export const partDocument = async (
  part: unknown,
  intake: StateIntake,
  cancel: AbortSignal,
  files: ArtifactResourceScope,
): Promise<Result<unknown, RpcError>> => {
  if (isRecord(part) && part.kind === "data" && isRecord(part.data))
    return ok(part.data);
  if (!isRecord(part) || part.kind !== "file" || !isRecord(part.file))
    return err(
      invalidParams(
        "a data/add part is a data part holding the document or a file part carrying it",
      ),
    );
  const { mimeType } = part.file;
  if (
    mimeType !== undefined &&
    (typeof mimeType !== "string" ||
      mediaTypeEssence(mimeType) !== "application/json")
  )
    return err(invalidParams("a file part's mimeType is application/json"));
  const bytes = await fileBytes(part.file, intake, cancel, files);
  return bytes.ok ? parseDocumentBytes(bytes.value) : bytes;
};
