import { createHash } from "node:crypto";

import { expect, it, onTestFinished } from "vitest";

import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { webPageInspectionSchema } from "../../../src/domain/browserObservationSchemas.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { webCaptureDiffSchema } from "../../../src/domain/webCaptureDiffSchemas.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";

interface ScriptRace {
  readonly phase: "none" | "source" | "storage" | "final";
  readonly lateIds: readonly string[];
  readonly allowed?: boolean;
  readonly sources?: boolean;
  readonly deleteFirst?: boolean;
}

const source = "const first = 1;";
const startScriptRaceBrowser = (race: ScriptRace) => {
  let frameReads = 0;
  return startFakeCdpBrowser({
    eventsBeforeReply: [
      "Runtime.enable",
      "Debugger.enable",
      "Debugger.getScriptSource",
      "Storage.getUsageAndQuota",
      "Page.getFrameTree",
    ],
    commandResult: ({ method }) =>
      method === "Debugger.getScriptSource"
        ? { scriptSource: source }
        : undefined,
    commandEvents: (command, origin) => {
      const sessionId = command.sessionId;
      if (command.method === "Runtime.enable")
        return [
          {
            method: "Runtime.executionContextCreated",
            sessionId,
            params: {
              context: {
                id: 1,
                origin,
                auxData: { frameId: "frame-main", isDefault: true },
              },
            },
          },
        ];
      if (command.method === "Page.getFrameTree") frameReads += 1;
      const first = command.method === "Debugger.enable";
      const late =
        (race.phase === "source" &&
          command.method === "Debugger.getScriptSource") ||
        (race.phase === "storage" &&
          command.method === "Storage.getUsageAndQuota") ||
        (race.phase === "final" &&
          command.method === "Page.getFrameTree" &&
          frameReads === 3);
      if (!first && !late) return [];
      const ids = first ? ["first"] : race.lateIds;
      const events = ids.map((scriptId) => ({
        method: "Debugger.scriptParsed",
        sessionId,
        params: {
          scriptId,
          url: `${first || race.allowed !== false ? origin : "https://foreign.test"}/${first ? "first" : "late"}.js`,
          hash: first ? "first-hash" : "late-hash",
          length: source.length,
          isModule: false,
          executionContextId: 1,
          scriptLanguage: "JavaScript",
        },
      }));
      if (!first && race.deleteFirst)
        events.unshift({
          method: "Debugger.scriptParsed",
          sessionId,
          params: {
            scriptId: "first",
            url: "https://foreign.test/first.js",
            hash: "foreign",
            length: source.length,
            isModule: false,
            executionContextId: 1,
            scriptLanguage: "JavaScript",
          },
        });
      return events;
    },
  });
};

it.each([
  { name: "no late script", phase: "none", lateIds: [] },
  { name: "one late source-pass script", phase: "source", lateIds: ["late"] },
  { name: "duplicate late events", phase: "source", lateIds: ["late", "late"] },
  {
    name: "distinct IDs sharing metadata",
    phase: "source",
    lateIds: ["late-1", "late-2"],
  },
  { name: "post-source script", phase: "storage", lateIds: ["late"] },
  { name: "final-frame script", phase: "final", lateIds: ["late"] },
  {
    name: "source-off final-frame script",
    phase: "final",
    lateIds: ["late"],
    sources: false,
  },
  {
    name: "foreign late script",
    phase: "source",
    lateIds: ["late"],
    allowed: false,
  },
  { name: "replacement of an initial ID", phase: "final", lateIds: ["first"] },
  {
    name: "deleted initial ID plus late ID",
    phase: "final",
    lateIds: ["late"],
    deleteFirst: true,
  },
] satisfies (ScriptRace & { readonly name: string })[])(
  "accounts for $name through registered MCP tools",
  async (race: ScriptRace) => {
    const browser = await startScriptRaceBrowser(race);
    onTestFinished(() => browser.close());
    const harness = await createApplicationMcpHarness({
      serverOptions: { browserObservation: new CdpBrowserProvider() },
    });
    onTestFinished(harness.close);
    const response = await harness.client.callTool({
      name: "inspect_web_page",
      arguments: {
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        allowed_origins: [browser.allowedOrigin],
        observation_ms: 0,
        include_script_sources: race.sources !== false,
      },
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const capture = webPageInspectionSchema.parse(
      parseEvidence(response.structuredContent).normalized_result,
    );
    const missing =
      race.allowed === false
        ? 0
        : new Set(race.lateIds.filter((id) => id !== "first")).size;
    expect(capture.scripts.total).toBe(1 + missing);
    expect(capture.scripts.items).toHaveLength(1);
    expect(capture.scripts.total).toBe(
      capture.scripts.items.length +
        capture.completeness.dropped_events.scripts,
    );
    expect(capture.completeness.dropped_events.scripts).toBe(missing);
    expect(capture.completeness.truncated_sections.includes("scripts")).toBe(
      missing > 0,
    );
    expect(
      capture.completeness.excluded.some(
        ({ reason }) => reason === "resource_budget_exhausted",
      ),
    ).toBe(false);
    expect(capture.scripts.items[0]).toMatchObject({
      url: `${browser.allowedOrigin}/first.js`,
      cdp_hash: "first-hash",
      source:
        race.sources === false
          ? { included: false, reason: "source capture was not selected" }
          : {
              included: true,
              artifact: {
                sha256: createHash("sha256").update(source).digest("hex"),
              },
            },
    });
    if (race.allowed === false || race.deleteFirst) {
      expect(capture.completeness.excluded).toContainEqual({
        section: "scripts",
        reason: "disallowed_origin",
        count: 1,
      });
      expect(JSON.stringify(capture.scripts)).not.toContain("foreign.test");
    }
    const comparison = await harness.client.callTool({
      name: "compare_web_captures",
      arguments: {
        before: { inspection: capture },
        after: { inspection: capture },
      },
    });
    expect(comparison.isError, JSON.stringify(comparison)).not.toBe(true);
    const diff = webCaptureDiffSchema.parse(
      parseEvidence(comparison.structuredContent).normalized_result,
    );
    expect(diff.dimensions.scripts).toMatchObject({
      status:
        missing > 0 || race.allowed === false || race.deleteFirst
          ? "unknown"
          : "unchanged",
      total_changes: 0,
      changes: [],
    });
    expect(
      browser.commands
        .filter(({ method }) => method === "Debugger.getScriptSource")
        .map(({ params }) => params.scriptId),
    ).toEqual(race.sources === false ? [] : ["first"]);
    expect(
      browser.commands.filter(
        ({ method }) => method === "Target.detachFromTarget",
      ),
    ).toHaveLength(1);
    await expect.poll(browser.activeConnectionCount).toBe(0);
    await harness.client.ping();
  },
);
