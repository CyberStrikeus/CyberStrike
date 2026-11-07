/** Find a result through native JSON containers without hiding assertion faults. */
export const findClientResult = (value, matches, decodeText = JSON.parse) => {
  if (typeof value === "string") {
    let decoded;
    try {
      decoded = decodeText(value);
    } catch (cause) {
      if (cause instanceof SyntaxError) return undefined;
      throw cause;
    }
    return findClientResult(decoded, matches, decodeText);
  }
  if (value !== null && typeof value === "object") {
    if (matches(value)) return value;
    for (const nested of Object.values(value)) {
      const result = findClientResult(nested, matches, decodeText);
      if (result !== undefined) return result;
    }
  }
  return undefined;
};

/** Empty graphs remain candidates: the assertion owner must reject bad fixtures. */
export const isClientJavaScriptEvidence = (value) =>
  value !== null &&
  typeof value === "object" &&
  typeof value.evidence_id === "string" &&
  Array.isArray(value.normalized_result?.graph?.nodes);
