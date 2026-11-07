import { expect, it } from "vitest";
import {
  forgetChecked,
  runningAt,
  touchTarget,
  WriteEffects,
  type PendingTargets,
  type TouchedTargets,
} from "./environmentStateWriteAttribution.js";

it("keeps an unknown write completion pending alongside later known completions", () => {
  const touched: TouchedTargets = new Map();
  const pending: PendingTargets = new Map();
  for (const [index, end] of [undefined, 20].entries())
    touchTarget(touched, pending, "entity", {
      index,
      tool: `write-${String(index)}`,
      end,
      fields: ["name"],
    });
  expect(runningAt(pending, "entity", 30)).toBe(true);
  expect(runningAt(pending, "entity", undefined)).toBe(true);
  expect(runningAt(pending, "absent", undefined)).toBe(false);
  forgetChecked(
    { touched, since: pending, effects: new WriteEffects() },
    "entity",
    undefined,
  );
  expect(runningAt(pending, "entity", 30)).toBe(false);
});

it("requires a known read start to establish a known pending write completed", () => {
  const touched: TouchedTargets = new Map();
  const pending: PendingTargets = new Map();
  touchTarget(touched, pending, "entity", {
    index: 0,
    tool: "write",
    end: 20,
    fields: ["name"],
  });
  expect(runningAt(pending, "entity", undefined)).toBe(true);
  expect(runningAt(pending, "entity", 19)).toBe(true);
  expect(runningAt(pending, "entity", 20)).toBe(false);
});
