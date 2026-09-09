import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { chainRules, compileChain } from "../src/index"

const [crossId, resetToken] = chainRules.map(compileChain)
function tx(id: string, url: string, identity: string | undefined, resp: Transaction["response"]): Transaction {
  return { id, source: "browser", host: "app.test", identity, request: { method: "GET", url: `https://app.test${url}`, headers: [] }, response: resp }
}
const ok = (body: string): Transaction["response"] => ({ status: 200, headers: [], body })

describe("chain catalog — cross-transaction correlation", () => {
  test("cross-identity-value-reuse: A's value reused in B's request under a DIFFERENT identity", () => {
    const owner = tx("owner", "/api/accounts/9988", "org1", ok('{"account_id":"ACC-9988-XYZ"}')) // correlatable value
    const attacker = tx("attacker", "/api/accounts?account=ACC-9988-XYZ", "org2", ok('{"balance":100}')) // org2 reuses it, 200
    expect(crossId!.evaluate([owner, attacker]).map((s) => s.ruleId)).toEqual(["cross-identity-value-reuse"])
  })
  test("cross-identity does NOT fire when the SAME identity reuses the value (normal flow)", () => {
    const a = tx("a", "/api/accounts/9988", "org1", ok('{"account_id":"ACC-9988-XYZ"}'))
    const b = tx("b", "/api/accounts?account=ACC-9988-XYZ", "org1", ok('{"balance":100}')) // same identity
    expect(crossId!.evaluate([a, b])).toHaveLength(0)
  })
  test("reset-token-leak-reuse: a token field leaked then reused downstream", () => {
    const leak = tx("leak", "/api/forgot", undefined, ok('{"reset_token":"RESETabc123XYZ789"}')) // 17-char correlatable token
    const use = tx("use", "/api/reset?token=RESETabc123XYZ789", undefined, ok('{"ok":true}'))
    expect(resetToken!.evaluate([leak, use]).map((s) => s.ruleId)).toEqual(["reset-token-leak-reuse"])
  })
  test("reset-token does NOT fire when the leaking response has no token field (ordinary value flow)", () => {
    const leak = tx("leak", "/api/data", undefined, ok('{"data":"RESETabc123XYZ789"}')) // value present but not a token FIELD
    const use = tx("use", "/api/x?ref=RESETabc123XYZ789", undefined, ok("{}"))
    expect(resetToken!.evaluate([leak, use])).toHaveLength(0)
  })
})
