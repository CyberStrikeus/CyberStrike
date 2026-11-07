import { expect, it } from "vitest";

import { explicitSetupRegistrationEnvironment } from "../application/SetupRegistrationEnvironment.js";
import {
  DEFAULT_HOPPER_CALLER_SCAN_BUDGET_MS,
  MAX_NODE_TIMER_DELAY_MS,
  MINIMUM_HOPPER_CALLER_SCAN_BUDGET_MS,
} from "../domain/analysisResourceLimits.js";
import {
  HOPPER_CALLER_PAGE_ALLOWANCE_BYTES,
  type HopperCallerScanFacts,
} from "../domain/native/hopperCallerReconciliation.js";
import { parseConfig } from "./parseConfig.js";
import {
  HOPPER_CALLER_SCAN_BUDGET_SETTING,
  hopperCallerScanRecovery,
} from "./hopperCallerScanBudget.js";

const facts = (
  overrides: Partial<HopperCallerScanFacts> &
    Pick<HopperCallerScanFacts, "stop">,
): HopperCallerScanFacts => ({
  examined_procedures: 1,
  procedure_total: 2,
  retained_bytes: 32,
  instructions_complete: true,
  native_callers_complete: true,
  ...overrides,
});

it("records the default caller-scan budget and forwards an explicit setting", () => {
  const unset = parseConfig({});
  if (!unset.ok) throw unset.error;
  expect(unset.value.hopperCallerScanBudget).toMatchObject({
    milliseconds: DEFAULT_HOPPER_CALLER_SCAN_BUDGET_MS,
    source: "default",
    floorMilliseconds: MINIMUM_HOPPER_CALLER_SCAN_BUDGET_MS,
    maximumMilliseconds: MAX_NODE_TIMER_DELAY_MS,
  });
  const selected = parseConfig({
    [HOPPER_CALLER_SCAN_BUDGET_SETTING]: "250",
  });
  if (!selected.ok) throw selected.error;
  expect(selected.value.hopperCallerScanBudget).toMatchObject({
    milliseconds: 250,
    source: "setting",
  });
  expect(
    explicitSetupRegistrationEnvironment({
      [HOPPER_CALLER_SCAN_BUDGET_SETTING]: "250",
      UNRELATED: "dropped",
    }),
  ).toEqual({ [HOPPER_CALLER_SCAN_BUDGET_SETTING]: "250" });
});

it("explains the time budget and that fixed byte allowances have no override", () => {
  const parsed = parseConfig({ [HOPPER_CALLER_SCAN_BUDGET_SETTING]: "250" });
  if (!parsed.ok) throw parsed.error;
  const budget = parsed.value.hopperCallerScanBudget;
  const time = hopperCallerScanRecovery(
    facts({ stop: { code: "work_budget", budget_ms: 250 } }),
    budget,
  );
  expect(time).toContain(`${HOPPER_CALLER_SCAN_BUDGET_SETTING} is 250 ms`);
  expect(time).toContain(
    `The default is ${String(DEFAULT_HOPPER_CALLER_SCAN_BUDGET_MS)} ms`,
  );
  expect(time).toContain(
    `from ${String(MINIMUM_HOPPER_CALLER_SCAN_BUDGET_MS)} to ${String(MAX_NODE_TIMER_DELAY_MS)} ms`,
  );
  expect(time).toContain("no runtime override");
  expect(time).toContain(
    `${HOPPER_CALLER_SCAN_BUDGET_SETTING} does not raise them`,
  );
  const page = hopperCallerScanRecovery(
    facts({
      stop: {
        code: "page_allowance",
        allowance_bytes: HOPPER_CALLER_PAGE_ALLOWANCE_BYTES,
      },
    }),
    budget,
  );
  expect(page).toContain("no runtime override");
  expect(page).toContain(
    `${HOPPER_CALLER_SCAN_BUDGET_SETTING} does not raise them`,
  );
  expect(page).not.toContain("is 250 ms");
  expect(
    hopperCallerScanRecovery(facts({ stop: { code: "complete" } }), budget),
  ).toBe("");
});
