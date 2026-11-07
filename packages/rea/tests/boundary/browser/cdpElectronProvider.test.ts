import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createPackage } from "@electron/asar";
import { afterEach, describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import { CdpElectronProvider } from "../../../src/browser/CdpElectronProvider.js";
import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import {
  inspectElectronPageInputSchema,
  listElectronTargetsInputSchema,
} from "../../../src/domain/javascript/electronObservation.js";
import {
  startFakeCdpBrowser,
  type FakeCdpBrowser,
} from "../../fixtures/fakeCdpBrowser.js";

const browsers: FakeCdpBrowser[] = [];
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(browsers.splice(0).map(async (browser) => browser.close()));
  await Promise.all(
    temporary
      .splice(0)
      .map(async (path) => rm(path, { recursive: true, force: true })),
  );
});

it.each(["late", "initial", "destroyed", "final-malformed", "out-of-scope"])(
  "captures the current authorized frame inventory: %s",
  async (kind) => {
    const root = await electronFixture();
    const mainUrl = pathToFileURL(join(root, "index.html")).href;
    const childUrl = pathToFileURL(join(root, "child.html")).href;
    const scriptUrl = pathToFileURL(join(root, "app.js")).href;
    const browser = await startFakeCdpBrowser({
      electronFileUrl: mainUrl,
      eventsBeforeReply: ["Runtime.enable", "Debugger.enable"],
      commandResult: ({ method }, _origin, reads) =>
        method === "Page.getFrameTree"
          ? {
              frameTree: {
                frame: { id: "frame-main", url: mainUrl },
                childFrames:
                  reads > 1 || kind === "initial"
                    ? [
                        {
                          frame: {
                            id: "child",
                            parentId: "frame-main",
                            url:
                              kind === "out-of-scope"
                                ? "https://foreign.test/child"
                                : childUrl,
                          },
                        },
                      ]
                    : [],
                ...(kind === "final-malformed" && reads > 2
                  ? {
                      childFrames: [
                        {
                          frame: {
                            id: "child",
                            parentId: "frame-main",
                            url: childUrl,
                          },
                        },
                        null,
                      ],
                    }
                  : {}),
              },
            }
          : method === "Debugger.getScriptSource"
            ? { scriptSource: "void 0;" }
            : undefined,
      commandEvents: ({ method, sessionId }) =>
        method === "Runtime.enable"
          ? [
              {
                method: "Runtime.executionContextCreated",
                ...(sessionId === undefined ? {} : { sessionId }),
                params: { context: { id: 7, auxData: { frameId: "child" } } },
              },
            ]
          : method === "Debugger.enable"
            ? [
                {
                  method: "Debugger.scriptParsed",
                  ...(sessionId === undefined ? {} : { sessionId }),
                  params: {
                    scriptId: "child-script",
                    url: scriptUrl,
                    executionContextId: 7,
                    length: 7,
                    scriptLanguage: "JavaScript",
                  },
                },
                ...(kind === "destroyed"
                  ? [
                      {
                        method: "Runtime.executionContextDestroyed",
                        ...(sessionId === undefined ? {} : { sessionId }),
                        params: { executionContextId: 7 },
                      },
                    ]
                  : []),
              ]
            : undefined,
    });
    browsers.push(browser);
    const inspected = await new CdpElectronProvider().inspectPage(
      inspectElectronPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "electron-page",
        observation_ms: 0,
        include_script_sources: true,
      }),
    );
    if (!inspected.ok) throw inspected.error;
    expect(
      inspected.value.frames.some(({ frame_id }) => frame_id === "child"),
    ).toBe(kind !== "out-of-scope");
    if (kind === "out-of-scope") {
      expect(inspected.value.scripts.items).toEqual([]);
      expect(
        browser.commands.some(
          ({ method }) => method === "Debugger.getScriptSource",
        ),
      ).toBe(false);
    } else
      expect(inspected.value.scripts.items).toContainEqual(
        expect.objectContaining({
          file_path: join(root, "app.js"),
          // Later context teardown does not erase the observed association.
          frame_id: "child",
          frame_scope: "authorized",
        }),
      );
    if (kind === "final-malformed") {
      expect(inspected.value.completeness.attach_limited_sections).toEqual(
        expect.arrayContaining(["frames", "scripts", "workers"]),
      );
      expect(
        inspected.value.completeness.excluded.filter(
          ({ section }) => section === "frames",
        ),
      ).toEqual([]);
    }
  },
);
it.each(["reordered", "parent-changed", "path-changed"])(
  "compares semantic frame inventory independent of sibling order: %s",
  async (kind) => {
    const root = await electronFixture();
    const main = pathToFileURL(join(root, "index.html")).href;
    const child = pathToFileURL(join(root, "child.html")).href;
    const app = pathToFileURL(join(root, "app.js")).href;
    const browser = await startFakeCdpBrowser({
      electronFileUrl: main,
      commandResult: ({ method }, _origin, reads) => {
        if (method !== "Page.getFrameTree") return undefined;
        const first = {
          frame: {
            id: "first",
            parentId:
              reads > 2 && kind === "parent-changed" ? "second" : "frame-main",
            url: reads > 2 && kind === "path-changed" ? app : child,
          },
        };
        const second = {
          frame: { id: "second", parentId: "frame-main", url: app },
        };
        return {
          frameTree: {
            frame: { id: "frame-main", url: main },
            childFrames: reads > 2 ? [second, first] : [first, second],
          },
        };
      },
    });
    browsers.push(browser);
    const result = await new CdpElectronProvider().inspectPage(
      inspectElectronPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "electron-page",
        observation_ms: 0,
      }),
    );
    if (!result.ok) throw result.error;
    expect(result.value.frames.map(({ frame_id }) => frame_id)).toEqual([
      "frame-main",
      "first",
      "second",
    ]);
    for (const section of ["frames", "scripts", "workers"] as const)
      expect(
        result.value.completeness.attach_limited_sections.includes(section),
      ).toBe(kind !== "reordered");
  },
);

it.each([
  "detached",
  "foreign-reuse",
  "reparented",
  "unvalidated-context",
  "same-document",
])("retains authorized historical script owners after %s", async (kind) => {
  const root = await electronFixture();
  const main = pathToFileURL(join(root, "index.html")).href;
  const child = pathToFileURL(join(root, "child.html")).href;
  const script = pathToFileURL(join(root, "app.js")).href;
  const browser = await startFakeCdpBrowser({
    electronFileUrl: main,
    eventsBeforeReply: ["Debugger.enable"],
    commandResult: ({ method }, _origin, reads) =>
      method === "Page.getFrameTree"
        ? {
            frameTree: {
              frame: { id: "frame-main", url: main },
              childFrames:
                reads === 1 || kind === "same-document"
                  ? ["first", "second"].map((id) => ({
                      frame: { id, parentId: "frame-main", url: child },
                    }))
                  : [],
            },
          }
        : undefined,
    commandEvents: ({ method, sessionId }) => {
      if (method !== "Debugger.enable")
        return method === "Runtime.enable" ? [] : undefined;
      const scope = sessionId === undefined ? {} : { sessionId };
      const sameDocument = (id: string, fragment: string) =>
        kind === "same-document"
          ? [
              {
                method: "Page.navigatedWithinDocument",
                ...scope,
                params: { frameId: id, url: `${child}#${fragment}` },
              },
            ]
          : [];
      const events = ["first", "second"].flatMap((id, index) => [
        {
          method: "Runtime.executionContextCreated",
          ...scope,
          params: { context: { id: index + 7, auxData: { frameId: id } } },
        },
        ...sameDocument(id, "before"),
        {
          method: "Debugger.scriptParsed",
          ...scope,
          params: {
            scriptId: id,
            url: script,
            executionContextId: index + 7,
            hash: "same",
            length: 7,
            scriptLanguage: "JavaScript",
          },
        },
        ...sameDocument(id, "after"),
        ...(kind === "detached"
          ? [
              {
                method: "Page.frameDetached",
                ...scope,
                params: { frameId: id, reason: "remove" },
              },
            ]
          : []),
      ]);
      return kind !== "detached" && kind !== "same-document"
        ? [
            ...events,
            {
              method:
                kind === "reparented"
                  ? "Page.frameAttached"
                  : "Page.frameNavigated",
              ...scope,
              params:
                kind === "reparented"
                  ? { frameId: "first", parentFrameId: "unknown-parent" }
                  : {
                      frame: {
                        id: "first",
                        parentId: "frame-main",
                        url: "https://foreign.test/",
                      },
                    },
            },
            ...(kind === "unvalidated-context"
              ? [
                  {
                    method: "Runtime.executionContextCreated",
                    ...scope,
                    params: {
                      context: {
                        id: 7,
                        auxData: { frameId: "not-authorized" },
                      },
                    },
                  },
                ]
              : []),
            {
              method: "Debugger.scriptParsed",
              ...scope,
              params: {
                scriptId: "foreign-reused",
                url: script,
                executionContextId: 7,
                hash: "foreign",
              },
            },
          ]
        : events;
    },
  });
  browsers.push(browser);
  const result = await new CdpElectronProvider().inspectPage(
    inspectElectronPageInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      target_id: "electron-page",
      observation_ms: 0,
    }),
  );
  if (!result.ok) throw result.error;
  expect(result.value.frames.map(({ frame_id }) => frame_id)).toEqual(
    kind === "same-document"
      ? ["frame-main", "first", "second"]
      : ["frame-main"],
  );
  expect(
    result.value.scripts.items
      .filter(({ cdp_hash }) => cdp_hash === "same")
      .map(({ frame_id }) => frame_id)
      .sort(),
  ).toEqual(["first", "second"]);
  if (kind !== "detached" && kind !== "same-document")
    expect(
      result.value.scripts.items.find(({ cdp_hash }) => cdp_hash === "foreign"),
    ).toMatchObject({
      frame_id: kind === "unvalidated-context" ? "not-authorized" : "first",
      frame_scope: "unknown",
    });
});

it("excludes srcdoc scripts before source reads while retaining declared labels and unknown frame scope", async () => {
  const root = await electronFixture();
  const mainUrl = pathToFileURL(join(root, "index.html")).href;
  const label = pathToFileURL(join(root, "app.js")).href;
  const browser = await startFakeCdpBrowser({
    electronFileUrl: mainUrl,
    eventsBeforeReply: ["Debugger.enable"],
    commandResult: ({ method, params }) =>
      method === "Page.getFrameTree"
        ? {
            frameTree: {
              frame: { id: "frame-main", url: mainUrl },
              childFrames: [
                {
                  frame: {
                    id: "srcdoc",
                    parentId: "frame-main",
                    url: "about:srcdoc",
                  },
                },
              ],
            },
          }
        : method === "Debugger.getScriptSource"
          ? { scriptSource: `void ${String(params.scriptId)};` }
          : undefined,
    commandEvents: ({ method, sessionId }) =>
      method === "Runtime.enable"
        ? []
        : method === "Debugger.enable"
          ? [
              ["declared", "frame-main", true],
              ["reported", "frame-main", false],
              ["excluded", "srcdoc", true],
              ["unknown", "unproven-frame", true],
            ].map(([scriptId, frameId, hasSourceURL], index) => ({
              method: "Debugger.scriptParsed",
              sessionId,
              params: {
                scriptId,
                url: label,
                executionContextId: index + 1,
                executionContextAuxData: { frameId },
                hasSourceURL,
                hash: scriptId,
              },
            }))
          : undefined,
  });
  browsers.push(browser);
  const result = await new CdpElectronProvider().inspectPage(
    inspectElectronPageInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      target_id: "electron-page",
      observation_ms: 0,
      include_script_sources: true,
    }),
  );
  if (!result.ok) throw result.error;
  const byHash = new Map(
    result.value.scripts.items.map((script) => [script.cdp_hash, script]),
  );
  expect(byHash.has("excluded")).toBe(false);
  expect(byHash.get("declared")).toMatchObject({
    frame_id: "frame-main",
    frame_scope: "authorized",
    has_source_url: true,
    reported_url: label,
    frame_claims: { script_event_frame_id: "frame-main" },
    file_path: join(root, "app.js"),
    source: { included: true },
  });
  expect(byHash.get("reported")).toMatchObject({
    has_source_url: false,
    frame_scope: "authorized",
  });
  expect(byHash.get("unknown")).toMatchObject({
    frame_id: "unproven-frame",
    frame_scope: "unknown",
    has_source_url: true,
  });
  expect(
    browser.commands
      .filter(({ method }) => method === "Debugger.getScriptSource")
      .map(({ params }) => params.scriptId)
      .sort(),
  ).toEqual(["declared", "reported", "unknown"]);
  expect(result.value.completeness.excluded).toContainEqual({
    section: "scripts",
    reason: "out_of_target_scope",
    count: 1,
  });
  expect(result.value.completeness.attach_limited_sections).toContain(
    "scripts",
  );
});

describe("CdpElectronProvider target access", () => {
  it("retains a completed page observation when cancellation arrives during final detach", async () => {
    const root = await electronFixture();
    const controller = new AbortController();
    const browser = await startFakeCdpBrowser({
      electronFileUrl: pathToFileURL(join(root, "index.html")).href,
      commandEvents: ({ method }) => {
        if (method === "Target.detachFromTarget") controller.abort();
        return undefined;
      },
    });
    browsers.push(browser);

    const result = await new CdpElectronProvider().inspectPage(
      inspectElectronPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "electron-page",
        observation_ms: 0,
      }),
      { signal: controller.signal },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected late cancellation");
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.partialObservation).toMatchObject({
      kind: "electron-page-observation",
      cleanup: "transport-closed",
      inspection: { target: { file_path: join(root, "index.html") } },
    });
    expect(browser.commands.map(({ method }) => method)).toContain(
      "Target.detachFromTarget",
    );
    const closeDeadline = Date.now() + 1_000;
    while (browser.activeConnectionCount() !== 0 && Date.now() < closeDeadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(browser.activeConnectionCount()).toBe(0);
  });

  it("returns every in-scope resource beyond the former collection ceiling", async () => {
    const root = await electronFixture();
    const index = join(root, "index.html");
    const count = 2_001;
    await Promise.all(
      Array.from({ length: count }, (_value, item) =>
        writeFile(join(root, `inventory-${String(item)}.js`), ""),
      ),
    );
    const browser = await startFakeCdpBrowser({
      electronFileUrl: pathToFileURL(index).href,
      electronInventoryCount: count,
    });
    browsers.push(browser);
    const inspected = await new CdpElectronProvider().inspectPage(
      inspectElectronPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "electron-page",
        observation_ms: 0,
      }),
    );
    if (!inspected.ok) throw inspected.error;
    expect(inspected.value.resources).toHaveLength(count + 1);
    expect(inspected.value.completeness.truncated_sections).toEqual([]);
  });

  it("returns every Electron page target exposed by the endpoint inline", async () => {
    const root = await electronFixture();
    const index = join(root, "index.html");
    const browser = await startFakeCdpBrowser({
      electronFileUrl: pathToFileURL(index).href,
      additionalElectronPageCount: 205,
    });
    browsers.push(browser);
    const listed = await new CdpElectronProvider().listTargets(
      listElectronTargetsInputSchema.parse({
        cdp_endpoint: browser.endpoint,
      }),
    );
    if (!listed.ok) throw listed.error;
    expect(listed.value.targets).toHaveLength(206);
    expect(listed.value.targets[0]?.target_id).toBe("electron-page");
    expect(listed.value.targets.at(-1)?.target_id).toBe("electron-page-0204");
  });
});

describe("CdpElectronProvider target selection", () => {
  it("lists and inspects every canonical local file target", async () => {
    const root = await electronFixture();
    const index = join(root, "index.html");
    const browser = await startFakeCdpBrowser({
      electronFileUrl: pathToFileURL(index).href,
      duplicateElectronInventory: true,
      omitElectronTargetAttachmentState: true,
    });
    browsers.push(browser);
    const provider = new CdpElectronProvider();
    const listed = await provider.listTargets(
      listElectronTargetsInputSchema.parse({
        cdp_endpoint: browser.endpoint,
      }),
    );
    if (!listed.ok) throw listed.error;
    expect(listed.value.targets).toEqual([
      expect.objectContaining({
        target_id: "electron-page",
        file_path: index,
        attached: null,
      }),
    ]);
    expect(
      listed.value.limitations.some((item) =>
        item.includes("attachment state"),
      ),
    ).toBe(true);
    expect(listed.value.excluded).toEqual({
      unsupported_url: 3,
      non_page: 2,
    });

    const inspected = await provider.inspectPage(
      inspectElectronPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "electron-page",
        observation_ms: 0,
      }),
    );
    if (!inspected.ok) throw inspected.error;
    expect(inspected.value.target.file_path).toBe(index);
    expect(inspected.value.target.attached).toBeNull();
    expect(
      inspected.value.limitations.some((item) =>
        item.includes("attachment state"),
      ),
    ).toBe(true);
    expect(inspected.value.frames).toEqual([
      expect.objectContaining({ file_path: index }),
    ]);
    expect(inspected.value.dom).toMatchObject({ total_nodes: 2 });
    expect(inspected.value.scripts).toMatchObject({
      total: 1,
      items: [
        expect.objectContaining({
          file_path: join(root, "app.js"),
          source: {
            included: false,
            reason: "source capture was not selected",
          },
        }),
      ],
    });
    expect(inspected.value.resources).toEqual([
      expect.objectContaining({ file_path: join(root, "app.js") }),
    ]);
    const methods = browser.commands.map(({ method }) => method);
    expect(methods).not.toContain("Runtime.evaluate");
    expect(methods).not.toContain("Network.enable");
    expect(methods).not.toContain("Debugger.getScriptSource");
    expect(methods).toContain("Target.detachFromTarget");

    const missing = await provider.inspectPage(
      inspectElectronPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "missing",
        observation_ms: 0,
      }),
    );
    expect(missing).toMatchObject({
      ok: false,
      error: {
        _tag: "BrowserObservationError",
        operation: "inspect_electron_page",
        reason: "target_not_found",
      },
    });
  });

  it("inspects a page-scoped Electron endpoint without browser attachment", async () => {
    const root = await electronFixture();
    const index = join(root, "index.html");
    const browser = await startFakeCdpBrowser({
      electronFileUrl: pathToFileURL(index).href,
      pageScopedVersionWebSocket: true,
      omitTargetWebSocket: true,
    });
    browsers.push(browser);
    const result = await new CdpElectronProvider().inspectPage(
      inspectElectronPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "electron-page",
        observation_ms: 0,
      }),
    );
    if (!result.ok) throw result.error;
    expect(result.value.target.file_path).toBe(index);
    expect(browser.commands.map(({ method }) => method)).not.toContain(
      "Target.attachToTarget",
    );
    expect(
      browser.commands.every(({ sessionId }) => sessionId === undefined),
    ).toBe(true);
  });

  it("maps cancelled Electron discovery to the Electron operation", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await new CdpElectronProvider().listTargets(
      listElectronTargetsInputSchema.parse({
        cdp_endpoint: "http://127.0.0.1:9222",
      }),
      { signal: controller.signal },
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        operation: "list_electron_targets",
      },
    });
  });
});

describe("CdpElectronProvider packaged pages", () => {
  it("lists and inspects packaged pages served from inside app.asar", async () => {
    const root = await createTestTempDirectory("rea-electron-asar-provider-");
    temporary.push(root);
    const source = join(root, "source");
    await mkdir(source);
    await writeFile(
      join(source, "index.html"),
      "<script src='app.js'></script>",
    );
    await writeFile(join(source, "app.js"), "export const app = true;");
    const archive = join(root, "app.asar");
    await createPackage(source, archive);
    const packaged = await realpath(archive);
    const browser = await startFakeCdpBrowser({
      electronFileUrl: `${pathToFileURL(join(archive, "index.html")).href}?isBookDoubleClicked=0#/library`,
    });
    browsers.push(browser);
    const provider = new CdpElectronProvider();
    const listed = await provider.listTargets(
      listElectronTargetsInputSchema.parse({ cdp_endpoint: browser.endpoint }),
    );
    if (!listed.ok) throw listed.error;
    expect(listed.value.targets).toEqual([
      expect.objectContaining({
        target_id: "electron-page",
        file_path: join(packaged, "index.html"),
      }),
    ]);

    const inspected = await provider.inspectPage(
      inspectElectronPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "electron-page",
        observation_ms: 0,
      }),
    );
    if (!inspected.ok) throw inspected.error;
    expect(inspected.value.target.file_path).toBe(join(packaged, "index.html"));
    expect(inspected.value.scripts.items).toEqual([
      expect.objectContaining({ file_path: join(packaged, "app.js") }),
    ]);
  });
});

describe("CdpElectronProvider frame capture", () => {
  it.each([7, undefined])(
    "reports a malformed child frame ID as unavailable protocol evidence: %s",
    async (childId) => {
      const root = await electronFixture();
      const main = pathToFileURL(join(root, "index.html")).href;
      const child = pathToFileURL(join(root, "child.html")).href;
      const browser = await startFakeCdpBrowser({
        electronFileUrl: main,
        commandResult: (command) =>
          command.method === "Page.getFrameTree"
            ? {
                frameTree: {
                  frame: { id: "frame-main", url: main },
                  childFrames: [
                    {
                      frame: {
                        ...(childId === undefined ? {} : { id: childId }),
                        url: child,
                      },
                    },
                  ],
                },
              }
            : undefined,
      });
      browsers.push(browser);
      const result = await new CdpElectronProvider().inspectPage(
        inspectElectronPageInputSchema.parse({
          cdp_endpoint: browser.endpoint,
          target_id: "electron-page",
          observation_ms: 0,
        }),
      );

      if (!result.ok) throw result.error;
      expect(result.value.frames.map((frame) => frame.frame_id)).toEqual([
        "frame-main",
      ]);
      expect(result.value.completeness).toMatchObject({
        unavailable_sections: ["frames"],
      });
      expect(result.value.completeness.excluded).toContainEqual({
        section: "frames",
        reason: "invalid_protocol_value",
        count: 1,
      });
      expect(result.value.completeness.policy_filtered_sections).not.toContain(
        "frames",
      );
      expect(result.value.completeness.conditions).toContain("attach_limited");
    },
  );
});

describe("CdpElectronProvider malformed source replies", () => {
  it.each([{}, { scriptSource: null }, { scriptSource: 123 }])(
    "rejects malformed Electron source replies instead of inventing source: %j",
    async (reply) => {
      const root = await electronFixture();
      const browser = await startFakeCdpBrowser({
        electronFileUrl: pathToFileURL(join(root, "index.html")).href,
        commandResult: ({ method }) =>
          method === "Debugger.getScriptSource" ? reply : undefined,
      });
      browsers.push(browser);
      const result = await new CdpElectronProvider().inspectPage(
        inspectElectronPageInputSchema.parse({
          cdp_endpoint: browser.endpoint,
          target_id: "electron-page",
          observation_ms: 0,
          include_script_sources: true,
        }),
      );

      expect(result).toMatchObject({
        ok: false,
        error: {
          operation: "inspect_electron_page",
          reason: "protocol_error",
          userMessage: expect.stringContaining("scriptSource must be a string"),
        },
      });
      expect(browser.commands.map(({ method }) => method)).toContain(
        "Target.detachFromTarget",
      );
    },
  );
});

const inspectInventoryReply = async (
  method: string,
  reply: (fileUrl: string) => Readonly<Record<string, unknown>>,
) => {
  const root = await electronFixture();
  const fileUrl = pathToFileURL(join(root, "index.html")).href;
  const browser = await startFakeCdpBrowser({
    electronFileUrl: fileUrl,
    commandResult: (command) =>
      command.method === method ? reply(fileUrl) : undefined,
  });
  browsers.push(browser);
  const result = await new CdpElectronProvider().inspectPage(
    inspectElectronPageInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      target_id: "electron-page",
      observation_ms: 0,
    }),
  );
  if (!result.ok) throw result.error;
  return result.value;
};

describe("CdpElectronProvider malformed inventory replies", () => {
  it("keeps documents unknown when the DOM string table is missing", async () => {
    const inspected = await inspectInventoryReply(
      "DOMSnapshot.captureSnapshot",
      () => ({
        documents: [{ documentURL: 0, nodes: { nodeType: [] } }],
      }),
    );

    expect(inspected.dom).toEqual({
      total_nodes: 0,
      node_value_length_unit: "utf8-bytes",
      nodes: [],
    });
    expect(inspected.completeness.unavailable_sections).toContain("dom");
    expect(inspected.completeness.excluded).toContainEqual({
      section: "dom",
      reason: "invalid_protocol_value",
      count: null,
    });
    expect(inspected.completeness.policy_filtered_sections).not.toContain(
      "dom",
    );
  });

  it.each([
    ["missing type", { type: undefined }],
    ["non-string type", { type: 7 }],
    ["empty type", { type: "" }],
    ["missing target identity", { targetId: undefined }],
    ["non-string target identity", { targetId: 7 }],
    ["empty target identity", { targetId: "" }],
    ["missing URL", { url: undefined }],
    ["non-string URL", { url: 7 }],
    ["missing attached state", { attached: undefined }],
    ["non-boolean attached state", { attached: "false" }],
    ["non-string opener relationship", { openerId: 7 }],
    ["empty opener relationship", { openerId: "" }],
    ["non-string frame relationship", { parentFrameId: 7 }],
    ["empty frame relationship", { parentFrameId: "" }],
  ] as const)(
    "retains valid workers while reporting %s before target policy",
    async (_kind, malformed) => {
      const inspected = await inspectInventoryReply(
        "Target.getTargets",
        (fileUrl) => ({
          targetInfos: [
            {
              targetId: "selected-worker",
              type: "worker",
              url: fileUrl,
              attached: false,
              openerId: "electron-page",
            },
            {
              targetId: "malformed-worker",
              type: "worker",
              url: fileUrl,
              attached: false,
              openerId: "foreign-page",
              ...malformed,
            },
            {
              targetId: "foreign-worker",
              type: "shared_worker",
              url: fileUrl,
              attached: true,
              openerId: "foreign-page",
            },
            {
              targetId: "unattributed-worker",
              type: "service_worker",
              url: fileUrl,
              attached: false,
            },
            // Non-worker rows do not need worker identity or relationship fields.
            { type: "page", targetId: 7, openerId: null },
          ],
        }),
      );
      expect(inspected.workers).toEqual([
        expect.objectContaining({
          target_id: "selected-worker",
          type: "worker",
          attached: false,
          opener_target_id: "electron-page",
          parent_frame_id: null,
        }),
      ]);
      const workerExclusions = inspected.completeness.excluded.filter(
        ({ section }) => section === "workers",
      );
      expect(workerExclusions).toHaveLength(3);
      expect(workerExclusions).toEqual(
        expect.arrayContaining([
          { section: "workers", reason: "invalid_protocol_value", count: 1 },
          { section: "workers", reason: "out_of_target_scope", count: 1 },
          { section: "workers", reason: "unattributed_target", count: 1 },
        ]),
      );
      expect(inspected.completeness.unavailable_sections).toContain("workers");
      expect(inspected.completeness.policy_filtered_sections).toContain(
        "workers",
      );
    },
  );

  it.each([
    ["dom", "DOMSnapshot.captureSnapshot", () => ({ strings: [] })],
    [
      "dom",
      "DOMSnapshot.captureSnapshot",
      (fileUrl: string) => ({
        strings: [fileUrl],
        documents: [{ documentURL: 0, nodes: { nodeType: null } }],
      }),
    ],
    [
      "resources",
      "Page.getResourceTree",
      (fileUrl: string) => ({
        frameTree: { frame: { id: "main", url: fileUrl }, resources: null },
      }),
    ],
    ["workers", "Target.getTargets", () => ({ targetInfos: null })],
  ] as const)(
    "keeps a malformed %s inventory incomplete (%s)",
    async (section, method, reply) => {
      const inspected = await inspectInventoryReply(method, reply);
      expect(inspected.completeness.status).not.toBe("complete_within_window");
      expect(inspected.completeness.excluded).toContainEqual(
        expect.objectContaining({
          section,
          reason: "invalid_protocol_value",
        }),
      );
    },
  );
});

describe("CdpElectronProvider script source capture", () => {
  it("retains an explicitly empty Electron producer script", async () => {
    const root = await electronFixture();
    const browser = await startFakeCdpBrowser({
      electronFileUrl: pathToFileURL(join(root, "index.html")).href,
      commandResult: ({ method }) =>
        method === "Debugger.getScriptSource"
          ? { scriptSource: "" }
          : undefined,
    });
    browsers.push(browser);
    const result = await new CdpElectronProvider().inspectPage(
      inspectElectronPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "electron-page",
        observation_ms: 0,
        include_script_sources: true,
      }),
    );

    if (!result.ok) throw result.error;
    expect(result.value.scripts.items[0]?.source).toMatchObject({
      included: true,
      artifact: { text: "", bytes: 0 },
    });
  });

  it("captures Electron script source only after separate approval", async () => {
    const root = await electronFixture();
    const browser = await startFakeCdpBrowser({
      electronFileUrl: pathToFileURL(join(root, "index.html")).href,
    });
    browsers.push(browser);
    const result = await new CdpElectronProvider().inspectPage(
      inspectElectronPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "electron-page",
        observation_ms: 0,
        include_script_sources: true,
      }),
    );
    if (!result.ok) throw result.error;
    expect(result.value.scripts.items[0]?.source).toMatchObject({
      included: true,
      artifact: { text: "export const observed = 'source-secret';" },
    });
    expect(browser.commands.map(({ method }) => method)).toContain(
      "Debugger.getScriptSource",
    );
  });

  it("rebases DOM parent indexes across allowed file documents", async () => {
    const root = await electronFixture();
    const browser = await startFakeCdpBrowser({
      electronFileUrl: pathToFileURL(join(root, "index.html")).href,
      extraCollections: true,
    });
    browsers.push(browser);
    const result = await new CdpElectronProvider().inspectPage(
      inspectElectronPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "electron-page",
        observation_ms: 0,
      }),
    );

    if (!result.ok) throw result.error;
    expect(result.value.dom).toMatchObject({
      total_nodes: 4,
      nodes: [
        { index: 0, parent_index: -1 },
        { index: 1, parent_index: 0 },
        { index: 2, parent_index: -1 },
        { index: 3, parent_index: 2 },
      ],
    });
  });

  it("rejects mixed Electron evidence when the main frame navigates", async () => {
    const root = await electronFixture();
    const page = join(root, "index.html");
    const next = join(root, "next.html");
    await writeFile(next, "<html>next</html>");
    const browser = await startFakeCdpBrowser({
      electronFileUrl: pathToFileURL(page).href,
      navigateDuringCaptureUrl: pathToFileURL(next).href,
    });
    browsers.push(browser);
    const result = await new CdpElectronProvider().inspectPage(
      inspectElectronPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "electron-page",
        observation_ms: 0,
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "BrowserObservationError",
        operation: "inspect_electron_page",
        reason: "target_changed",
      },
    });
  });
});

const electronFixture = async (): Promise<string> => {
  const root = await createTestTempDirectory("rea-electron-provider-");
  temporary.push(root);
  await writeFile(join(root, "index.html"), "<script src='app.js'></script>");
  await writeFile(join(root, "app.js"), "export const app = true;");
  await writeFile(join(root, "child.html"), "<div>child</div>");
  return root;
};

it.each(
  ["initial", "refreshed"].flatMap((phase) =>
    ["missing", "number", "null", "empty", "foreign", "cycle", "valid"].map(
      (parent) => ({ phase, parent }),
    ),
  ),
)(
  "does not authorize unproved nested Electron ancestry: $phase/$parent",
  async ({ phase, parent }) => {
    const root = await electronFixture();
    const main = pathToFileURL(join(root, "index.html")).href;
    const child = pathToFileURL(join(root, "child.html")).href;
    const script = pathToFileURL(join(root, "app.js")).href;
    const parentValue =
      parent === "number"
        ? 7
        : parent === "null"
          ? null
          : parent === "empty"
            ? ""
            : parent === "foreign"
              ? "other"
              : parent === "cycle"
                ? "child"
                : "frame-main";
    let eventFrameReads = 0;
    const browser = await startFakeCdpBrowser({
      electronFileUrl: main,
      eventsBeforeReply: ["Debugger.enable", "Page.getFrameTree"],
      commandResult: ({ method }, _origin, reads) =>
        method === "Page.getFrameTree"
          ? {
              frameTree: {
                frame: { id: "frame-main", url: main },
                childFrames:
                  phase === "refreshed" && reads === 1
                    ? []
                    : [
                        {
                          frame: {
                            id: "child",
                            url: child,
                            ...(parent === "missing"
                              ? {}
                              : { parentId: parentValue }),
                          },
                          childFrames: [
                            {
                              frame: {
                                id: "grandchild",
                                parentId: "child",
                                url: child,
                              },
                            },
                          ],
                        },
                      ],
              },
            }
          : undefined,
      commandEvents: ({ method, sessionId }) => {
        if (method === "Page.getFrameTree") eventFrameReads++;
        if (
          !(phase === "initial"
            ? method === "Debugger.enable"
            : method === "Page.getFrameTree" && eventFrameReads === 2)
        )
          return method === "Runtime.enable" || method === "Debugger.enable"
            ? []
            : undefined;
        const scope = sessionId === undefined ? {} : { sessionId };
        return ["child", "grandchild"].flatMap((id, index) => [
          {
            method: "Runtime.executionContextCreated",
            ...scope,
            params: { context: { id: 70 + index, auxData: { frameId: id } } },
          },
          {
            method: "Debugger.scriptParsed",
            ...scope,
            params: {
              scriptId: id,
              url: script,
              executionContextId: 70 + index,
              hash: id,
              length: 7,
              scriptLanguage: "JavaScript",
            },
          },
        ]);
      },
    });
    browsers.push(browser);
    const result = await new CdpElectronProvider().inspectPage(
      inspectElectronPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "electron-page",
        observation_ms: 0,
      }),
    );
    if (!result.ok) throw result.error;
    expect(result.value.frames.map((f) => f.frame_id)).toEqual(
      parent === "valid"
        ? ["frame-main", "child", "grandchild"]
        : ["frame-main"],
    );
    for (const id of ["child", "grandchild"])
      expect(result.value.scripts.items).toContainEqual(
        expect.objectContaining({
          cdp_hash: id,
          frame_id: id,
          frame_scope: parent === "valid" ? "authorized" : "unknown",
          frame_claims: { execution_context_frame_id: id },
        }),
      );
    if (parent !== "valid") {
      expect(result.value.completeness.unavailable_sections).toContain(
        "frames",
      );
      expect(result.value.completeness.attach_limited_sections).toContain(
        "scripts",
      );
      expect(result.value.completeness.policy_filtered_sections).not.toContain(
        "frames",
      );
    }
  },
);

it.each(
  ["blank", "remote", "missing-file"].flatMap((parent) =>
    ["initial", "refreshed", "invalidated"].map((phase) => ({ parent, phase })),
  ),
)(
  "separates structural ancestry from parent file policy: $parent/$phase",
  async ({ parent, phase }) => {
    const root = await electronFixture();
    const main = pathToFileURL(join(root, "index.html")).href;
    const child = pathToFileURL(join(root, "child.html")).href;
    const script = pathToFileURL(join(root, "app.js")).href;
    const parentUrl =
      parent === "blank"
        ? "about:blank"
        : parent === "remote"
          ? "https://foreign.invalid/frame"
          : pathToFileURL(join(root, "absent.html")).href;
    let eventReads = 0;
    const browser = await startFakeCdpBrowser({
      electronFileUrl: main,
      eventsBeforeReply: ["Page.getFrameTree", "Debugger.enable"],
      commandResult: ({ method }, _origin, reads) =>
        method === "Page.getFrameTree"
          ? {
              frameTree: {
                frame: { id: "frame-main", url: main },
                childFrames:
                  phase === "refreshed" && reads === 1
                    ? []
                    : [
                        {
                          frame: {
                            id: "parent",
                            parentId: "frame-main",
                            url: parentUrl,
                          },
                          childFrames: [
                            {
                              frame: {
                                id: "local",
                                parentId: "parent",
                                url: child,
                              },
                            },
                          ],
                        },
                      ],
              },
            }
          : undefined,
      commandEvents: ({ method, sessionId }) => {
        if (method === "Page.getFrameTree") eventReads++;
        if (
          !(phase === "refreshed" || phase === "invalidated"
            ? method === "Page.getFrameTree" && eventReads === 2
            : method === "Debugger.enable")
        )
          return method === "Runtime.enable" || method === "Debugger.enable"
            ? []
            : undefined;
        const scope = sessionId === undefined ? {} : { sessionId };
        return [
          ...(phase === "invalidated"
            ? [
                {
                  method: "Page.frameNavigated",
                  ...scope,
                  params: {
                    frame: {
                      id: "parent",
                      parentId: "frame-main",
                      url: parentUrl,
                      loaderId: "new-parent",
                    },
                  },
                },
              ]
            : []),
          {
            method: "Runtime.executionContextCreated",
            ...scope,
            params: { context: { id: 81, auxData: { frameId: "local" } } },
          },
          {
            method: "Debugger.scriptParsed",
            ...scope,
            params: {
              scriptId: "local",
              url: script,
              executionContextId: 81,
              hash: "local",
              length: 7,
              scriptLanguage: "JavaScript",
            },
          },
        ];
      },
    });
    browsers.push(browser);
    const result = await new CdpElectronProvider().inspectPage(
      inspectElectronPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "electron-page",
        observation_ms: 0,
      }),
    );
    if (!result.ok) throw result.error;
    expect(result.value.frames.map((frame) => frame.frame_id)).toEqual([
      "frame-main",
      "local",
    ]);
    expect(result.value.scripts.items).toContainEqual(
      expect.objectContaining({
        cdp_hash: "local",
        frame_id: "local",
        frame_scope: phase === "invalidated" ? "unknown" : "authorized",
      }),
    );
    expect(result.value.completeness.policy_filtered_sections).toContain(
      "frames",
    );
    expect(result.value.completeness.excluded).not.toContainEqual(
      expect.objectContaining({
        section: "frames",
        reason: "invalid_protocol_value",
      }),
    );
  },
);

it.each(["about:blank", "https://foreign.invalid/root"])(
  "does not replace an unauthorized tree root with a local descendant: %s",
  async (rootUrl) => {
    const root = await electronFixture();
    const local = pathToFileURL(join(root, "index.html")).href;
    const browser = await startFakeCdpBrowser({
      electronFileUrl: local,
      commandResult: ({ method }) =>
        method === "Page.getFrameTree"
          ? {
              frameTree: {
                frame: { id: "frame-main", url: rootUrl },
                childFrames: [
                  {
                    frame: { id: "local", parentId: "frame-main", url: local },
                  },
                ],
              },
            }
          : undefined,
    });
    browsers.push(browser);
    const result = await new CdpElectronProvider().inspectPage(
      inspectElectronPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "electron-page",
        observation_ms: 0,
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { reason: "target_not_allowed" },
    });
    expect(browser.commands.map(({ method }) => method)).not.toContain(
      "Debugger.enable",
    );
  },
);

const replayScripts =
  (source: string, sessionId: string | undefined) =>
  (id: string, frameId: string, contextId: number) => [
    {
      method: "Runtime.executionContextCreated",
      ...(sessionId === undefined ? {} : { sessionId }),
      params: { context: { id: contextId, auxData: { frameId } } },
    },
    {
      method: "Debugger.scriptParsed",
      ...(sessionId === undefined ? {} : { sessionId }),
      params: {
        scriptId: id,
        url: source,
        executionContextId: contextId,
        hash: id,
        length: 7,
        scriptLanguage: "JavaScript",
      },
    },
  ];

const replayFrameTree = (
  main: string,
  child: string,
  before: string,
  kind: string,
  reads: number,
) => ({
  frameTree: {
    frame: { id: "frame-main", url: main },
    childFrames:
      reads === 1 || (kind === "during-tree" && reads === 2)
        ? [
            {
              frame: {
                id: "child",
                parentId: "frame-main",
                url: before,
                ...(kind === "missing-loader"
                  ? {}
                  : { loaderId: "child-loader" }),
              },
              childFrames: [
                {
                  frame: {
                    id: "grandchild",
                    parentId: "child",
                    url: child,
                    loaderId: "grandchild-loader",
                  },
                },
              ],
            },
          ]
        : [],
  },
});

it.each([
  "inline",
  "split",
  "clear",
  "query",
  "during-tree",
  "post-detach",
  "changed-loader",
  "changed-parent",
  "unknown-frame",
  "missing-loader",
  "missing-url",
  "invalid-fragment",
])(
  "preserves authorized same-document history across replay and detach: %s",
  async (kind) => {
    const root = await electronFixture();
    const main = pathToFileURL(join(root, "index.html")).href;
    const child = pathToFileURL(join(root, "child.html")).href;
    const source = pathToFileURL(join(root, "app.js")).href;
    const before = `${child}#old`;
    const after =
      kind === "clear"
        ? child
        : kind === "query"
          ? `${child}?caller=retained#next`
          : `${child}#next`;
    const expectedOwner = [
      "inline",
      "split",
      "clear",
      "query",
      "during-tree",
      "post-detach",
    ].includes(kind);
    let eventReads = 0;
    const browser = await startFakeCdpBrowser({
      electronFileUrl: main,
      eventsBeforeReply: [
        "Debugger.enable",
        "Page.getFrameTree",
        "DOMSnapshot.captureSnapshot",
      ],
      commandResult: ({ method }, _origin, reads) =>
        method === "Page.getFrameTree"
          ? replayFrameTree(main, child, before, kind, reads)
          : undefined,
      commandEvents: ({ method, sessionId }) => {
        if (method === "Page.getFrameTree") eventReads += 1;
        if (
          method !== "Debugger.enable" &&
          !(
            kind === "during-tree" &&
            (method === "Page.getFrameTree" ||
              method === "DOMSnapshot.captureSnapshot")
          )
        )
          return method === "Runtime.enable" ? [] : undefined;
        const scope = sessionId === undefined ? {} : { sessionId };
        const script = replayScripts(source, sessionId);
        const events = [
          ...script("before", "child", 70),
          {
            method: "Page.navigatedWithinDocument",
            ...scope,
            params: {
              frameId: kind === "unknown-frame" ? "unknown" : "child",
              ...(kind === "missing-url"
                ? {}
                : kind === "split"
                  ? { url: child, urlFragment: "#next" }
                  : kind === "clear"
                    ? { url: before, urlFragment: "" }
                    : kind === "invalid-fragment"
                      ? { url: child, urlFragment: 7 }
                      : { url: after }),
            },
          },
          {
            method: "Page.frameNavigated",
            ...scope,
            params: {
              frame: {
                id: "child",
                parentId:
                  kind === "changed-parent" ? "other-parent" : "frame-main",
                url: after,
                loaderId:
                  kind === "changed-loader" ? "replacement" : "child-loader",
              },
            },
          },
          ...script("after-replay", "child", 71),
          ...script("descendant", "grandchild", 72),
          {
            method: "Page.frameDetached",
            ...scope,
            params: { frameId: "child", reason: "remove" },
          },
          ...(kind === "post-detach"
            ? script("after-detach", "child", 73)
            : []),
        ];
        if (kind !== "during-tree") return events;
        if (method === "Debugger.enable") return events.slice(0, 2);
        if (method === "Page.getFrameTree")
          return eventReads === 2 ? events.slice(2, 3) : [];
        return events.slice(3);
      },
    });
    browsers.push(browser);
    const result = await new CdpElectronProvider().inspectPage(
      inspectElectronPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "electron-page",
        observation_ms: 0,
      }),
    );
    if (!result.ok) throw result.error;
    expect(result.value.scripts.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cdp_hash: "before", frame_id: "child" }),
        expect.objectContaining({
          cdp_hash: "after-replay",
          frame_id: "child",
          frame_scope: expectedOwner ? "authorized" : "unknown",
        }),
        expect.objectContaining({
          cdp_hash: "descendant",
          frame_id: "grandchild",
          frame_scope: expectedOwner ? "authorized" : "unknown",
        }),
      ]),
    );
    if (kind === "post-detach")
      expect(result.value.scripts.items).toContainEqual(
        expect.objectContaining({
          cdp_hash: "after-detach",
          frame_id: "child",
          frame_scope: "unknown",
        }),
      );
    expect(
      result.value.completeness.attach_limited_sections.includes("scripts"),
    ).toBe(!expectedOwner || kind === "post-detach" || kind === "during-tree");
    expect(result.value.frames.map(({ frame_id }) => frame_id)).toEqual(
      kind === "during-tree"
        ? ["frame-main", "child", "grandchild"]
        : ["frame-main"],
    );
  },
);

it.each([
  { stage: 2, lateEvent: false },
  { stage: 2, lateEvent: true },
  { stage: 3, lateEvent: false },
])(
  "rejects a tree-first same-file main reload (read $stage, late event $lateEvent)",
  async ({ stage, lateEvent }) => {
    const root = await electronFixture();
    const main = pathToFileURL(join(root, "index.html")).href;
    let reads = 0;
    const frame = () => ({
      id: "frame-main",
      url: main,
      loaderId: reads >= stage ? "replacement" : "initial",
    });
    const browser = await startFakeCdpBrowser({
      electronFileUrl: main,
      commandResult: ({ method }) => {
        if (method !== "Page.getFrameTree") return undefined;
        reads++;
        return { frameTree: { frame: frame() } };
      },
      commandEvents: ({ method, sessionId }) =>
        lateEvent && method === "DOMSnapshot.captureSnapshot"
          ? [
              {
                method: "Page.frameNavigated",
                ...(sessionId === undefined ? {} : { sessionId }),
                params: { frame: frame() },
              },
            ]
          : undefined,
    });
    browsers.push(browser);
    const result = await new CdpElectronProvider().inspectPage(
      inspectElectronPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "electron-page",
        observation_ms: 0,
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { reason: "target_changed" },
    });
    expect(reads).toBeGreaterThanOrEqual(stage);
  },
);

it.each(["#next", "?route=next#details"])(
  "keeps script authority for a tree-first same-document child URL %s",
  async (suffix) => {
    const root = await electronFixture();
    const main = pathToFileURL(join(root, "index.html")).href;
    const child = pathToFileURL(join(root, "child.html")).href;
    const source = pathToFileURL(join(root, "app.js")).href;
    const tree = (reads: number) => ({
      frameTree: {
        frame: { id: "frame-main", url: main, loaderId: "main-loader" },
        childFrames: [
          {
            frame: {
              id: "child",
              parentId: "frame-main",
              url: child + (reads > 1 ? suffix : ""),
              loaderId: "child-loader",
            },
            childFrames: [
              {
                frame: {
                  id: "grandchild",
                  parentId: "child",
                  url: child,
                  loaderId: "grandchild-loader",
                },
              },
            ],
          },
        ],
      },
    });
    const browser = await startFakeCdpBrowser({
      electronFileUrl: main,
      commandResult: ({ method }, _origin, reads) =>
        method === "Page.getFrameTree" ? tree(reads) : undefined,
      commandEvents: ({ method, sessionId }) => {
        const scripts = replayScripts(source, sessionId);
        if (method === "Runtime.enable") return [];
        if (method === "Debugger.enable")
          return [
            ...scripts("before-child", "child", 70),
            ...scripts("before-grandchild", "grandchild", 71),
          ];
        if (method === "DOMSnapshot.captureSnapshot")
          return [
            {
              method: "Page.navigatedWithinDocument",
              ...(sessionId === undefined ? {} : { sessionId }),
              params: { frameId: "child", url: child + suffix },
            },
            ...scripts("after-child", "child", 72),
            ...scripts("after-grandchild", "grandchild", 73),
          ];
        return undefined;
      },
    });
    browsers.push(browser);
    const result = await new CdpElectronProvider().inspectPage(
      inspectElectronPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "electron-page",
        observation_ms: 0,
      }),
    );
    if (!result.ok) throw result.error;
    for (const id of ["child", "grandchild"])
      for (const phase of ["before", "after"])
        expect(result.value.scripts.items).toContainEqual(
          expect.objectContaining({ cdp_hash: `${phase}-${id}`, frame_id: id }),
        );
    expect(result.value.completeness.attach_limited_sections).not.toContain(
      "scripts",
    );
  },
);
