import type { FakeCdpCommand, FakeOptions } from "./fakeCdpBrowserTypes.js";
import { targets } from "./fakeCdpBrowserTargets.js";

export const resultFor = (
  command: FakeCdpCommand,
  port: number,
  options: FakeOptions,
  frameTreeReads: number,
): Readonly<Record<string, unknown>> | undefined => {
  switch (command.method) {
    case "Target.attachToTarget":
      return attachToTargetResult(options);
    case "Page.getLayoutMetrics":
      return {
        cssVisualViewport: {
          pageX: 0,
          pageY: 0,
          clientWidth: 1,
          clientHeight: 1,
          scale: 1,
        },
        visualViewport: {
          pageX: 0,
          pageY: 0,
          clientWidth: 1,
          clientHeight: 1,
          scale: 1,
        },
      };
    case "Page.getFrameTree":
      return frameTreeResult(port, options, frameTreeReads);
    case "Page.getResourceTree":
      return resourceTreeResult(port, options);
    case "DOMSnapshot.captureSnapshot":
      return domSnapshotResult(port, options);
    case "Accessibility.getFullAXTree":
      return accessibilityTreeResult(options);
    case "Debugger.getScriptSource":
      return scriptSourceResult();
    case "Network.getResponseBody":
      return responseBodyResult(options);
    case "Page.captureScreenshot":
      return screenshotResult();
    case "Browser.getVersion":
      return browserVersionResult();
    case "Target.getTargets":
      return { targetInfos: targets(port, options).map(endpointTargetToInfo) };
    case "Storage.getUsageAndQuota":
      return storageUsageResult();
    case "DOMStorage.getDOMStorageItems":
      return domStorageResult(options);
    case "Network.getCookies":
      return cookieStorageResult();
    case "IndexedDB.requestDatabaseNames":
      return indexedDbResult(options);
    case "IndexedDB.requestDatabase":
      return indexedDbDatabaseResult(command);
    case "IndexedDB.requestData":
      return indexedDbDataResult(options);
    case "CacheStorage.requestCacheNames":
      return cacheStorageResult(options);
    case "CacheStorage.requestEntries":
      return cacheEntriesResult(port);
    case "CacheStorage.requestCachedResponse":
      return cachedResponseResult(options);
    case "Page.enable":
    case "Page.disable":
    case "Page.setLifecycleEventsEnabled":
    case "Performance.enable":
    case "Performance.disable":
    case "Network.enable":
    case "Network.disable":
    case "Debugger.disable":
    case "Runtime.enable":
    case "Runtime.disable":
    case "Runtime.releaseObjectGroup":
    case "DOM.enable":
    case "DOM.disable":
      return {};
    case "Performance.getMetrics":
      return { metrics: [{ name: "Timestamp", value: 0 }] };
    case "Debugger.enable":
      return { debuggerId: "fake-debugger" };
    case "Target.detachFromTarget":
    case "WebMCP.enable":
      return {};
    default:
      return undefined;
  }
};

/** Chrome's browser-socket reply shape, mirroring the fake's `/json/version`. */
const browserVersionResult = () => ({
  protocolVersion: "1.3",
  product: "FakeChrome/1.0",
  revision: "@fake-revision",
  userAgent: "FakeChrome",
  jsVersion: "13.0",
});

const attachToTargetResult = (options: FakeOptions) => ({
  sessionId: options.invalidAttachedSession ? "" : "session-1",
});

const frameTreeResult = (
  port: number,
  options: FakeOptions,
  frameTreeReads: number,
) =>
  frameTree(
    port,
    frameTreeReads > 1 && options.frameUrlAfterFirstRead !== undefined
      ? options.frameUrlAfterFirstRead
      : frameTreeReads <= (options.transitionalFrameReads ?? 0)
        ? ":"
        : (options.electronFileUrl ?? options.attachedFrameUrl),
    options.extraCollections === true,
    options.webMcpSameUrlRegistrations === undefined
      ? options.webMcpFrameCount
      : "same-url",
  );

const resourceTreeResult = (port: number, options: FakeOptions) =>
  resourceTree(port, options);

const domSnapshotResult = (port: number, options: FakeOptions) =>
  domSnapshot(
    port,
    options.electronFileUrl,
    options.extraCollections === true,
    options.electronInventoryCount ?? 0,
  );

const accessibilityTreeResult = (options: FakeOptions) =>
  accessibilityTree(options.extraCollections === true);

const scriptSourceResult = () => ({
  scriptSource: "export const observed = 'source-secret';",
});

const responseBodyResult = (options: FakeOptions) =>
  options.invalidResponseBodyBase64 === true
    ? { body: "%%%not-base64%%%", base64Encoded: true }
    : {
        body: JSON.stringify({
          result: { ok: true, token: "response-body-secret" },
          items: [{ id: 1 }, { id: 2 }],
        }),
        base64Encoded: false,
      };

const screenshotResult = () => ({
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
});

const storageUsageResult = () => ({
  usage: 42,
  quota: 1_024,
  usageBreakdown: [],
});

const domStorageResult = (options: FakeOptions) => ({
  entries:
    options.extraCollections === true
      ? [
          ["public-key", "storage-secret"],
          ["second-key", "second-secret"],
        ]
      : [["public-key", "storage-secret"]],
});

const cookieStorageResult = () => ({
  cookies: [
    {
      name: "session",
      value: "cookie-secret",
      domain: "127.0.0.1",
      path: "/",
      secure: false,
      httpOnly: true,
    },
  ],
});

const indexedDbResult = (options: FakeOptions) => ({
  databaseNames:
    options.extraCollections === true ? ["app-db", "second-db"] : ["app-db"],
});

const indexedDbDatabaseResult = (command: FakeCdpCommand) => ({
  databaseWithObjectStores: {
    name:
      typeof command.params.databaseName === "string"
        ? command.params.databaseName
        : "app-db",
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
});

const indexedDbDataResult = (options: FakeOptions) => ({
  objectStoreDataEntries: [
    {
      key: indexedDbKey(options),
      primaryKey: indexedDbKey(options),
      value: { type: "string", value: "indexed-db-secret" },
    },
  ],
  hasMore: false,
});

const indexedDbKey = (options: FakeOptions) =>
  options.indexedDbDateKeys === true
    ? {
        type: "object",
        subtype: "date",
        className: "Date",
        description: "Thu Jan 01 1970 00:00:00 GMT+0000",
        objectId: "owned-date-key",
        preview: {
          type: "object",
          subtype: "date",
          overflow: false,
          properties: [],
        },
      }
    : { type: "string", value: "row-1" };

const cacheStorageResult = (options: FakeOptions) => ({
  caches: [
    { cacheName: "assets-v1", cacheId: "secret-id" },
    ...(options.extraCollections === true
      ? [{ cacheName: "assets-v2", cacheId: "second-secret-id" }]
      : []),
  ],
});

const cacheEntriesResult = (port: number) => ({
  cacheDataEntries: [
    {
      requestURL: `http://127.0.0.1:${String(port)}/cached`,
      requestMethod: "GET",
      requestHeaders: [],
      responseTime: 1,
      responseStatus: 200,
      responseStatusText: "OK",
      responseType: "basic",
      responseHeaders: [],
    },
  ],
  returnCount: 1,
});

const cachedResponseResult = (options: FakeOptions) => ({
  response: {
    body: Buffer.from(
      options.cachedResponseBody ?? "cache-body-secret",
    ).toString("base64"),
  },
});

export const versionTargetId = (options: FakeOptions): string =>
  options.electronFileUrl === undefined ? "allowed-page" : "electron-page";

const endpointTargetToInfo = (
  target: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => ({
  targetId: target.id,
  type: target.type,
  title: target.title,
  url: target.url,
  attached: target.attached,
  ...(target.openerId === undefined ? {} : { openerId: target.openerId }),
  ...(target.parentFrameId === undefined
    ? {}
    : { parentFrameId: target.parentFrameId }),
});

const frameTree = (
  port: number,
  overrideUrl?: string,
  extraCollections = false,
  webMcpFrameCount: number | "same-url" = 0,
): Readonly<Record<string, unknown>> => ({
  frameTree: {
    frame: {
      id: "frame-main",
      loaderId: "loader-main",
      url:
        overrideUrl ??
        `http://127.0.0.1:${String(port)}/app?token=frame-secret`,
    },
    childFrames: [
      ...(extraCollections
        ? [
            {
              frame: {
                id: "frame-child",
                parentId: "frame-main",
                loaderId: "loader-child",
                url: `http://127.0.0.1:${String(port)}/child`,
              },
            },
          ]
        : []),
      ...Array.from(
        { length: webMcpFrameCount === "same-url" ? 2 : webMcpFrameCount },
        (_value, index) => ({
          frame: {
            id: `webmcp-frame-${String(index)}`,
            parentId: "frame-main",
            loaderId: `loader-webmcp-${String(index)}`,
            url: `http://127.0.0.1:${String(port)}/webmcp-frame/${webMcpFrameCount === "same-url" ? "shared" : String(index)}`,
          },
        }),
      ),
      {
        frame: {
          id: "frame-private",
          parentId: "frame-main",
          loaderId: "loader-private",
          url: "https://private.example.test/frame?secret=forbidden",
        },
      },
    ],
  },
});

const resourceTree = (
  port: number,
  options: FakeOptions = {},
): Readonly<Record<string, unknown>> => ({
  frameTree: {
    frame: {
      id: "frame-main",
      loaderId: "loader-main",
      url: options.electronFileUrl ?? `http://127.0.0.1:${String(port)}/app`,
    },
    resources: [
      {
        url:
          options.electronFileUrl === undefined
            ? `http://127.0.0.1:${String(port)}/app.js?token=script-secret`
            : new URL("app.js", options.electronFileUrl).href,
        type: "Script",
        mimeType: "text/javascript",
        contentSize: 128,
      },
      ...(options.duplicateElectronInventory === true
        ? [
            {
              url:
                options.electronFileUrl === undefined
                  ? `http://127.0.0.1:${String(port)}/app.js?token=script-secret`
                  : new URL("app.js", options.electronFileUrl).href,
              type: "Script",
              mimeType: "text/javascript",
              contentSize: 128,
            },
          ]
        : []),
      ...(options.extraCollections === true
        ? [
            {
              url: `http://127.0.0.1:${String(port)}/app.css`,
              type: "Stylesheet",
              mimeType: "text/css",
              contentSize: 64,
            },
          ]
        : []),
      ...Array.from(
        { length: options.electronInventoryCount ?? 0 },
        (_value, index) => ({
          url:
            options.electronFileUrl === undefined
              ? `http://127.0.0.1:${String(port)}/inventory-${String(index)}.js`
              : new URL(
                  `inventory-${String(index)}.js`,
                  options.electronFileUrl,
                ).href,
          type: "Script",
          mimeType: "text/javascript",
          contentSize: 128,
        }),
      ),
      {
        url: "https://private.example.test/private.js?secret=forbidden",
        type: "Script",
        mimeType: "text/javascript",
      },
    ],
  },
});

const domSnapshot = (
  port: number,
  electronFileUrl?: string,
  extraCollections = false,
  electronInventoryCount = 0,
): Readonly<Record<string, unknown>> => {
  const secondDocumentUrl =
    electronFileUrl !== undefined && extraCollections
      ? new URL("child.html", electronFileUrl).href
      : "https://private.example.test/frame";
  const strings = [
    electronFileUrl ?? `http://127.0.0.1:${String(port)}/app`,
    "#document",
    "",
    "LINK",
    "token",
    "dom-secret",
    secondDocumentUrl,
    "PRIVATE-TEXT",
    "href",
    "/agent?token=dom-url-secret",
    "rel",
    "mcp",
    "DIV",
    "child text",
  ];
  return {
    strings,
    documents: [
      {
        documentURL: 0,
        nodes: {
          nodeType: [
            9,
            1,
            ...Array.from({ length: electronInventoryCount }, () => 1),
          ],
          nodeName: [
            1,
            3,
            ...Array.from({ length: electronInventoryCount }, () => 3),
          ],
          nodeValue: [
            2,
            2,
            ...Array.from({ length: electronInventoryCount }, () => 2),
          ],
          parentIndex: [
            -1,
            0,
            ...Array.from({ length: electronInventoryCount }, () => 0),
          ],
          attributes: [
            [],
            [4, 5, 8, 9, 10, 11],
            ...Array.from({ length: electronInventoryCount }, () => []),
          ],
        },
      },
      {
        documentURL: 6,
        nodes:
          electronFileUrl !== undefined && extraCollections
            ? {
                nodeType: [9, 1],
                nodeName: [1, 12],
                nodeValue: [2, 13],
                parentIndex: [-1, 0],
                attributes: [[], []],
              }
            : {
                nodeType: [3],
                nodeName: [1],
                nodeValue: [7],
                parentIndex: [-1],
                attributes: [[]],
              },
      },
    ],
  };
};

const accessibilityTree = (
  extraCollections = false,
): Readonly<Record<string, unknown>> => ({
  nodes: [
    {
      nodeId: "ax-1",
      ignored: false,
      role: { type: "role", value: "button" },
      name: { type: "computedString", value: "Submit report" },
      description: { type: "computedString", value: "Sends the form" },
      childIds: extraCollections ? ["ax-2"] : [],
      properties: [
        {
          name: "disabled",
          value: { type: "boolean", value: false },
        },
        {
          name: "expanded",
          value: { type: "booleanOrUndefined", value: false },
        },
      ],
    },
    ...(extraCollections
      ? [
          {
            nodeId: "ax-2",
            parentId: "ax-1",
            ignored: false,
            role: { type: "role", value: "link" },
            name: { type: "computedString", value: "Second action" },
          },
        ]
      : []),
  ],
});
