const HELPER_SUCCESS_WRAPPER = Buffer.from(
  JSON.stringify({ ok: true, result: {} }),
);

/** Scenario output is charged at twice the encoded result size before return. */
export const NATIVE_UI_OUTPUT_BUDGET_BYTES = 64 * 1024 * 1024;
export const NATIVE_UI_OUTPUT_WEIGHT = 2;

/** Bytes added around a result by the helper's success JSON response. */
export const NATIVE_UI_HELPER_ENVELOPE_BYTES =
  HELPER_SUCCESS_WRAPPER.byteLength - Buffer.byteLength("{}");

/** Raw helper output is bounded by the scenario's existing unweighted byte budget. */
export const NATIVE_UI_HELPER_MAX_BUFFER =
  NATIVE_UI_OUTPUT_BUDGET_BYTES + NATIVE_UI_HELPER_ENVELOPE_BYTES;
