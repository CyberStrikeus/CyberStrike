import type { WebSocket } from "ws";

import type { FakeCdpCommand, FakeOptions } from "./fakeCdpBrowserTypes.js";

export const emitEvents = (
  socket: WebSocket,
  command: FakeCdpCommand,
  port: number,
  options: FakeOptions,
): void => {
  emitDebuggerEvents(socket, command, port, options);
  emitNetworkEvents(socket, command, port, options);
  emitRuntimeEvents(socket, command, port, options);
  emitWebMcpEvents(socket, command, port, options);
  emitSessionTimeline(socket, command, port, options);
  emitCaptureNavigation(socket, command, port, options);
};

const webMcpToolAnnotations = {
  readOnly: true,
  untrustedContent: true,
  consequential: true,
  autosubmit: false,
};

const emitWebMcpEvents = (
  socket: WebSocket,
  command: FakeCdpCommand,
  port: number,
  options: FakeOptions,
): void => {
  if (
    command.method === "WebMCP.enable" &&
    options.webMcpSameUrlRegistrations !== undefined
  ) {
    emitSameUrlWebMcpRegistrations(socket, command, options);
    return;
  }
  if (command.method !== "WebMCP.enable" || options.webMcpTools !== true)
    return;
  emitMainWebMcpTools(socket, command, port, options);
  emitChildWebMcpNavigations(socket, command, port, options);
};

const emitMainWebMcpTools = (
  socket: WebSocket,
  command: FakeCdpCommand,
  port: number,
  options: FakeOptions,
): void => {
  const inputSchemaProperties =
    options.webMcpSchemaPropertyCount === undefined
      ? {
          orderId: { type: "string", example: "schema-secret" },
          includeItems: { type: "boolean", default: true },
        }
      : Object.fromEntries(
          Array.from(
            { length: options.webMcpSchemaPropertyCount },
            (_value, index) => [`field_${String(index)}`, { type: "string" }],
          ),
        );
  event(socket, "WebMCP.toolsAdded", command.sessionId, {
    tools: [
      {
        name: "search_orders",
        description: "Search orders; authorization=Bearer tool-secret",
        frameId: "frame-main",
        backendNodeId: 42,
        inputSchema: options.webMcpInputSchema ?? {
          type: "object",
          properties: inputSchemaProperties,
          required: ["orderId"],
        },
        annotations: {
          ...webMcpToolAnnotations,
          consequential: Object.hasOwn(options, "webMcpConsequential")
            ? options.webMcpConsequential
            : true,
        },
        stackTrace:
          options.webMcpStackTrace !== undefined
            ? options.webMcpStackTrace(`http://127.0.0.1:${String(port)}`)
            : {
                callFrames: [
                  {
                    url: `http://127.0.0.1:${String(port)}/app.js?token=tool-source-secret`,
                    lineNumber: 12,
                    columnNumber: 4,
                  },
                ],
              },
      },
      {
        name: "private_tool",
        description: "private-tool-secret",
        frameId: "frame-private",
      },
      ...(options.extraCollections === true
        ? [
            {
              name: "update_order",
              description: "Update an order",
              frameId: "frame-main",
              inputSchema: {
                type: "object",
                properties: { orderId: { type: "string" } },
              },
            },
          ]
        : []),
      ...(options.webMcpFrameCount !== undefined && options.webMcpFrameCount > 0
        ? [
            {
              name: "beyond_frame_limit_tool",
              description: "Registered in an in-scope frame after index 999",
              frameId: `webmcp-frame-${String(options.webMcpFrameCount - 1)}`,
            },
          ]
        : []),
      ...(options.webMcpChildLeavesScope === true ||
      options.webMcpChildTransientBlank === true
        ? [
            {
              name: "child_tool",
              description: "Must be removed after child navigation",
              frameId: "frame-child",
            },
          ]
        : []),
    ],
  });
};

const emitChildWebMcpNavigations = (
  socket: WebSocket,
  command: FakeCdpCommand,
  port: number,
  options: FakeOptions,
): void => {
  if (options.webMcpChildLeavesScope === true) {
    event(socket, "Page.frameNavigated", command.sessionId, {
      frame: {
        id: "frame-child",
        parentId: "frame-main",
        url: "https://private.example.test/escaped",
      },
    });
    event(socket, "WebMCP.toolsAdded", command.sessionId, {
      tools: [
        {
          name: "escaped_child_tool",
          description: "cross-origin-child-secret",
          frameId: "frame-child",
        },
      ],
    });
  }
  if (options.webMcpChildTransientBlank === true)
    event(socket, "Page.frameNavigated", command.sessionId, {
      frame: {
        id: "frame-child",
        parentId: "frame-main",
        loaderId: "loader-transient",
        url: "about:blank",
      },
    });
  if (options.webMcpChildRecoversAfterTransient === true) {
    event(socket, "Page.frameNavigated", command.sessionId, {
      frame: {
        id: "frame-child",
        parentId: "frame-main",
        loaderId: "loader-child-recovered",
        url: `http://127.0.0.1:${String(port)}/child-recovered`,
      },
    });
    event(socket, "WebMCP.toolsAdded", command.sessionId, {
      tools: [
        {
          name: "child_tool",
          description: "Replayed from the current child document",
          frameId: "frame-child",
        },
      ],
    });
  }
  if (options.webMcpChildNavigatesAllowed === true)
    event(socket, "Page.frameNavigated", command.sessionId, {
      frame: {
        id: "frame-child",
        parentId: "frame-main",
        loaderId: "loader-child-replacement",
        url: `http://127.0.0.1:${String(port)}/child-replacement`,
      },
    });
};

const emitSameUrlWebMcpRegistrations = (
  socket: WebSocket,
  command: FakeCdpCommand,
  options: FakeOptions,
): void => {
  event(socket, "WebMCP.toolsAdded", command.sessionId, {
    tools: [
      {
        name: "read_item",
        description: "First owner",
        frameId: "webmcp-frame-0",
      },
    ],
  });
  event(socket, "WebMCP.toolsAdded", command.sessionId, {
    tools: [
      {
        name: "read_item",
        description: "First owner updated",
        frameId: "webmcp-frame-0",
      },
    ],
  });
  event(socket, "WebMCP.toolsAdded", command.sessionId, {
    tools: [
      {
        name: "read_item",
        description: "Second owner",
        frameId: "webmcp-frame-1",
      },
    ],
  });
  if (options.webMcpSameUrlRegistrations === "remove-second")
    event(socket, "WebMCP.toolsRemoved", command.sessionId, {
      tools: [{ name: "read_item", frameId: "webmcp-frame-1" }],
    });
};

const emitSessionTimeline = (
  socket: WebSocket,
  command: FakeCdpCommand,
  port: number,
  options: FakeOptions,
): void => {
  if (
    command.method === "Page.setLifecycleEventsEnabled" &&
    options.sessionTimeline !== undefined
  ) {
    const allowed = `http://127.0.0.1:${String(port)}/reloaded?token=session-secret`;
    event(socket, "Page.frameRequestedNavigation", command.sessionId, {
      frameId: "frame-main",
      url: allowed,
      reason: "reload",
      timestamp: 10,
    });
    event(socket, "Page.frameNavigated", command.sessionId, {
      frame: {
        id: "frame-main",
        loaderId: "loader-reload",
        url: allowed,
        transitionType: "reload",
      },
      timestamp: 11,
    });
    event(socket, "Page.navigatedWithinDocument", command.sessionId, {
      frameId: "frame-main",
      url: `${allowed}#spa-secret`,
      navigationType: "historyApi",
      timestamp: 12,
    });
    const redirectUrl =
      options.sessionTimeline === "outside_policy"
        ? "https://private.example.test/outside?token=redirect-secret"
        : `http://127.0.0.1:${String(port)}/redirected?token=redirect-secret`;
    event(socket, "Network.requestWillBeSent", command.sessionId, {
      requestId: "document-request",
      type: options.sessionRedirectResourceType,
      frameId: "frame-main",
      loaderId: "loader-redirect",
      request: { url: redirectUrl, method: "GET" },
      initiator: { type: "other" },
      redirectResponse: { url: allowed, status: 302 },
      timestamp: 13,
    });
    event(socket, "Network.requestWillBeSent", command.sessionId, {
      requestId: "failed-request",
      type: "Document",
      frameId: "frame-main",
      loaderId: "loader-reload",
      request: { url: allowed, method: "GET" },
      initiator: { type: "other" },
      timestamp: 13.5,
    });
    event(socket, "Network.loadingFailed", command.sessionId, {
      requestId: "failed-request",
      type: "Document",
      errorText: "net::ERR_CONNECTION_REFUSED",
      timestamp: 14,
    });
    event(socket, "Page.lifecycleEvent", command.sessionId, {
      frameId: "frame-main",
      loaderId: "loader-reload",
      name: "networkIdle",
      timestamp: 15,
    });
    for (
      let index = 0;
      index < (options.sessionTimelineEventCount ?? 0);
      index += 1
    )
      event(socket, "Page.lifecycleEvent", command.sessionId, {
        frameId: "frame-main",
        loaderId: "loader-reload",
        name: `lifecycle-${String(index)}`,
        timestamp: 16 + index,
      });
    if (options.sessionTimeline === "target_detached")
      event(socket, "Target.detachedFromTarget", undefined, {
        sessionId: command.sessionId,
        targetId: "allowed-page",
      });
    if (options.sessionTimeline === "target_crashed")
      event(socket, "Inspector.targetCrashed", command.sessionId, {});
  }
};

const emitSameOriginRedirectEvents = (
  socket: WebSocket,
  command: FakeCdpCommand,
  port: number,
  url: string,
): string => {
  const intermediate = `http://127.0.0.1:${String(port)}/intermediate`;
  const finalUrl = `http://127.0.0.1:${String(port)}/redirected?token=final-secret`;
  event(socket, "Network.requestWillBeSent", command.sessionId, {
    requestId: "request-1",
    type: "Fetch",
    request: { url: intermediate, method: "GET" },
    initiator: { type: "other" },
    redirectResponse: {
      url,
      status: 301,
      mimeType: "text/plain",
      encodedDataLength: 23,
      headers: { "X-Private": "redirect-header-secret" },
    },
    timestamp: 8,
  });
  event(socket, "Network.requestWillBeSent", command.sessionId, {
    requestId: "request-1",
    type: "Fetch",
    request: { url: finalUrl, method: "GET" },
    initiator: { type: "other" },
    redirectResponse: {
      url: intermediate,
      status: 302,
      mimeType: "text/plain",
      encodedDataLength: 27,
    },
    timestamp: 9,
  });
  return finalUrl;
};

const emitReturnFromDisallowedRedirect = (
  socket: WebSocket,
  command: FakeCdpCommand,
  port: number,
): string => {
  const finalUrl = `http://127.0.0.1:${String(port)}/returned`;
  event(socket, "Network.requestWillBeSent", command.sessionId, {
    requestId: "request-1",
    type: "Fetch",
    request: { url: finalUrl, method: "GET" },
    initiator: { type: "other" },
    redirectResponse: {
      url: "https://private.example.test/outside?token=redirect-url-secret",
      status: 302,
      mimeType: "text/plain",
      encodedDataLength: 31,
      headers: { "X-Private": "redirect-header-secret" },
      postData: "redirect-body-secret",
    },
    timestamp: 8,
  });
  return finalUrl;
};

const emitMalformedRedirectPriorResponse = (
  socket: WebSocket,
  command: FakeCdpCommand,
  port: number,
  initialUrl: string,
): void => {
  const priorUrl = `http://127.0.0.1:${String(port)}/malformed-redirect-prior`;
  event(socket, "Network.requestWillBeSent", command.sessionId, {
    requestId: "request-1",
    type: "Fetch",
    request: {
      url: priorUrl,
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      postData: JSON.stringify({
        operation: "preserve-prior",
        token: "prior-body",
      }),
    },
    initiator: { type: "other" },
    redirectResponse: {
      url: initialUrl,
      status: 307,
      mimeType: "text/plain",
      encodedDataLength: 23,
    },
    timestamp: 8,
  });
  event(socket, "Network.responseReceived", command.sessionId, {
    requestId: "request-1",
    response: {
      url: priorUrl,
      status: 201,
      mimeType: "application/json",
      headers: {
        "Content-Length": "123",
        "Content-Encoding": "gzip",
        "Content-Security-Policy": "default-src 'self'",
        "X-Model-Context": "prior-context-hint",
      },
    },
  });
};

const emitMalformedRedirect = (
  socket: WebSocket,
  command: FakeCdpCommand,
  port: number,
  options: FakeOptions,
): string => {
  const finalUrl = `http://127.0.0.1:${String(port)}/malformed-redirect-final`;
  const redirectResponse = Object.hasOwn(options, "redirectResponseEnvelope")
    ? options.redirectResponseEnvelope
    : {
        ...(options.redirectResponseUrl === undefined
          ? {}
          : { url: options.redirectResponseUrl }),
        status: 302,
      };
  event(socket, "Network.requestWillBeSent", command.sessionId, {
    requestId: "request-1",
    type: "Fetch",
    request: { url: finalUrl, method: "GET" },
    initiator: { type: "other" },
    ...(options.omitRedirectResponse === true ? {} : { redirectResponse }),
    timestamp: 9,
  });
  return finalUrl;
};

const emitNetworkEvents = (
  socket: WebSocket,
  command: FakeCdpCommand,
  port: number,
  options: FakeOptions,
): void => {
  if (command.method !== "Network.enable") return;
  if (options.navigateDuringObservationUrl !== undefined)
    event(socket, "Page.frameNavigated", command.sessionId, {
      frame: {
        id: "frame-main",
        url: options.navigateDuringObservationUrl,
      },
    });
  const url = `http://127.0.0.1:${String(port)}/api?token=network-secret`;
  const requestUrl =
    options.redirectFromDisallowedOrigin === true
      ? "https://private.example.test/start?token=initial-url-secret"
      : url;
  event(socket, "Network.requestWillBeSent", command.sessionId, {
    requestId: "request-1",
    type: "Fetch",
    request: {
      url: requestUrl,
      method: "POST",
      headers: {
        Authorization: "Bearer request-secret",
        "Content-Type": "application/json; charset=utf-8",
      },
      postData: JSON.stringify({
        operation: "lookup",
        token: "request-body-secret",
        filters: { active: true },
      }),
    },
    timestamp: 7,
    initiator: {
      type: "script",
      stack: {
        callFrames: [
          {
            url: `http://127.0.0.1:${String(port)}/app.js?caller=caller-secret`,
            lineNumber: 3,
            columnNumber: 5,
          },
        ],
      },
    },
  });
  if (options.malformedRedirectResponse === true)
    emitMalformedRedirectPriorResponse(socket, command, port, url);
  const responseUrl =
    options.redirectFromDisallowedOrigin === true
      ? emitReturnFromDisallowedRedirect(socket, command, port)
      : options.malformedRedirectResponse === true
        ? emitMalformedRedirect(socket, command, port, options)
        : options.redirectWithinOrigin === true
          ? emitSameOriginRedirectEvents(socket, command, port, url)
          : url;
  if (options.redirectToDisallowedOrigin === true)
    event(socket, "Network.requestWillBeSent", command.sessionId, {
      requestId: "request-1",
      type: "Fetch",
      request: {
        url: "https://private.example.test/redirected",
        method: "GET",
      },
      initiator: { type: "other" },
      redirectResponse: {
        url,
        status: 302,
        mimeType: "text/plain",
        encodedDataLength: 23,
        headers: { "X-Private": "redirect-header-secret" },
      },
    });
  event(socket, "Network.responseReceived", command.sessionId, {
    requestId: "request-1",
    response: {
      url:
        options.responseAfterMalformedUrl ??
        (options.redirectToDisallowedOrigin === true
          ? "https://private.example.test/redirected"
          : responseUrl),
      status: 200,
      mimeType: "application/json",
      headers: {
        "Set-Cookie": "response-secret",
        "Content-Length": "321",
        "Content-Encoding": "br",
        "Content-Security-Policy":
          "default-src 'self' https:; script-src 'nonce-csp-secret' 'sha256-hash-secret' https://private.example.test https://127.0.0.1",
        Link: `</agent?token=link-secret>; rel="mcp service-desc"; type="application/json", <https://private.example.test/agent>; rel="mcp"`,
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Permissions-Policy": "camera=(), geolocation=(self)",
        "X-Model-Context": "header-secret",
      },
    },
  });
  event(socket, "Network.loadingFinished", command.sessionId, {
    requestId: "request-1",
    encodedDataLength: 321,
  });
  event(socket, "Network.webSocketCreated", command.sessionId, {
    requestId: "websocket-1",
    url: `ws://127.0.0.1:${String(port)}/live?token=websocket-url-secret`,
  });
  if (options.webSocketWithoutFrames === true) return;
  event(socket, "Network.webSocketFrameSent", command.sessionId, {
    requestId: "websocket-1",
    response: {
      opcode: 1,
      payloadData:
        options.sensitiveShapes === true
          ? JSON.stringify({
              event: "updated",
              token: "websocket-secret",
              payload: { count: 2 },
            })
          : "websocket-secret",
    },
  });
  if (options.binaryWebSocketEvent === true)
    event(socket, "Network.webSocketFrameReceived", command.sessionId, {
      requestId: "websocket-1",
      response: {
        opcode: 2,
        payloadData:
          options.invalidBinaryWebSocketEvent === true ? "%%%" : "AQID",
      },
    });
};

const emitDebuggerEvents = (
  socket: WebSocket,
  command: FakeCdpCommand,
  port: number,
  options: FakeOptions,
): void => {
  if (command.method !== "Debugger.enable") return;
  if (options.foreignSessionEvents === true)
    event(socket, "Debugger.scriptParsed", "foreign-session", {
      scriptId: "script-foreign",
      url: `http://127.0.0.1:${String(port)}/foreign.js`,
      hash: "foreign-hash",
      length: 20,
      isModule: false,
    });
  event(socket, "Debugger.scriptParsed", command.sessionId, {
    scriptId: "script-allowed",
    url:
      options.electronFileUrl === undefined
        ? `http://127.0.0.1:${String(port)}/app.js?token=script-secret`
        : new URL("app.js", options.electronFileUrl).href,
    hash: "cdp-hash",
    length: 40,
    isModule: true,
    executionContextId: 1,
    scriptLanguage: "JavaScript",
    sourceMapURL: "/app.js.map?token=map-secret",
  });
  if (
    options.electronFileUrl !== undefined &&
    options.duplicateElectronInventory === true
  )
    event(socket, "Debugger.scriptParsed", command.sessionId, {
      scriptId: "script-allowed-duplicate",
      url: new URL("app.js", options.electronFileUrl).href,
      hash: "cdp-hash",
      length: 40,
      isModule: true,
      executionContextId: 1,
      scriptLanguage: "JavaScript",
    });
  event(socket, "Debugger.scriptParsed", command.sessionId, {
    scriptId: "script-private",
    url: "https://private.example.test/private.js?secret=forbidden",
    hash: "private-hash",
    length: 100,
    isModule: false,
  });
  event(socket, "Debugger.scriptParsed", command.sessionId, {
    scriptId: "script-inline",
    url: "",
    hash: "inline-secret",
    length: 100,
    isModule: false,
  });
};

const emitRuntimeEvents = (
  socket: WebSocket,
  command: FakeCdpCommand,
  port: number,
  options: FakeOptions,
): void => {
  if (command.method !== "Runtime.enable") return;
  event(socket, "Runtime.executionContextCreated", command.sessionId, {
    context: {
      id: 1,
      origin:
        options.electronFileUrl === undefined
          ? `http://127.0.0.1:${String(port)}`
          : "file://",
      auxData: { frameId: "frame-main", isDefault: true },
    },
  });
  event(socket, "Runtime.consoleAPICalled", command.sessionId, {
    type: "log",
    timestamp: 123,
    args: [
      {
        type: "string",
        value:
          options.sensitiveShapes === true
            ? "authorization=Bearer console-secret"
            : "console-secret",
      },
      ...(options.sensitiveShapes === true
        ? [
            { type: "number", value: 42 },
            {
              type: "object",
              objectId: "must-not-be-expanded",
              description: "object-secret",
            },
          ]
        : []),
      ...(options.nullConsoleArgument === true
        ? [{ type: "object", subtype: "null", value: null }]
        : []),
    ],
    stackTrace: {
      callFrames: [
        {
          url: `http://127.0.0.1:${String(port)}/app.js?secret=console-url`,
          lineNumber: 7,
          columnNumber: 9,
        },
      ],
    },
  });
  event(socket, "Runtime.consoleAPICalled", command.sessionId, {
    type: "unknown-origin-console-secret",
    timestamp: 124,
    args: [{ type: "string", value: "unknown-console-value-secret" }],
  });
};

const emitCaptureNavigation = (
  socket: WebSocket,
  command: FakeCdpCommand,
  port: number,
  options: FakeOptions,
): void => {
  if (
    command.method === "Page.captureScreenshot" &&
    options.screenshotDocumentLoader !== undefined
  )
    event(socket, "Page.frameNavigated", command.sessionId, {
      frame: {
        id: "frame-main",
        url: `http://127.0.0.1:${String(port)}/app?token=frame-secret`,
        loaderId: options.screenshotDocumentLoader,
      },
    });
  const navigationUrl =
    command.method === "DOMSnapshot.captureSnapshot"
      ? options.navigateDuringCaptureUrl
      : command.method === "Page.captureScreenshot"
        ? options.navigateDuringScreenshotUrl
        : undefined;
  if (navigationUrl !== undefined)
    event(socket, "Page.frameNavigated", command.sessionId, {
      frame: { id: "frame-main", url: navigationUrl },
    });
};

const event = (
  socket: WebSocket,
  method: string,
  sessionId: string | undefined,
  params: Readonly<Record<string, unknown>>,
): void =>
  socket.send(
    JSON.stringify({
      method,
      params,
      ...(sessionId === undefined ? {} : { sessionId }),
    }),
  );
