import type { ProviderProcessSnapshot } from "./ProviderProcess.js";

/** Redact explicit transport credentials from complete and budget-cut output. */
export const redactCapturedTransportCredential = (
  stream: Pick<
    ProviderProcessSnapshot["stdout"],
    "text" | "bytes" | "observedBytes"
  >,
  token: string | undefined,
  replacement: string,
): string => {
  if (token === undefined || token.length === 0) return stream.text;

  const { text } = stream;
  const cutOff = stream.observedBytes > stream.bytes;
  if (cutOff && !text.endsWith(token)) {
    const maximumPrefixLength = Math.min(text.length, token.length - 1);
    for (
      let prefixLength = maximumPrefixLength;
      prefixLength > 0;
      prefixLength -= 1
    ) {
      if (text.endsWith(token.slice(0, prefixLength)))
        return `${text
          .slice(0, text.length - prefixLength)
          .replaceAll(token, replacement)}${replacement}`;
    }
  }

  return text.replaceAll(token, replacement);
};
