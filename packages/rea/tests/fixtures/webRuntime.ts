import { startFakeCdpBrowser, type FakeOptions } from "./fakeCdpBrowser.js";
import type { FakeCdpCommand } from "./fakeCdpBrowserTypes.js";

export const runtimeSourceA = "// 🔥\r\nfunction selected(){ return 'A'; }";
export const runtimeSourceB = "function untouched(){ return 'B'; }";

/** Producer fixture uses same-URL distinct scripts and a producer hash unlike the UTF-8 digest. */
export const startRuntimeBrowser = (overrides: FakeOptions = {}) =>
  startFakeCdpBrowser({
    ...overrides,
    commandResult: (command, origin, reads) =>
      overrides.commandResult?.(command, origin, reads) ??
      runtimeResult(command, origin),
    commandEvents: (command, origin) =>
      overrides.commandEvents?.(command, origin) ??
      runtimeEvents(command, origin),
  });

const runtimeResult = (
  command: FakeCdpCommand,
  origin: string,
): Readonly<Record<string, unknown>> | undefined => {
  switch (command.method) {
    case "Profiler.enable":
    case "Profiler.disable":
      return {};
    case "Profiler.startPreciseCoverage":
      return { timestamp: 12 };
    case "Profiler.stopPreciseCoverage":
      return {};
    case "Page.getFrameTree":
      return {
        frameTree: {
          frame: {
            id: "runtime-main",
            url: `${origin}/app`,
            loaderId: "document-1",
          },
        },
      };
    case "Profiler.takePreciseCoverage":
      return {
        timestamp: 13,
        result: [
          {
            scriptId: "script-a",
            url: `${origin}/same.js`,
            functions: [
              {
                functionName: "selected",
                isBlockCoverage: true,
                ranges: [
                  {
                    startOffset: 0,
                    endOffset: runtimeSourceA.length,
                    count: 2,
                  },
                  { startOffset: 7, endOffset: 8, count: 0 },
                ],
              },
            ],
          },
          {
            scriptId: "script-b",
            url: `${origin}/same.js`,
            functions: [
              {
                functionName: "untouched",
                isBlockCoverage: true,
                ranges: [
                  {
                    startOffset: 0,
                    endOffset: runtimeSourceB.length,
                    count: 0,
                  },
                ],
              },
            ],
          },
          {
            scriptId: "script-foreign",
            url: `${origin}/same.js`,
            functions: [],
          },
        ],
      };
    case "Debugger.getScriptSource":
      return {
        scriptSource:
          command.params.scriptId === "script-a"
            ? runtimeSourceA
            : runtimeSourceB,
      };
    case "DOM.getDocument":
      return { root: { nodeId: 1 } };
    case "DOM.querySelector":
      return { nodeId: command.params.selector === "#missing" ? 0 : 2 };
    case "DOM.describeNode":
      return { node: { backendNodeId: 22 } };
    case "DOM.resolveNode":
      return { object: { objectId: "selected-node-object" } };
    case "DOMDebugger.getEventListeners":
      return {
        listeners: [
          {
            type: "click",
            useCapture: false,
            passive: true,
            once: false,
            scriptId: "script-a",
            lineNumber: 1,
            columnNumber: 0,
          },
        ],
      };
    default:
      return undefined;
  }
};

const runtimeEvents = (command: FakeCdpCommand, origin: string) => {
  const session =
    command.sessionId === undefined ? {} : { sessionId: command.sessionId };
  if (command.method === "Runtime.enable")
    return [
      {
        ...session,
        method: "Runtime.executionContextCreated",
        params: {
          context: {
            id: 1,
            origin,
            name: "",
            auxData: {
              frameId: "runtime-main",
              isDefault: true,
              type: "default",
            },
          },
        },
      },
    ];
  if (command.method !== "Debugger.enable") return [];
  return ["script-a", "script-b", "script-foreign"].map((scriptId) => ({
    ...session,
    method: "Debugger.scriptParsed",
    params: {
      scriptId,
      url: `${origin}/same.js`,
      executionContextId: scriptId === "script-foreign" ? 99 : 1,
      executionContextAuxData: {
        frameId:
          scriptId === "script-foreign" ? "foreign-frame" : "runtime-main",
      },
      startLine: 0,
      startColumn: 0,
      endLine: 1,
      endColumn: 0,
      hash: "producer-reported-hash",
      hasSourceURL: true,
      scriptLanguage: "JavaScript",
    },
  }));
};
