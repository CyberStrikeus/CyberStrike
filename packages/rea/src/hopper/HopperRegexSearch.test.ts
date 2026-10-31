import { expect, it, vi } from "vitest";
import { HopperRegexSearch } from "./HopperRegexSearch.js";
import { err, ok } from "../domain/result.js";
import { AnalysisCapabilityUnavailableError } from "../domain/analysisErrorCore.js";
import {
  HopperRemoteError,
  HopperTimeoutError,
  HopperProcessError,
} from "../domain/hopperErrors.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { parseConfig } from "../config/parseConfig.js";
import { silentLogger } from "../logger.js";
import { HopperClient } from "./HopperClient.js";
import { HopperProvider } from "./HopperProvider.js";

const regexMatch = vi.hoisted(() => ({
  afterSettle: undefined as (() => void) | undefined,
}));
vi.mock("../process/RegexMatcher.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../process/RegexMatcher.js")>();
  return {
    ...actual,
    matchRegexValues: async (
      request: Parameters<typeof actual.matchRegexValues>[0],
    ) => {
      const result = await actual.matchRegexValues(request);
      regexMatch.afterSettle?.();
      return result;
    },
  };
});

it.each(["search_strings", "search_procedures"] as const)(
  "preserves selected source metadata through the provider's %s regex boundary",
  async (operation) => {
    const config = parseConfig({});
    if (!config.ok) throw config.error;
    const metadata =
      operation === "search_strings"
        ? {
            provider_value: "short display",
            string: {
              encoding: "utf-8",
              encoding_status: "observed",
              termination: "present_or_not_required",
              byte_length: 7,
            },
          }
        : {
            procedure: { external: false, thunk: true, thunk_target: "0x2" },
          };
    const selected = {
      address: "0x1",
      value: "matched",
      ...metadata,
      provider_metadata: { empty: "", absent: null, zero: 0, flag: false },
    };
    const source = [
      { address: "0x1", value: "different" },
      selected,
      { ...selected, value: "matched alternative" },
    ];
    const originalSource = structuredClone(source);
    const callTool = vi
      .spyOn(HopperClient.prototype, "callTool")
      .mockResolvedValue(ok(source));
    const provider = new HopperProvider(
      config.value,
      silentLogger,
      {},
      "linux",
    );
    const client = provider.createClient({
      path: "/tmp/fixture.hop",
      sha256: "a".repeat(64),
      kind: "database",
      format: "analysis-database",
    });
    try {
      const result = await client.execute(operation, {
        pattern: "^matched$",
        mode: "regex",
        case_sensitive: true,
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.result).toEqual([originalSource[1]]);
      expect(callTool).toHaveBeenCalledOnce();
      expect(callTool.mock.calls[0]?.[0]).toBe(
        operation === "search_strings" ? "list_strings" : "list_procedures",
      );
      expect(source).toEqual(originalSource);
    } finally {
      await client.close();
      callTool.mockRestore();
    }
  },
);

it.each(["search_strings", "search_procedures"] as const)(
  "rejects malformed canonical metadata in the %s inventory",
  async (operation) => {
    const search = new HopperRegexSearch({
      callTool: async () =>
        ok([
          {
            address: "0x1",
            value: "matched",
            ...(operation === "search_strings"
              ? { string: { encoding: false } }
              : { procedure: { external: "unknown" } }),
          },
        ]),
    });
    try {
      expect(
        await search.execute(operation, {
          pattern: "matched",
          mode: "regex",
          case_sensitive: true,
        }),
      ).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisOutputError", operation },
      });
    } finally {
      await search.close();
    }
  },
);

it.each(
  (["search_strings", "search_procedures"] as const).flatMap((operation) =>
    (["remote", "capability", "timeout", "process"] as const).map((family) => ({
      operation,
      family,
    })),
  ),
)(
  "attributes $family inventory failure to accepted $operation with live cleanup",
  async ({ operation, family }) => {
    const inventory =
      operation === "search_strings" ? "list_strings" : "list_procedures";
    const diagnostics = {
      provider_request: { operation: inventory, request_id: 17 },
    };
    const context = {
      diagnostics,
      cleanup: {
        reason: "controlled close refusal",
        resources: ["exact-owner"],
      },
      capturedOutput: {
        stdout: "retained stdout",
        stderr: "retained stderr",
        truncated: false,
      },
    };
    const original = {
      remote: () =>
        new HopperRemoteError(-32000, "fixture inventory unavailable", {
          ...context,
          operation: inventory,
          requestId: 17,
          diagnosticType: "bridge_exception",
        }),
      capability: () =>
        new AnalysisCapabilityUnavailableError(
          "hopper",
          inventory,
          "fixture API unavailable",
          context,
        ),
      timeout: () =>
        new HopperTimeoutError(
          42,
          inventory,
          17,
          "busy",
          "analysis",
          undefined,
          context,
        ),
      process: () =>
        new HopperProcessError(7, {
          ...context,
          operation: inventory,
          requestId: 17,
          providerState: "exited",
          stage: "analysis",
        }),
    }[family]();
    const search = new HopperRegexSearch({
      callTool: async (name) => {
        expect(name).toBe(inventory);
        return err(original);
      },
    });
    try {
      const result = await search.execute(operation, {
        pattern: "fixture",
        mode: "regex",
        case_sensitive: false,
      });
      if (result.ok) throw new Error("Expected inventory failure");
      expect(projectAnalysisError(result.error).details).toMatchObject({
        operation,
      });
      expect(result.error._tag).toBe(original._tag);
      if (original instanceof AnalysisCapabilityUnavailableError)
        expect(result.error.diagnostics).toEqual(diagnostics);
      else
        expect(result.error.diagnostics).toMatchObject({
          provider_request: { operation: inventory, request_id: 17 },
          provider_diagnostics: diagnostics,
        });
      expect(result.error.capturedOutput).toEqual(context.capturedOutput);
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(result.error.cleanupResources).toEqual(["exact-owner"]);
      if (result.error instanceof HopperRemoteError)
        expect(result.error).toMatchObject({
          code: -32000,
          safeMessage: "fixture inventory unavailable",
          diagnosticType: "bridge_exception",
          requestId: 17,
        });
      if (result.error instanceof HopperTimeoutError)
        expect(result.error).toMatchObject({
          timeoutMs: 42,
          requestId: 17,
          providerState: "busy",
          stage: "analysis",
        });
      if (result.error instanceof HopperProcessError)
        expect(result.error).toMatchObject({
          exitCode: 7,
          requestId: 17,
          providerState: "exited",
          stage: "analysis",
        });
      expect(original.operation).toBe(inventory);
      original.resolveCleanup();
      expect(result.error.cleanupIncomplete).toBe(false);
    } finally {
      await search.close();
    }
  },
);

it.each(
  [null, "caller stopped", { requested: "stop" }].flatMap((reason) =>
    (["inventory", "progress"] as const).map((stage) => ({ reason, stage })),
  ),
)(
  "keeps the exact reason at $stage completion cancellation",
  async ({ reason, stage }) => {
    const controller = new AbortController();
    const search = new HopperRegexSearch({
      callTool: async () => {
        if (stage === "inventory") controller.abort(reason);
        return ok([]);
      },
    });
    try {
      expect(
        await search.execute(
          "search_strings",
          { pattern: "fixture", mode: "regex", case_sensitive: false },
          {
            signal: controller.signal,
            progress: {
              report: async () => {
                if (stage === "progress") controller.abort(reason);
              },
            },
          },
        ),
      ).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisCancelledError", cause: reason },
      });
    } finally {
      await search.close();
    }
  },
);

it("preserves an inventory failure when cancellation arrives after the physical outcome", async () => {
  const controller = new AbortController();
  const failure = new HopperRemoteError(-32000, "inventory failed", {
    operation: "list_strings",
    requestId: 17,
    diagnosticType: "bridge_exception",
  });
  const search = new HopperRegexSearch({
    callTool: async () => {
      controller.abort("late cancellation");
      return err(failure);
    },
  });
  try {
    const result = await search.execute(
      "search_strings",
      { pattern: "fixture", mode: "regex", case_sensitive: false },
      { signal: controller.signal },
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "HopperRemoteError",
        operation: "search_strings",
        cause: failure,
      },
    });
  } finally {
    await search.close();
  }
});

it("returns cancellation when the caller aborts after the regex worker settles", async () => {
  const controller = new AbortController();
  const reason = { request: "stop search" };
  regexMatch.afterSettle = () => controller.abort(reason);
  const search = new HopperRegexSearch({
    callTool: async () =>
      ok([{ address: "0x1000", value: "fixture" }] as never),
  });
  try {
    const result = await search.execute(
      "search_strings",
      { pattern: "fixture", mode: "regex", case_sensitive: false },
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error._tag).toBe("AnalysisCancelledError");
    expect(result.error.cause).toBe(reason);
  } finally {
    regexMatch.afterSettle = undefined;
    await search.close();
  }
});
