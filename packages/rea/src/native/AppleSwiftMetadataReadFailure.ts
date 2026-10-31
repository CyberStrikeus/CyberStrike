/** Expected format-boundary failures from bounded Swift metadata reads. */
export const expectedSwiftMetadataReadFailure = (
  cause: unknown,
): string | null => {
  if (cause instanceof RangeError) return cause.message;
  if (
    cause instanceof TypeError &&
    "code" in cause &&
    cause.code === "ERR_ENCODING_INVALID_ENCODED_DATA"
  )
    return cause.message;
  return null;
};
