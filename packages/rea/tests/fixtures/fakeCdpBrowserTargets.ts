import type { FakeCdpCommand, FakeOptions } from "./fakeCdpBrowserTypes.js";

export const targets = (
  port: number,
  options: FakeOptions = {},
): readonly Record<string, unknown>[] => [
  {
    id: "allowed-page",
    type: "page",
    title: allowedPageTitle(port, options.urlShapedAllowedTitle),
    url: `http://127.0.0.1:${String(port)}/app?token=page-secret#fragment`,
    attached: false,
    ...(options.omitTargetWebSocket === true
      ? {}
      : {
          webSocketDebuggerUrl: `ws://localhost:${String(port)}/devtools/page/allowed-page`,
        }),
  },
  {
    id: "disallowed-page",
    type: "page",
    title: "Must not leak",
    url: "https://private.example.test/app?token=forbidden",
    attached: false,
  },
  ...(options.additionalPageWithWebSocket === true
    ? [
        {
          id: "allowed-page-with-socket",
          type: "page",
          title: "Second inspectable application page",
          url: `http://127.0.0.1:${String(port)}/second`,
          attached: false,
          webSocketDebuggerUrl: `ws://localhost:${String(port)}/devtools/page/allowed-page-with-socket`,
        },
      ]
    : []),
  ...(options.additionalPageWithoutWebSocket === true
    ? [
        {
          id: "allowed-page-without-socket",
          type: "page",
          title: "Unavailable application page",
          url: `http://127.0.0.1:${String(port)}/unavailable`,
          attached: false,
        },
      ]
    : []),
  ...Array.from({ length: options.additionalPageCount ?? 0 }, (_, index) => ({
    id: `allowed-page-${String(index).padStart(4, "0")}`,
    type: "page",
    title: `Additional application page ${String(index)}`,
    url: `http://127.0.0.1:${String(port)}/additional-${String(index)}`,
    attached: false,
    webSocketDebuggerUrl: `ws://localhost:${String(port)}/devtools/page/allowed-page`,
  })),
  {
    id: "unsupported-page",
    type: "page",
    title: "Internal page",
    url: "chrome://settings/",
    attached: false,
  },
  {
    id: "worker-1",
    type: "service_worker",
    title: "Worker",
    url: `http://127.0.0.1:${String(port)}/worker.js?secret=worker`,
    attached: false,
    openerId: "allowed-page",
  },
  ...(options.extraCollections === true
    ? [
        {
          id: "worker-2",
          type: "shared_worker",
          title: "Second worker",
          url: `http://127.0.0.1:${String(port)}/worker-2.js`,
          attached: false,
          openerId: "allowed-page",
        },
      ]
    : []),
  ...(options.unrelatedWorker === true
    ? [
        {
          id: "worker-other-page",
          type: "dedicated_worker",
          title: "Other page worker",
          url: `http://127.0.0.1:${String(port)}/other-page-worker.js`,
          attached: false,
          openerId: "other-page",
        },
      ]
    : []),
  ...(options.electronFileUrl === undefined
    ? []
    : [
        {
          id: "electron-page",
          type: "page",
          title: "Electron application",
          url: options.electronFileUrl,
          ...(options.omitElectronTargetAttachmentState === true
            ? {}
            : { attached: false }),
          ...(options.omitTargetWebSocket === true
            ? {}
            : {
                webSocketDebuggerUrl: `ws://localhost:${String(port)}/devtools/page/electron-page`,
              }),
        },
        ...Array.from(
          { length: options.additionalElectronPageCount ?? 0 },
          (_, index) => ({
            id: `electron-page-${String(index).padStart(4, "0")}`,
            type: "page",
            title: `Additional Electron page ${String(index)}`,
            url: options.electronFileUrl,
            attached: false,
            webSocketDebuggerUrl: `ws://localhost:${String(port)}/devtools/page/electron-page`,
          }),
        ),
        {
          id: "electron-worker",
          type: "worker",
          title: "Electron worker",
          url: new URL("worker.js", options.electronFileUrl).href,
          attached: false,
          openerId: "electron-page",
        },
      ]),
];

const allowedPageTitle = (
  port: number,
  style: FakeOptions["urlShapedAllowedTitle"],
): string => {
  const suffix = "/app?startup=title-secret#fragment";
  const host = `127.0.0.1:${String(port)}`;
  if (style === true) return `http://${host}${suffix}`;
  if (style === "host-path") return `${host}${suffix}`;
  if (style === "root-relative") return suffix;
  if (style === "prefixed") return `Loading ${host}${suffix}`;
  return "Inspectable application";
};

export const parseCommand = (text: string): FakeCdpCommand => {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null)
    throw new TypeError("Expected CDP command object");
  if (!("id" in value) || typeof value.id !== "number")
    throw new TypeError("Expected CDP command id");
  if (!("method" in value) || typeof value.method !== "string")
    throw new TypeError("Expected CDP method");
  const params =
    "params" in value && isRecord(value.params) ? value.params : {};
  return {
    id: value.id,
    method: value.method,
    params,
    ...("sessionId" in value && typeof value.sessionId === "string"
      ? { sessionId: value.sessionId }
      : {}),
  };
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
