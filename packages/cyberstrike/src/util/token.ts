export namespace Token {
  const RATIOS: Record<string, number> = {
    anthropic: 3.5,
    openai: 3.5,
    deepseek: 3.3,
    google: 3.5,
    default: 3.5,
  }

  export function estimate(input: string, providerID?: string): number {
    const ratio = RATIOS[providerID ?? "default"] ?? RATIOS["default"]
    return Math.max(0, Math.round((input || "").length / ratio))
  }
}
