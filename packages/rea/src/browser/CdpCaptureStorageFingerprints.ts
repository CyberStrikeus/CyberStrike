import { createHash } from "node:crypto";

import canonicalize from "canonicalize";

import type { InspectWebPageInput } from "../domain/browserObservation.js";
import type { WebPageInspection } from "../domain/browserObservationSchemas.js";
import { decodePaddedBase64 } from "../domain/paddedBase64.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";
import { CdpConnection } from "./CdpConnection.js";
import { optionalCdpCommand } from "./CdpOptionalCommand.js";
import {
  recordValue,
  recordsValue,
  cdpStringValue,
} from "./CdpCaptureValues.js";

type StorageFingerprint =
  WebPageInspection["storage"]["content_fingerprints"][number];

export interface CapturedStorageItems {
  readonly items: readonly {
    readonly key: string;
    readonly value: string;
  }[];
  readonly complete: boolean;
}

export interface CapturedCache {
  readonly name: string;
  readonly id: string;
}

interface StorageFingerprintContext {
  readonly connection: CdpConnection;
  readonly sessionId: string | undefined;
  readonly input: InspectWebPageInput;
  readonly signal?: AbortSignal;
}

interface FingerprintState {
  readonly items: StorageFingerprint[];
  complete: boolean;
}

interface FingerprintRun {
  readonly context: StorageFingerprintContext;
  readonly limitations: string[];
  readonly state: FingerprintState;
}

interface CaptureStorageFingerprintInput {
  readonly context: StorageFingerprintContext;
  readonly origin: string;
  readonly cookieUrl: string;
  readonly local: CapturedStorageItems;
  readonly session: CapturedStorageItems;
  readonly indexedDbNames: readonly string[];
  readonly caches: readonly CapturedCache[];
  readonly limitations: string[];
}

type StorageFingerprintCapture = {
  readonly items: readonly StorageFingerprint[];
  readonly complete: boolean;
};

/** Capture stable hashes of approved storage content without returning values. */
export const captureStorageFingerprints = async ({
  context,
  origin,
  cookieUrl,
  local,
  session,
  indexedDbNames,
  caches,
  limitations,
}: CaptureStorageFingerprintInput): Promise<StorageFingerprintCapture> => {
  const state: FingerprintState = {
    items: [],
    complete: local.complete && session.complete,
  };
  const run = { context, limitations, state };
  addStorageItems(state, "local_storage", local.items);
  addStorageItems(state, "session_storage", session.items);
  await addCookies(run, cookieUrl);
  await addIndexedDb(run, origin, indexedDbNames);
  await addCaches(run, caches);
  state.items.sort((left, right) =>
    compareUnicodeCodePoints(
      `${left.scope}:${left.identity_sha256}`,
      `${right.scope}:${right.identity_sha256}`,
    ),
  );
  const complete =
    state.complete && state.items.every(({ complete }) => complete);
  return { items: state.items, complete };
};

const addStorageItems = (
  state: FingerprintState,
  scope: "local_storage" | "session_storage",
  items: CapturedStorageItems["items"],
): void => {
  for (const item of items)
    addFingerprint(state, {
      scope,
      identity: item.key,
      value: item.value,
      complete: true,
    });
};

const addCookies = async (
  run: FingerprintRun,
  pageUrl: string,
): Promise<void> => {
  run.limitations.push(
    "Cookie fingerprints cover cookies applicable to the current main-frame URL, not every path on its origin.",
  );
  const raw = await optionalCdpCommand(
    run.context,
    "Network.getCookies",
    { urls: [pageUrl] },
    run.limitations,
  );
  if (raw === undefined) {
    run.state.complete = false;
    return;
  }
  const cookieValues = recordValue(raw)?.cookies;
  if (!Array.isArray(cookieValues)) {
    run.state.complete = false;
    return;
  }
  const cookies = recordsValue(cookieValues);
  if (cookies.length !== cookieValues.length) run.state.complete = false;
  for (const cookie of cookies) {
    const name = cdpStringValue(cookie.name);
    const value = cdpStringValue(cookie.value);
    const domain = cdpStringValue(cookie.domain);
    const path = cdpStringValue(cookie.path);
    if (
      name === undefined ||
      value === undefined ||
      domain === undefined ||
      path === undefined
    ) {
      run.state.complete = false;
      continue;
    }
    // CDP Cookie.partitionKeyOpaque means the partition exists but is not
    // serializable. A missing partitionKey means unpartitioned, so hashing
    // that absence would align an unresolved partition with a different cookie.
    // https://chromedevtools.github.io/devtools-protocol/tot/Network/#type-Cookie
    const partitionOpaque = cookie.partitionKeyOpaque === true;
    addFingerprint(run.state, {
      scope: "cookie",
      identity: {
        domain,
        path,
        name,
        partition_key: cookie.partitionKey ?? null,
        ...(partitionOpaque ? { partition_opaque: true } : {}),
      },
      value,
      complete: !partitionOpaque,
    });
  }
};

const addIndexedDb = async (
  run: FingerprintRun,
  origin: string,
  names: readonly string[],
): Promise<void> => {
  for (const databaseName of names) {
    const raw = await optionalCdpCommand(
      run.context,
      "IndexedDB.requestDatabase",
      { securityOrigin: origin, databaseName },
      run.limitations,
    );
    const database = recordValue(recordValue(raw)?.databaseWithObjectStores);
    if (raw === undefined || database === undefined) {
      run.state.complete = false;
      continue;
    }
    if (cdpStringValue(database.name) !== databaseName) {
      run.state.complete = false;
      continue;
    }
    if (!Array.isArray(database.objectStores)) {
      run.state.complete = false;
      continue;
    }
    const stores = recordsValue(database.objectStores);
    if (stores.length !== database.objectStores.length)
      run.state.complete = false;
    const version =
      typeof database.version === "number" &&
      Number.isSafeInteger(database.version) &&
      database.version >= 0
        ? database.version
        : undefined;
    if (version === undefined) {
      const limitation =
        "An IndexedDB schema fingerprint is incomplete because its database version is unavailable, invalid, or outside exact integer precision.";
      if (!run.limitations.includes(limitation))
        run.limitations.push(limitation);
    }
    addFingerprint(run.state, {
      scope: "indexed_db_schema",
      identity: databaseName,
      value: {
        version: version ?? null,
        object_stores: stores.map(indexedDbStoreSchema),
      },
      projectionVersion: 2,
      complete:
        version !== undefined &&
        stores.length === database.objectStores.length &&
        indexedDbSchemaComplete(stores),
    });
    for (const store of stores) {
      const objectStoreName = cdpStringValue(store.name);
      if (objectStoreName === undefined) {
        run.state.complete = false;
        continue;
      }
      await addIndexedDbRecords(run, {
        origin,
        databaseName,
        objectStoreName,
      });
    }
  }
};

const indexedDbStoreSchema = (store: Readonly<Record<string, unknown>>) => ({
  name: cdpStringValue(store.name) ?? null,
  key_path: stableValue(store.keyPath),
  auto_increment: store.autoIncrement === true,
  indexes: recordsValue(store.indexes).map((index) => ({
    name: cdpStringValue(index.name) ?? null,
    key_path: stableValue(index.keyPath),
    unique: index.unique === true,
    multi_entry: index.multiEntry === true,
  })),
});

const indexedDbSchemaComplete = (
  stores: readonly Readonly<Record<string, unknown>>[],
): boolean =>
  stores.every(
    (store) =>
      cdpStringValue(store.name) !== undefined &&
      indexedDbKeyPathComplete(store.keyPath) &&
      typeof store.autoIncrement === "boolean" &&
      Array.isArray(store.indexes) &&
      recordsValue(store.indexes).length === store.indexes.length &&
      recordsValue(store.indexes).every(
        (index) =>
          cdpStringValue(index.name) !== undefined &&
          indexedDbKeyPathComplete(index.keyPath) &&
          typeof index.unique === "boolean" &&
          typeof index.multiEntry === "boolean",
      ),
  );

const indexedDbKeyPathComplete = (value: unknown): boolean => {
  const keyPath = recordValue(value);
  if (keyPath === undefined) return false;
  switch (keyPath.type) {
    case "null":
      return true;
    case "string":
      return typeof keyPath.string === "string";
    case "array":
      return (
        Array.isArray(keyPath.array) &&
        keyPath.array.every((key) => typeof key === "string")
      );
    default:
      return false;
  }
};

const addIndexedDbRecords = async (
  run: FingerprintRun,
  input: {
    readonly origin: string;
    readonly databaseName: string;
    readonly objectStoreName: string;
  },
): Promise<void> => {
  let skipCount = 0;
  while (true) {
    const raw = await optionalCdpCommand(
      run.context,
      "IndexedDB.requestData",
      {
        securityOrigin: input.origin,
        databaseName: input.databaseName,
        objectStoreName: input.objectStoreName,
        skipCount,
        pageSize: STORAGE_ENTRY_PAGE_SIZE,
      },
      run.limitations,
    );
    const result = recordValue(raw);
    if (raw === undefined || result === undefined) {
      run.state.complete = false;
      return;
    }
    if (
      !Array.isArray(result.objectStoreDataEntries) ||
      typeof result.hasMore !== "boolean"
    ) {
      run.state.complete = false;
      return;
    }
    const examinedCount = result.objectStoreDataEntries.length;
    const entries = recordsValue(result.objectStoreDataEntries);
    if (entries.length !== result.objectStoreDataEntries.length)
      run.state.complete = false;
    for (const entry of entries) {
      const key = decodeRemoteObject(entry.key);
      const primaryKey = decodeRemoteObject(entry.primaryKey);
      const value = decodeRemoteObject(entry.value);
      addFingerprint(run.state, {
        scope: "indexed_db_record",
        identity: {
          database: input.databaseName,
          store: input.objectStoreName,
          key,
          primaryKey,
        },
        value,
        complete:
          key !== undefined && primaryKey !== undefined && value !== undefined,
      });
    }
    if (result.hasMore !== true) return;
    if (
      examinedCount === 0 ||
      skipCount > Number.MAX_SAFE_INTEGER - examinedCount
    ) {
      run.state.complete = false;
      return;
    }
    skipCount += examinedCount;
  }
};

const addCaches = async (
  run: FingerprintRun,
  caches: readonly CapturedCache[],
): Promise<void> => {
  for (const cache of caches) {
    let skipCount = 0;
    let returnCount: number | undefined;
    while (returnCount === undefined || skipCount < returnCount) {
      const raw = await optionalCdpCommand(
        run.context,
        "CacheStorage.requestEntries",
        { cacheId: cache.id, skipCount, pageSize: STORAGE_ENTRY_PAGE_SIZE },
        run.limitations,
      );
      const result = recordValue(raw);
      if (raw === undefined || result === undefined) {
        run.state.complete = false;
        break;
      }
      if (
        !Array.isArray(result.cacheDataEntries) ||
        typeof result.returnCount !== "number" ||
        !Number.isSafeInteger(result.returnCount) ||
        result.returnCount < 0
      ) {
        run.state.complete = false;
        break;
      }
      const examinedCount = result.cacheDataEntries.length;
      const entries = recordsValue(result.cacheDataEntries);
      if (entries.length !== result.cacheDataEntries.length)
        run.state.complete = false;
      for (const entry of entries) await addCacheEntry(run, cache, entry);
      returnCount = result.returnCount;
      if (skipCount + examinedCount >= returnCount) break;
      if (
        examinedCount === 0 ||
        skipCount > Number.MAX_SAFE_INTEGER - examinedCount
      ) {
        run.state.complete = false;
        break;
      }
      skipCount += examinedCount;
    }
  }
};

const addCacheEntry = async (
  run: FingerprintRun,
  cache: CapturedCache,
  entry: Readonly<Record<string, unknown>>,
): Promise<void> => {
  const requestURL = cdpStringValue(entry.requestURL);
  const requestMethod = cdpStringValue(entry.requestMethod);
  if (requestURL === undefined || requestMethod === undefined) {
    run.state.complete = false;
    return;
  }
  if (!Array.isArray(entry.requestHeaders)) {
    run.state.complete = false;
    return;
  }
  const headerRecords = recordsValue(entry.requestHeaders);
  const requestHeaders = headerRecords.flatMap((header) => {
    const name = cdpStringValue(header.name);
    const value = cdpStringValue(header.value);
    return name === undefined || value === undefined ? [] : [{ name, value }];
  });
  if (
    headerRecords.length !== entry.requestHeaders.length ||
    requestHeaders.length !== headerRecords.length
  ) {
    run.state.complete = false;
    return;
  }
  const raw = await optionalCdpCommand(
    run.context,
    "CacheStorage.requestCachedResponse",
    { cacheId: cache.id, requestURL, requestHeaders },
    run.limitations,
  );
  const body = cdpStringValue(recordValue(recordValue(raw)?.response)?.body);
  const decoded = body === undefined ? undefined : decodePaddedBase64(body);
  const complete = decoded !== undefined;
  if (!complete) run.state.complete = false;
  addFingerprint(run.state, {
    scope: "cache_entry",
    identity: { cache: cache.name, requestURL, requestMethod, requestHeaders },
    value: decoded,
    complete,
  });
};

const addFingerprint = (
  state: FingerprintState,
  input: {
    readonly scope: StorageFingerprint["scope"];
    readonly identity: unknown;
    readonly value: unknown;
    readonly complete: boolean;
    readonly projectionVersion?: 2;
  },
): void => {
  state.items.push({
    scope: input.scope,
    identity_sha256: digest(input.identity),
    value_sha256: input.value === undefined ? null : digest(input.value),
    ...(input.projectionVersion === undefined
      ? {}
      : { projection_version: input.projectionVersion }),
    complete:
      input.complete &&
      stableValueComplete(input.identity) &&
      stableValueComplete(input.value),
  });
};

const STORAGE_ENTRY_PAGE_SIZE = 1_000;

const digest = (value: unknown): string =>
  createHash("sha256").update(encodedValue(value)).digest("hex");

const encodedValue = (value: unknown): Uint8Array | string => {
  if (value instanceof Uint8Array) return value;
  const encoded = canonicalize(stableValue(value));
  if (encoded === undefined) throw new TypeError("Expected canonical JSON");
  return encoded;
};

const stableValue = (value: unknown): unknown => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (Array.isArray(value)) return value.map((item) => stableValue(item));
  const record = recordValue(value);
  if (record === undefined) return String(value);
  return Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => compareUnicodeCodePoints(left, right))
      .map(([key, item]) => [key, stableValue(item)]),
  );
};

const stableValueComplete = (value: unknown): boolean => {
  if (value instanceof Uint8Array) return true;
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return true;
  if (Array.isArray(value))
    return value.every((item) => stableValueComplete(item));
  const record = recordValue(value);
  if (record === undefined) return false;
  const entries = Object.entries(record);
  return entries.every(([, item]) => stableValueComplete(item));
};

/** Decode CDP value evidence once; debugger labels/references are not content.
 * https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#type-RemoteObject
 */
const decodeRemoteObject = (value: unknown): unknown => {
  const record = recordValue(value);
  if (record === undefined) return undefined;
  const { type, unserializableValue } = record;
  const serialized = record.value;
  const primitive = (valid: boolean): unknown =>
    valid ? { type, value: serialized } : undefined;
  switch (type) {
    case "undefined":
      return serialized === undefined && unserializableValue === undefined
        ? { type }
        : undefined;
    case "string":
    case "boolean":
      return primitive(
        typeof serialized === type && unserializableValue === undefined,
      );
    case "number":
      if (unserializableValue === undefined)
        return primitive(
          typeof serialized === "number" && Number.isFinite(serialized),
        );
      return serialized === undefined &&
        typeof unserializableValue === "string" &&
        ["-0", "NaN", "Infinity", "-Infinity"].includes(unserializableValue)
        ? { type, unserializableValue }
        : undefined;
    case "bigint":
      return serialized === undefined &&
        typeof unserializableValue === "string" &&
        /^-?\d+n$/u.test(unserializableValue)
        ? { type, unserializableValue }
        : undefined;
    case "object":
      return primitive(
        unserializableValue === undefined &&
          (record.subtype === "null"
            ? serialized === null
            : serialized !== null &&
              typeof serialized === "object" &&
              stableValueComplete(serialized)),
      );
    default:
      return undefined;
  }
};
