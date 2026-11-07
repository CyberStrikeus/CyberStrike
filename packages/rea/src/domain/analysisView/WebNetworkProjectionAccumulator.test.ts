import { expect, it } from "vitest";
import { WebNetworkProjectionAccumulator } from "./WebNetworkProjectionAccumulator.js";

class Budget extends WebNetworkProjectionAccumulator {
  constructor() {
    super(100, "Network projection test");
  }

  reserve(bytes: number): boolean {
    return this.temporary(bytes);
  }

  keep(bytes: number): boolean {
    return this.retain(bytes);
  }

  lease(): () => void {
    return this.temporaryCheckpoint();
  }
}

it("keeps an enclosing body's scratch and learned facts charged when a nested lease ends", () => {
  const budget = new Budget();
  const outer = budget.lease();
  expect(budget.reserve(60)).toBe(true);
  const inner = budget.lease();
  expect(budget.reserve(20)).toBe(true);
  expect(budget.keep(10)).toBe(true);
  expect(budget.reserve(11)).toBe(false);
  inner();
  // The outer body and ten retained bytes still occupy seventy bytes.
  expect(budget.reserve(31)).toBe(false);
  outer();
  // Ending the body lease releases scratch, while its learned facts survive.
  expect(budget.reserve(91)).toBe(false);
  expect(budget.reserve(90)).toBe(true);
});
