import z from "zod"
import { Tool } from "./tool"
import { OobStore } from "../oob/store"
import { Oob } from "../oob/client"

// Out-of-band interaction tools (#85) — confirm BLIND vulnerabilities. A subagent mints a unique OOB
// host with oob_generate, injects it into the target (SSRF URL, command `nslookup`/`curl`, XXE SYSTEM,
// OOB-SQLi/SSTI payload, exfil channel), then polls oob_check: a captured DNS/HTTP callback = proof.

// Read interactions + resolve the base domain through the shared OOB client (#89) — in-process store or
// a remote OOB server's API (CYBERSTRIKE_OOB_API), one source of truth shared with the SSRF probe.
const readInteractions = (token: string): Promise<OobStore.Interaction[]> => Oob.readInteractions(token)
const domain = (): string | undefined => Oob.domain()

export const OobGenerateTool = Tool.define("oob_generate", {
  description: [
    "Mint a UNIQUE out-of-band host to confirm a BLIND vulnerability. Returns a domain to inject into the",
    "target (a DNS lookup or HTTP request TO it proves the target reached you). Then poll `oob_check` with",
    "the returned token. Use for: blind SSRF (fetch the URL), blind command injection (`nslookup`/`curl`",
    "the host), blind XXE (SYSTEM entity), OOB SQLi/SSTI (DNS/HTTP exfil), and DNS-exfil channels.",
  ].join("\n"),
  parameters: z.object({}),
  async execute() {
    const d = domain()
    if (!d) {
      return {
        title: "oob_generate — unavailable",
        output: "No OOB server is configured (CYBERSTRIKE_OOB_DOMAIN unset). Confirm blind findings another way (e.g. time-based) or request OOB setup.",
        metadata: {},
      }
    }
    const token = OobStore.mint()
    const host = `${token}.${d}`
    return {
      title: "oob_generate",
      output: [
        `OOB host: ${host}`,
        `token: ${token}`,
        "",
        `Inject it, e.g.:  http://${host}/  ·  https://${host}/x  ·  nslookup ${host}  ·  SYSTEM "http://${host}/e"`,
        `Then call oob_check {token: "${token}"} — a DNS or HTTP hit on it confirms the blind vuln.`,
      ].join("\n"),
      metadata: {},
    }
  },
})

export const OobCheckTool = Tool.define("oob_check", {
  description:
    "Check for out-of-band interactions captured for an oob_generate token. A DNS and/or HTTP hit is PROOF the target reached your OOB host (the blind vuln fired). No hits yet = not confirmed (the payload may need time, or did not fire).",
  parameters: z.object({
    token: z.string().describe("The token returned by oob_generate."),
  }),
  async execute(params) {
    const hits = await readInteractions(params.token)
    if (hits.length === 0) {
      return {
        title: "oob_check — no interactions",
        output: `No OOB callback for ${params.token} yet. Not confirmed. If the payload may be slow/queued, retry shortly; otherwise it did not fire — try another injection point/encoding.`,
        metadata: { token: params.token, count: 0 },
      }
    }
    const lines = hits
      .slice(-20)
      .map((h) => `- ${new Date(h.at).toISOString()} · ${h.protocol.toUpperCase()} · from ${h.remoteAddr} · ${h.detail}`)
    return {
      title: `oob_check — ${hits.length} interaction${hits.length === 1 ? "" : "s"} (CONFIRMED)`,
      output: [
        `CONFIRMED: the target reached your OOB host — the blind vulnerability fired.`,
        ...lines,
        "",
        "Report this with the callback(s) as evidence (protocol + source IP + timestamp).",
      ].join("\n"),
      metadata: { token: params.token, count: hits.length },
    }
  },
})
