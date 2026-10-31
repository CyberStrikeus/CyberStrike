/** Keep a UTF-8 string within a byte budget without cutting a code point. */
export const boundedUtf8Text = (
  value: string,
  maximumBytes: number,
): { readonly text: string; readonly truncated: boolean } => {
  let bytes = 0;
  let end = 0;
  for (const codePoint of value) {
    const codePointBytes = Buffer.byteLength(codePoint, "utf8");
    if (bytes + codePointBytes > maximumBytes)
      return { text: value.slice(0, end), truncated: true };
    bytes += codePointBytes;
    end += codePoint.length;
  }
  return { text: value, truncated: false };
};
