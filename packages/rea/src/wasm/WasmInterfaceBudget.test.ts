import { expect, it } from "vitest";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { WASM_INTERFACE_REPRESENTATION_BYTES } from "../domain/wasm/wasmInterface.js";
import { WasmInterfaceBudget } from "./WasmInterfaceBudget.js";

it("refuses typed WASM interface growth without asking the caller to wait", () => {
  const budget = new WasmInterfaceBudget();
  expect(() =>
    budget.reserve(WASM_INTERFACE_REPRESENTATION_BYTES + 1),
  ).toThrowError();
  try {
    budget.reserve(WASM_INTERFACE_REPRESENTATION_BYTES + 1);
    throw new Error("Expected a representation refusal");
  } catch (error) {
    const projected = projectAnalysisError(
      error as Parameters<typeof projectAnalysisError>[0],
    );
    expect(projected).toMatchObject({
      retryable: false,
      details: {
        resource: "capacity",
        reported_limits: {
          maximum_bytes: WASM_INTERFACE_REPRESENTATION_BYTES,
        },
      },
    });
    expect(projected.remediation.action).toContain(
      "typed WASM interface inventory",
    );
    expect(projected.remediation.action).toContain("fixed byte allowance");
    expect(projected.remediation.action).not.toContain("fixed count");
    expect(projected.remediation.action).not.toMatch(
      /Wait for an active analysis/u,
    );
  }
});
