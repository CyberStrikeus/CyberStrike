import { AnalysisResourceConstraintError } from "../domain/analysisErrorCore.js";
import { fixedAllowanceOptions } from "../domain/fixedAllowanceRemediation.js";
import { WASM_INTERFACE_REPRESENTATION_BYTES } from "../domain/wasm/wasmInterface.js";

/** Eager typed observations share the existing WABT output capacity, not an agent token estimate. */
export class WasmInterfaceBudget {
  #remaining = WASM_INTERFACE_REPRESENTATION_BYTES;
  reserve(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.#remaining)
      throw new AnalysisResourceConstraintError(
        "inspect_wasm_artifact",
        "capacity",
        "Typed WASM interface decoding exceeds the WABT output representation budget",
        { maximum_bytes: WASM_INTERFACE_REPRESENTATION_BYTES },
        fixedAllowanceOptions("The typed WASM interface inventory", "bytes"),
      );
    this.#remaining -= bytes;
  }
}
