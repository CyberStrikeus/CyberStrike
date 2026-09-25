export namespace Token {
  const RATIOS: Record<string, number> = {
    anthropic: 3.5,
    openai: 3.5,
    deepseek: 3.3,
    google: 3.5,
    default: 3.5,
  }

  // Base64 data URIs (embedded images/files, e.g. from the `read` tool's
  // attachments) are not proportional to their encoded character length once
  // tokenized by the model — a vision model tokenizes pixels/patches, not
  // base64 text. Counting raw base64 length at the text ratio above
  // overestimates image-bearing messages by 2-3 orders of magnitude, which
  // can trigger the pre-flight overflow check (session/prompt.ts) and force
  // compaction on turns that are nowhere near the real context limit.
  //
  // Strip data URIs out of the character count and charge a flat
  // per-attachment estimate instead. 1600 is a conservative middle-of-the-
  // road approximation for a single image across common vision APIs; exact
  // cost varies by resolution/provider, but it is orders of magnitude closer
  // to reality than counting the base64 text itself.
  const DATA_URI = /data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g
  const ESTIMATED_TOKENS_PER_ATTACHMENT = 1600

  export function estimate(input: string, providerID?: string): number {
    const ratio = RATIOS[providerID ?? "default"] ?? RATIOS["default"]
    const text = input || ""
    let attachments = 0
    const stripped = text.replace(DATA_URI, () => {
      attachments++
      return ""
    })
    const textTokens = Math.round(stripped.length / ratio)
    const attachmentTokens = attachments * ESTIMATED_TOKENS_PER_ATTACHMENT
    return Math.max(0, textTokens + attachmentTokens)
  }
}
