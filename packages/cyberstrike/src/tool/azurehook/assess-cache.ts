import type { AssessResult } from "./assess/types"

const cache = new Map<string, AssessResult>()

export function storeAssessResult(sessionID: string, result: AssessResult) {
  cache.set(sessionID, result)
}

export function getAssessResult(sessionID: string): AssessResult | undefined {
  return cache.get(sessionID)
}
