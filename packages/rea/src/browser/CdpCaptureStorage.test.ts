import { expect, it } from "vitest";

import { inspectWebPageInputSchema } from "../domain/browserObservation.js";
import type { WebPageInspection } from "../domain/browserObservationSchemas.js";
import {
  browserCaptureComparisonInputSchema,
  compareBrowserCaptures,
} from "../domain/browserCaptureComparison.js";
import { webCaptureDiffSchema } from "../domain/webCaptureDiffSchemas.js";
import { passiveNetworkCapture } from "../../tests/fixtures/passiveNetworkCapture.js";
import { captureStorage } from "./CdpCaptureStorage.js";
import { CdpCommandRejection } from "./CdpCommandRejection.js";
import type { CdpConnection } from "./CdpConnection.js";

const NO_CACHE_COMMAND = Symbol("unsupported");

const captureWithCacheResult = async (
  cacheResult: unknown,
): Promise<Awaited<ReturnType<typeof captureStorage>>["value"]> => {
  const connection = {
    send(method: string): Promise<unknown> {
      switch (method) {
        case "Storage.getUsageAndQuota":
          return Promise.resolve({ usage: 1, quota: 10 });
        case "DOMStorage.getDOMStorageItems":
          return Promise.resolve({ entries: [] });
        case "IndexedDB.requestDatabaseNames":
          return Promise.resolve({ databaseNames: [] });
        case "Network.getCookies":
          return Promise.resolve({ cookies: [] });
        case "CacheStorage.requestCacheNames":
          return cacheResult === NO_CACHE_COMMAND
            ? Promise.reject(
                new CdpCommandRejection(
                  "inspect_web_page",
                  method,
                  -32601,
                  "Method not found",
                ),
              )
            : Promise.resolve(cacheResult);
        case "CacheStorage.requestEntries":
          return Promise.resolve({ cacheDataEntries: [], returnCount: 0 });
        default:
          return Promise.reject(new Error(`Unexpected command: ${method}`));
      }
    },
  } as unknown as CdpConnection;
  const { value } = await captureStorage(
    {
      connection,
      sessionId: undefined,
      input: inspectWebPageInputSchema.parse({
        cdp_endpoint: "http://127.0.0.1:9222",
        target_id: "fixture-page",
        include_storage_keys: true,
        include_storage_fingerprints: true,
      }),
    },
    "https://example.test/",
    [],
  );
  return value;
};

it.each([
  ["an observed empty cache list", { caches: [] }, true],
  ["a response without a cache list", {}, false],
  ["a non-array cache list", { caches: "nope" }, false],
  ["a cache list with an unusable entry", { caches: [5] }, false],
  ["an unsupported cache command", NO_CACHE_COMMAND, false],
] as const)(
  "reports fingerprint completeness for %s",
  async (_label, cacheResult, complete) => {
    const value = await captureWithCacheResult(cacheResult);
    expect(value.cache_names).toEqual([]);
    expect(value.fingerprints_complete).toBe(complete);
  },
);

it.each([false, true])(
  "preserves valid cache evidence beside an unusable entry: %s",
  async (mixed) => {
    const cache = { cacheName: "fixture-cache", cacheId: "fixture-cache-id" };
    const value = await captureWithCacheResult({
      caches: mixed ? [cache, 5] : [cache],
    });
    expect(value.cache_names).toEqual(["fixture-cache"]);
    expect(value.fingerprints_complete).toBe(!mixed);
  },
);

it("keeps an omitted IndexedDB remote value unknown", async () => {
  const replies: Record<string, unknown> = {
    "Storage.getUsageAndQuota": { usage: 0, quota: 1000 },
    "DOMStorage.getDOMStorageItems": { entries: [] },
    "IndexedDB.requestDatabaseNames": { databaseNames: ["db"] },
    "CacheStorage.requestCacheNames": { caches: [] },
    "Network.getCookies": { cookies: [] },
    "IndexedDB.requestDatabase": {
      databaseWithObjectStores: {
        name: "db",
        objectStores: [
          {
            name: "records",
            keyPath: { type: "string", string: "id" },
            autoIncrement: false,
            indexes: [],
          },
        ],
      },
    },
    "IndexedDB.requestData": {
      objectStoreDataEntries: [
        {
          key: { type: "number", value: 1 },
          primaryKey: { type: "number", value: 1 },
        },
      ],
      hasMore: false,
    },
  };
  const connection = {
    async send(method: string): Promise<unknown> {
      if (!(method in replies)) throw new Error(method);
      return replies[method];
    },
  } as unknown as CdpConnection;
  const { value } = await captureStorage(
    {
      connection,
      sessionId: undefined,
      input: inspectWebPageInputSchema.parse({
        cdp_endpoint: "http://127.0.0.1:9222",
        allowed_origins: ["https://example.test"],
        target_id: "page-1",
        include_storage_keys: true,
        include_storage_fingerprints: true,
      }),
    },
    "https://example.test/app",
    [],
  );
  const record = value.content_fingerprints.find(
    (item) => item.scope === "indexed_db_record",
  );
  expect(record).toMatchObject({ value_sha256: null, complete: false });
  expect(value.fingerprints_complete).toBe(false);
});

it.each(["indexed_db", "cache"] as const)(
  "advances %s pagination past malformed rows without repeating evidence",
  async (scope) => {
    const offsets: unknown[] = [];
    const record = {
      key: { type: "number", value: 1 },
      primaryKey: { type: "number", value: 1 },
      value: { type: "string", value: "first" },
    };
    const cacheEntry = {
      requestURL: "https://example.test/first",
      requestMethod: "GET",
      requestHeaders: [],
    };
    const replies: Record<string, unknown> = {
      "Storage.getUsageAndQuota": { usage: 0, quota: 1000 },
      "DOMStorage.getDOMStorageItems": { entries: [] },
      "IndexedDB.requestDatabaseNames": {
        databaseNames: scope === "indexed_db" ? ["db"] : [],
      },
      "CacheStorage.requestCacheNames": {
        caches:
          scope === "cache" ? [{ cacheName: "cache", cacheId: "id" }] : [],
      },
      "Network.getCookies": { cookies: [] },
      "IndexedDB.requestDatabase": {
        databaseWithObjectStores: {
          name: "db",
          version: 1,
          objectStores: [
            {
              name: "records",
              keyPath: { type: "string", string: "id" },
              autoIncrement: false,
              indexes: [],
            },
          ],
        },
      },
      "CacheStorage.requestCachedResponse": { response: { body: "" } },
    };
    const connection = {
      async send(
        method: string,
        params: Record<string, unknown>,
      ): Promise<unknown> {
        if (
          method === "IndexedDB.requestData" ||
          method === "CacheStorage.requestEntries"
        ) {
          offsets.push(params.skipCount);
          // The first page includes a malformed row; offset 1 repeats valid evidence.
          const rows =
            params.skipCount === 0
              ? [null, scope === "indexed_db" ? record : cacheEntry]
              : params.skipCount === 1
                ? [scope === "indexed_db" ? record : cacheEntry]
                : [
                    scope === "indexed_db"
                      ? {
                          ...record,
                          key: { type: "number", value: 2 },
                          primaryKey: { type: "number", value: 2 },
                        }
                      : {
                          ...cacheEntry,
                          requestURL: "https://example.test/second",
                        },
                  ];
          return method === "IndexedDB.requestData"
            ? { objectStoreDataEntries: rows, hasMore: params.skipCount === 0 }
            : { cacheDataEntries: rows, returnCount: 3 };
        }
        if (!(method in replies)) throw new Error(method);
        return replies[method];
      },
    } as unknown as CdpConnection;
    const { value } = await captureStorage(
      {
        connection,
        sessionId: undefined,
        input: inspectWebPageInputSchema.parse({
          cdp_endpoint: "http://127.0.0.1:9222",
          target_id: "page",
          include_storage_keys: true,
          include_storage_fingerprints: true,
        }),
      },
      "https://example.test/",
      [],
    );
    expect(offsets).toEqual([0, 2]);
    expect(
      value.content_fingerprints.filter(
        (item) =>
          item.scope ===
          (scope === "indexed_db" ? "indexed_db_record" : "cache_entry"),
      ),
    ).toHaveLength(2);
    expect(value.fingerprints_complete).toBe(false);
  },
);

const cookieBase = {
  name: "fixture",
  value: "same",
  domain: "example.test",
  path: "/",
  expires: -1,
  size: 11,
  httpOnly: false,
  secure: false,
  session: true,
  sameSite: "Lax",
};

const captureCookies = async (
  cookies: readonly Record<string, unknown>[],
): Promise<WebPageInspection["storage"]> => {
  const replies: Record<string, unknown> = {
    "Storage.getUsageAndQuota": { usage: 0, quota: 1000 },
    "DOMStorage.getDOMStorageItems": { entries: [] },
    "IndexedDB.requestDatabaseNames": { databaseNames: [] },
    "CacheStorage.requestCacheNames": { caches: [] },
    "Network.getCookies": { cookies },
  };
  const connection = {
    async send(method: string): Promise<unknown> {
      if (!(method in replies)) throw new Error(method);
      return replies[method];
    },
  } as unknown as CdpConnection;
  const { value } = await captureStorage(
    {
      connection,
      sessionId: undefined,
      input: inspectWebPageInputSchema.parse({
        cdp_endpoint: "http://127.0.0.1:9222",
        target_id: "fixture-page",
        include_storage_keys: true,
        include_storage_fingerprints: true,
      }),
    },
    "https://example.test/",
    [],
  );
  return value;
};

const storageComparison = (
  before: WebPageInspection["storage"],
  after: WebPageInspection["storage"],
) => {
  const inspection = (storage: WebPageInspection["storage"]) => {
    const capture = passiveNetworkCapture();
    capture.storage = storage;
    return capture;
  };
  return webCaptureDiffSchema.parse(
    compareBrowserCaptures(
      browserCaptureComparisonInputSchema.parse({
        before: { inspection: inspection(before) },
        after: { inspection: inspection(after) },
      }),
    ),
  ).dimensions.storage;
};

it("keeps an opaque cookie partition unknown without dropping its value", async () => {
  const plain = await captureCookies([cookieBase]);
  const opaque = await captureCookies([
    { ...cookieBase, partitionKeyOpaque: true },
  ]);
  const known = await captureCookies([
    {
      ...cookieBase,
      partitionKey: {
        topLevelSite: "https://top.example.test",
        hasCrossSiteAncestor: false,
      },
      partitionKeyOpaque: false,
    },
  ]);
  const cookieFingerprint = (storage: WebPageInspection["storage"]) => {
    const fingerprint = storage.content_fingerprints.find(
      (item) => item.scope === "cookie",
    );
    expect(fingerprint).toBeDefined();
    return fingerprint!;
  };
  const plainCookie = cookieFingerprint(plain);
  const opaqueCookie = cookieFingerprint(opaque);
  const knownCookie = cookieFingerprint(known);
  expect(opaque.fingerprints_complete).toBe(false);
  expect(opaqueCookie).toMatchObject({
    complete: false,
    value_sha256: plainCookie.value_sha256,
  });
  expect(opaqueCookie.identity_sha256).not.toBe(plainCookie.identity_sha256);
  expect(known.fingerprints_complete).toBe(true);
  expect(knownCookie).toMatchObject({ complete: true });
  expect(knownCookie.identity_sha256).not.toBe(plainCookie.identity_sha256);
  expect(storageComparison(plain, opaque)).toMatchObject({
    status: "unknown",
    total_changes: 0,
    changes: [],
  });
  expect(storageComparison(opaque, opaque)).toMatchObject({
    status: "unknown",
    total_changes: 0,
    changes: [],
  });
  expect(storageComparison(plain, known).status).toBe("changed");
});
