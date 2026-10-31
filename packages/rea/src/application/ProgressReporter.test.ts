import { expect, it } from "vitest";

import { createProgressReporter } from "./ProgressReporter.js";

it("limits intermediate sends to 100 ms and always delivers terminal status", async () => {
  let now = 0;
  const sent: number[] = [];
  const reporter = createProgressReporter(
    async () => {
      sent.push(now);
    },
    { now: () => now },
  );
  for (const [completed, elapsed] of [0, 25, 50, 99, 100, 199, 200].entries()) {
    now = elapsed;
    await reporter.report({
      phase: "running",
      completed,
      total: null,
      message: "Observed capture status",
    });
  }
  expect(sent).toEqual([0, 100, 200]);
  now = 201;
  await reporter.report({
    phase: "cleanup",
    completed: 7,
    total: null,
    message: "Owned cleanup complete",
    terminal: true,
  });
  expect(sent).toEqual([0, 100, 200, 201]);
});
