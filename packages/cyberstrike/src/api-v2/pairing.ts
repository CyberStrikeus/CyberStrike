import { Context } from "effect"

const CODE_TTL = 5 * 60_000
const TOKEN_TTL = 30 * 24 * 60 * 60_000
const CODE_CAP = 10
const FAILURE_LIMIT = 5
const FAILURE_WINDOW = 60_000

const random = (bytes: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url")
const hash = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex")

// Only hashes of codes and tokens are kept. Codes are single use and expire; tokens expire after 30 days.
// The clock is injected so expiry can be exercised without waiting.
export function pairing(clock: () => number = () => Date.now()) {
  const codes = new Map<string, number>()
  const tokens = new Map<string, number>()
  const failures = new Map<string, number[]>()

  const prune = (now: number) => {
    codes.forEach((expires, key) => {
      if (expires <= now) codes.delete(key)
    })
    tokens.forEach((expires, key) => {
      if (expires <= now) tokens.delete(key)
    })
    failures.forEach((times, peer) => {
      const recent = times.filter((time) => now - time < FAILURE_WINDOW)
      if (recent.length === 0) failures.delete(peer)
      else failures.set(peer, recent)
    })
  }

  return {
    issue() {
      const now = clock()
      prune(now)
      // The cap evicts the oldest outstanding code, which is the first key in insertion order.
      if (codes.size >= CODE_CAP) {
        const [oldest] = codes.keys()
        codes.delete(oldest)
      }
      const code = random(16)
      codes.set(hash(code), now + CODE_TTL)
      return { code, expires_in: CODE_TTL / 1000 }
    },
    limited(peer: string) {
      const now = clock()
      prune(now)
      return (failures.get(peer)?.length ?? 0) >= FAILURE_LIMIT
    },
    // A code is burned on the first attempt, whether it succeeds or not. Wrong or expired codes count as failures.
    redeem(code: string, peer: string) {
      const now = clock()
      prune(now)
      const key = hash(code)
      const expires = codes.get(key)
      codes.delete(key)
      if (expires !== undefined && expires > now) {
        const token = random(32)
        tokens.set(hash(token), now + TOKEN_TTL)
        return token
      }
      failures.set(peer, [...(failures.get(peer) ?? []), now])
      return undefined
    },
    valid(token: string) {
      const expires = tokens.get(hash(token))
      return expires !== undefined && expires > clock()
    },
  }
}

export class Pairing extends Context.Service<Pairing, ReturnType<typeof pairing>>()("@cyberstrike/api-v2/Pairing") {}
