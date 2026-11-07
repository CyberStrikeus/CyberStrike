import { expect, it, vi } from "vitest";
import { mcpProgressReporter, type McpProgressContext } from "./mcpProgress.js";

it("emits monotonic MCP progress when a composed workflow starts another phase", async () => {
  const notify = vi.fn().mockResolvedValue(undefined);
  const reporter = mcpProgressReporter({
    mcpReq: { _meta: { progressToken: "token" }, notify },
  } as unknown as McpProgressContext);
  await reporter.report({
    phase: "native",
    completed: 1,
    total: 1,
    message: "complete",
    terminal: true,
  });
  await reporter.report({
    phase: "reconcile",
    completed: 0,
    total: null,
    message: "examined",
    terminal: true,
  });
  expect(notify.mock.calls.map(([message]) => message.params.progress)).toEqual(
    [1, 2],
  );
  expect(notify.mock.calls[1]?.[0].params.message).toBe("reconcile: examined");
});

it("does not emit progress without a negotiated token", async () => {
  const notify = vi.fn();
  const reporter = mcpProgressReporter({
    mcpReq: { _meta: undefined, notify },
  } as unknown as McpProgressContext);
  await reporter.report({
    phase: "native",
    completed: 1,
    total: 1,
    message: "complete",
    terminal: true,
  });
  expect(notify).not.toHaveBeenCalled();
});
