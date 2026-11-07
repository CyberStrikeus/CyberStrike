import { describe, expect, it } from "vitest";

import {
  runDerivedOperation,
  type DerivedOperationContext,
} from "./runDerivedOperation.js";
import { EvidenceIntegrityError } from "../domain/evidenceErrors.js";
import { FUNCTION_COMPARISON_EXAMPLE } from "../contracts/functionComparisonExample.js";
import { EvidenceLedger } from "../application/investigation/EvidenceLedger.js";
import { retainAnalysisResultSources } from "../application/investigation/recordEvidenceSources.js";

const context = (
  controller: AbortController,
  notifications: unknown[] = [],
  onMessage: (message: string) => void = () => undefined,
) => ({
  mcpReq: {
    signal: controller.signal,
    _meta: { progressToken: "derived-test" },
    notify: (notification: unknown) => {
      notifications.push(notification);
      const message = (notification as { params?: { message?: unknown } })
        .params?.message;
      if (typeof message === "string") onMessage(message);
      return Promise.resolve();
    },
  },
});

describe("derived MCP operation boundary", () => {
  it("retains a completed observation and its source after terminal cancellation", async () => {
    const controller = new AbortController();
    const reason = { requested: "completed-evidence-stop" };
    const source = FUNCTION_COMPARISON_EXAMPLE.left;
    const completed = {
      evidence: FUNCTION_COMPARISON_EXAMPLE.right,
      sources: [source],
    };
    const result = await runDerivedOperation(
      context(controller, [], (message) => {
        if (message.startsWith("complete:")) controller.abort(reason);
      }),
      "compare",
      () => completed,
      (value) => value,
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        cause: reason,
        partialObservation: completed.evidence,
      },
      sourceEvidence: [source],
    });
    const ledger = new EvidenceLedger();
    const retained = retainAnalysisResultSources(
      "compare",
      ledger.record.bind(ledger),
      result,
    );
    expect(retained.ok).toBe(false);
    expect(ledger.has(source.evidence_id)).toBe(true);
    expect(retained.ok ? undefined : retained.error.cause).toBe(reason);
  });
});

describe("derived MCP operation progress and cancellation", () => {
  it("cancels before computation and never evaluates the operation", async () => {
    const controller = new AbortController();
    const reason = Object.freeze({ requested: "pre-compute-stop" });
    controller.abort(reason);
    let computed = false;
    const result = await runDerivedOperation(
      context(controller),
      "compare",
      () => {
        computed = true;
        return "impossible";
      },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
    expect(result.ok ? undefined : result.error.cause).toBe(reason);
    expect(computed).toBe(false);
  });

  it("preserves the request's abort reason when cancellation wins after computation", async () => {
    const controller = new AbortController();
    const reason = Object.freeze({ requested: "post-compute-stop" });
    const result = await runDerivedOperation(
      context(controller),
      "compare",
      () => {
        controller.abort(reason);
        return "must-not-publish";
      },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
    expect(result.ok ? undefined : result.error.cause).toBe(reason);
  });

  it("preserves the request's abort reason when cancellation wins at terminal delivery", async () => {
    const controller = new AbortController();
    const reason = Object.freeze({ requested: "terminal-stop" });
    const result = await runDerivedOperation(
      context(controller, [], (message) => {
        if (message.startsWith("complete:")) controller.abort(reason);
      }),
      "compare",
      () => "must-not-publish",
    );

    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
    expect(result.ok ? undefined : result.error.cause).toBe(reason);
  });

  it("lets cancellation win immediately before result publication", async () => {
    const controller = new AbortController();
    const result = await runDerivedOperation(
      context(controller),
      "compare",
      () => {
        controller.abort();
        return "must-not-publish";
      },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
  });

  it("lets cancellation win while terminal progress delivery is pending", async () => {
    const controller = new AbortController();
    let terminalReached = false;
    const notifications: DerivedOperationContext = {
      mcpReq: {
        ...context(controller).mcpReq,
        notify: async (notification) => {
          if (notification.params?.message === "complete: Completed compare") {
            terminalReached = true;
            await Promise.resolve();
            controller.abort();
          }
        },
      },
    };
    const result = await runDerivedOperation(
      notifications,
      "compare",
      () => "must-not-publish",
    );

    expect(terminalReached).toBe(true);
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError", operation: "compare" },
    });
  });

  it("emits bounded monotonic progress with one terminal state", async () => {
    const controller = new AbortController();
    const notifications: Array<{
      params?: { progress?: number; total?: number };
    }> = [];
    const result = await runDerivedOperation(
      context(controller, notifications),
      "compare",
      () => "complete",
    );

    expect(result).toEqual({ ok: true, value: "complete" });
    expect(notifications.map(({ params }) => params?.progress)).toEqual([1, 2]);
    expect(
      notifications.every(({ params }) => params?.total === undefined),
    ).toBe(true);
  });

  it.each([
    new TypeError("internal type failure"),
    new Error("internal computation failure"),
  ])(
    "preserves an untagged computation failure without calling it invalid input: $name",
    async (cause) => {
      await expect(
        runDerivedOperation(
          context(new AbortController()),
          "compare_artifacts",
          () => {
            throw cause;
          },
        ),
      ).rejects.toBe(cause);
    },
  );

  it("preserves a tagged integrity failure instead of replacing it with invalid input", async () => {
    const failure = new EvidenceIntegrityError(
      "Source Evidence does not match its digest",
    );
    const result = await runDerivedOperation(
      context(new AbortController()),
      "compare_artifacts",
      () => {
        throw failure;
      },
    );
    expect(result).toEqual({ ok: false, error: failure });
  });
});
