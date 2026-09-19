export const BLACK_HOUSE_SCOPE = "synthetic-range" as const

export interface BlackHouseAuthorization {
  readonly scope: typeof BLACK_HOUSE_SCOPE
  readonly authorizedRangeId: string
}

export const BLACK_HOUSE_COLLECTIVE_POLICY = Object.freeze({
  networkActuation: false as const,
  publicInternetTargets: false as const,
  credentialOperations: false as const,
  persistence: false as const,
  destructiveActions: false as const,
  dataExfiltration: false as const,
  trafficFlooding: false as const,
})

export function assertBlackHouseAuthorization(input: unknown): asserts input is BlackHouseAuthorization {
  if (!input || typeof input !== "object") throw new TypeError("Black House authorization is required")

  const candidate = input as Partial<BlackHouseAuthorization>
  if (candidate.scope !== BLACK_HOUSE_SCOPE) throw new Error("Black House collective requires synthetic-range scope")
  if (typeof candidate.authorizedRangeId !== "string" || candidate.authorizedRangeId.trim().length === 0) {
    throw new Error("Black House collective requires an authorized range identifier")
  }
}
