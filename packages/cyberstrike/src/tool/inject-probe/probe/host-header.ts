// Host Header Injection probe (WSTG-INPV-17). Sends the request with a spoofed forwarding-host header
// set to a unique marker domain and checks whether the app REFLECTS that domain into an absolute URL in
// the body (password-reset-link poisoning), the Location redirect, or a Set-Cookie domain — the
// deterministic proof the app trusts a client-controlled host. Request-level (not point-based).
//
// NOTE: the real `Host:` line can't be tampered through the send layer (it strips Host and pins it to
// the in-scope URL), so this targets the headers apps actually mis-trust — X-Forwarded-Host & friends,
// which is the common real-world vector for reset-poisoning and web-cache poisoning.
import type { ResolvedRequest, SendBudget } from "../types"
import { send, nonce, type HttpSender } from "../send"
import { looksBlocked } from "../detect"
import { sleep, type BackoffState, recordBlock, recordSuccess } from "./base"

export interface HostHeaderObservation {
  point: string // "host-header"
  reflected: { header: string; where: "body" | "location" | "set-cookie"; evidence: string }[]
  tried: number
  blocked: boolean
  block_signal?: string
  note?: string
}

// header name → how to render the spoofed value (most take the bare host; Forwarded uses host=<v>).
const SPOOF_HEADERS: { name: string; render: (v: string) => string }[] = [
  { name: "x-forwarded-host", render: (v) => v },
  { name: "x-forwarded-server", render: (v) => v },
  { name: "x-host", render: (v) => v },
  { name: "x-original-host", render: (v) => v },
  { name: "x-http-host-override", render: (v) => v },
  { name: "forwarded", render: (v) => `host=${v}` },
]

export const HOST_HEADER_NOT_TESTED =
  "host-header: real Host: line tampering (send layer pins it to the in-scope host); dangling-markup / password-reset flow chaining; web-cache-poisoning cache-key analysis"

export async function probeHostHeader(
  sender: HttpSender,
  r: ResolvedRequest,
  abort: AbortSignal,
  delayMs: number,
  budget: SendBudget,
  backoff?: BackoffState,
): Promise<HostHeaderObservation> {
  const obs: HostHeaderObservation = { point: "host-header", reflected: [], tried: 0, blocked: false }
  for (const spoof of SPOOF_HEADERS) {
    if (abort.aborted || budget.sent >= budget.max) break
    const marker = `ma${nonce()}.poison.test` // a distinctive, unmistakable attacker host
    const headers = { ...r.headers, [spoof.name]: spoof.render(marker) }
    const res = await send(sender, r, { url: r.url.toString(), body: r.body, headers }, abort, budget)
    obs.tried++
    if ("error" in res) continue
    if (looksBlocked(res.status)) {
      obs.blocked = true
      if (backoff && recordBlock(backoff) === "skip-point") break
      continue
    }
    if (backoff) recordSuccess(backoff)
    // Location redirect to our host = redirect/reset poisoning; marker in an absolute link in the body =
    // reset-link / cache poisoning; marker in Set-Cookie Domain = cookie-scope poisoning.
    const loc = res.headers["location"]
    if (loc && loc.includes(marker)) obs.reflected.push({ header: spoof.name, where: "location", evidence: `Location: ${loc}`.slice(0, 200) })
    else if (res.text.includes(marker)) obs.reflected.push({ header: spoof.name, where: "body", evidence: excerpt(res.text, marker) })
    else {
      const sc = res.headers["set-cookie"]
      if (sc && sc.includes(marker)) obs.reflected.push({ header: spoof.name, where: "set-cookie", evidence: `Set-Cookie: ${sc}`.slice(0, 200) })
    }
    await sleep(backoff?.delay ?? delayMs)
  }
  return obs
}

function excerpt(text: string, needle: string): string {
  const i = text.indexOf(needle)
  if (i === -1) return needle
  return text.slice(Math.max(0, i - 40), i + needle.length + 40)
}
