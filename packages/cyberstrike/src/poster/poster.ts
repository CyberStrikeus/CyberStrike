import satori from "satori"
import { Resvg } from "@resvg/resvg-js"
import { readFileSync } from "fs"
import { join } from "path"

const fontDir = join(import.meta.dirname, "fonts")
const spaceRegular = readFileSync(join(fontDir, "SpaceGrotesk-Regular.ttf"))
const spaceBold = readFileSync(join(fontDir, "SpaceGrotesk-Bold.ttf"))
const interRegular = readFileSync(join(fontDir, "Inter-Regular.woff"))
const logoUri = readFileSync(join(fontDir, "logo-white-uri.txt"), "utf8").trim()

const WIDTH = 1200
const HEIGHT = 630

const BG = "#081221"
const INK = "#EAF1FB"
const MUTED = "#8296B8"
const CYAN = "#54B8F2"
const LINE = "rgba(126,158,214,0.16)"

const sevMap: Record<string, { col: string; dark: string; dim: string; label: string }> = {
  critical: { col: "#FF3B4E", dark: "#B01E2E", dim: "rgba(255,59,78,0.16)", label: "CRITICAL" },
  high: { col: "#FF8A3D", dark: "#C25A17", dim: "rgba(255,138,61,0.16)", label: "HIGH" },
  medium: { col: "#F5C542", dark: "#C79512", dim: "rgba(245,197,66,0.15)", label: "MEDIUM" },
  low: { col: "#54B8F2", dark: "#2E7FB0", dim: "rgba(84,184,242,0.15)", label: "LOW" },
  info: { col: "#7C8CA8", dark: "#4A5A74", dim: "rgba(124,140,168,0.14)", label: "INFO" },
}

export interface PosterParams {
  title: string
  severity: string
  description: string
  ref?: string
  cwe?: string
  endpoint?: string
  cvss?: string
  attack?: string
  verified?: boolean
  date?: string
}

function redact(endpoint: string): string {
  try {
    const u = new URL(endpoint.startsWith("http") ? endpoint : `https://${endpoint}`)
    return `████████${u.pathname}${u.search}`
  } catch {
    return endpoint.replace(/^(https?:\/\/)?[^/]+/, "████████")
  }
}

function scrub(text: string): string {
  return text
    .replace(/https?:\/\/[^\s)>\]"']+/g, (m) => {
      try {
        const u = new URL(m)
        return `████████${u.pathname}${u.search}`
      } catch {
        return "████████"
      }
    })
    .replace(/[a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)+\.[a-zA-Z]{2,}/g, "████████")
}

function cvss(raw?: string): string | undefined {
  if (!raw) return undefined
  const m = raw.match(/(\d+\.?\d*)/)
  return m ? m[1] : undefined
}

function fmtDate(iso?: string): string {
  if (!iso) return new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" })
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function buildCard(p: PosterParams) {
  const sev = sevMap[p.severity.toLowerCase()] ?? sevMap.info
  const valStyle = { fontSize: "22px", fontWeight: 700 as const, color: "#fff", letterSpacing: "-0.02em" }
  const smallStyle = { fontSize: "12px", color: MUTED, fontWeight: 600 as const, letterSpacing: "0.06em", textTransform: "uppercase" as const }

  const cells: { label: string; value: string; color?: string }[] = []
  if (p.cwe) cells.push({ label: "Weakness", value: p.cwe })
  const score = cvss(p.cvss)
  if (score) cells.push({ label: "CVSS", value: score, color: CYAN })
  if (p.attack) cells.push({ label: "Vector", value: p.attack })
  if (p.endpoint) cells.push({ label: "Target", value: scrub(redact(p.endpoint)) })
  cells.push({ label: "Found", value: fmtDate(p.date) })

  const stripCells = cells.slice(0, 5).map((c, i) => ({
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column" as const,
        justifyContent: "center" as const,
        gap: "8px",
        flex: "1",
        padding: "0 28px",
        ...(i > 0 ? { borderLeft: `1px solid ${LINE}` } : {}),
        height: "64px",
      },
      children: [
        { type: "div", props: { style: smallStyle, children: c.label } },
        { type: "div", props: { style: { ...valStyle, color: c.color ?? "#fff" }, children: c.value } },
      ],
    },
  }))

  return {
    type: "div",
    props: {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        background: BG,
        fontFamily: "Space Grotesk",
        color: INK,
        position: "relative" as const,
        overflow: "hidden" as const,
      },
      children: [
        // Severity glow top-right
        {
          type: "div",
          props: {
            style: {
              position: "absolute" as const,
              top: "-120px",
              right: "-80px",
              width: "600px",
              height: "500px",
              borderRadius: "50%",
              background: sev.dim,
              filter: "blur(80px)",
            },
          },
        },
        // Blue glow bottom-left
        {
          type: "div",
          props: {
            style: {
              position: "absolute" as const,
              bottom: "-80px",
              left: "-60px",
              width: "400px",
              height: "350px",
              borderRadius: "50%",
              background: "rgba(84,184,242,0.08)",
              filter: "blur(80px)",
            },
          },
        },
        // Grid pattern
        {
          type: "div",
          props: {
            style: {
              position: "absolute" as const,
              top: "0",
              left: "0",
              right: "0",
              bottom: "0",
              backgroundImage:
                "linear-gradient(rgba(126,158,214,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(126,158,214,0.06) 1px, transparent 1px)",
              backgroundSize: "60px 60px",
            },
          },
        },
        // Left edge severity bar
        {
          type: "div",
          props: {
            style: {
              position: "absolute" as const,
              left: "0",
              top: "0",
              bottom: "0",
              width: "8px",
              background: `linear-gradient(180deg, ${sev.col}, ${sev.dark})`,
            },
          },
        },
        // Inner content
        {
          type: "div",
          props: {
            style: {
              position: "relative" as const,
              display: "flex",
              flexDirection: "column" as const,
              height: `${HEIGHT}px`,
              padding: "36px 56px 0 64px",
              width: "100%",
              boxSizing: "border-box" as const,
            },
            children: [
              // === TOP BAR: brand + verified badge ===
              {
                type: "div",
                props: {
                  style: { display: "flex", alignItems: "center" as const, justifyContent: "space-between" as const },
                  children: [
                    // Brand
                    {
                      type: "div",
                      props: {
                        style: { display: "flex", alignItems: "center" as const, gap: "12px" },
                        children: [
                          {
                            type: "img",
                            props: {
                              src: logoUri,
                              width: 40,
                              height: 40,
                              style: { width: "40px", height: "40px" },
                            },
                          },
                          {
                            type: "div",
                            props: {
                              style: { display: "flex", flexDirection: "column" as const },
                              children: [
                                { type: "div", props: { style: { fontSize: "18px", fontWeight: 700, color: "#fff", lineHeight: "1.2" }, children: "CyberStrike" } },
                                { type: "div", props: { style: { fontSize: "12px", color: MUTED, lineHeight: "1.3" }, children: "Security Testing" } },
                              ],
                            },
                          },
                        ],
                      },
                    },
                    // Verified badge
                    ...(p.verified
                      ? [
                          {
                            type: "div",
                            props: {
                              style: {
                                display: "flex",
                                alignItems: "center" as const,
                                gap: "8px",
                                padding: "8px 16px",
                                borderRadius: "999px",
                                background: "rgba(84,184,242,0.12)",
                                border: "1px solid rgba(84,184,242,0.35)",
                              },
                              children: [
                                { type: "div", props: { style: { width: "8px", height: "8px", borderRadius: "50%", background: CYAN } } },
                                { type: "div", props: { style: { fontSize: "13px", fontWeight: 600, color: CYAN, letterSpacing: "0.02em" }, children: "Verified Finding" } },
                              ],
                            },
                          },
                        ]
                      : []),
                  ],
                },
              },

              // === REF + SEVERITY ROW ===
              {
                type: "div",
                props: {
                  style: { display: "flex", alignItems: "center" as const, gap: "16px", marginTop: "24px" },
                  children: [
                    // Severity badge
                    {
                      type: "div",
                      props: {
                        style: {
                          padding: "7px 14px",
                          borderRadius: "7px",
                          background: sev.col,
                          color: "#fff",
                          fontSize: "15px",
                          fontWeight: 700,
                          letterSpacing: "0.08em",
                        },
                        children: sev.label,
                      },
                    },
                    // Ref
                    ...(p.ref
                      ? [
                          {
                            type: "div",
                            props: {
                              style: { fontSize: "18px", fontWeight: 600, color: MUTED, fontFamily: "Inter" },
                              children: p.ref,
                            },
                          },
                        ]
                      : []),
                  ],
                },
              },

              // === TITLE ===
              {
                type: "div",
                props: {
                  style: {
                    marginTop: "16px",
                    fontSize: p.title.length > 40 ? "44px" : "52px",
                    fontWeight: 700,
                    letterSpacing: "-0.03em",
                    lineHeight: "1.15",
                    color: "#fff",
                    maxWidth: "1000px",
                    overflow: "hidden" as const,
                    textOverflow: "ellipsis" as const,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical" as const,
                  },
                  children: p.title,
                },
              },

              // === DESCRIPTION ===
              {
                type: "div",
                props: {
                  style: {
                    marginTop: "18px",
                    fontSize: "19px",
                    fontFamily: "Space Grotesk",
                    color: "#C4D2E8",
                    lineHeight: "1.55",
                    maxWidth: "880px",
                    overflow: "hidden" as const,
                    textOverflow: "ellipsis" as const,
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical" as const,
                  },
                  children: scrub(p.description).slice(0, 280),
                },
              },

              // === BOTTOM STRIP + FOOTER ===
              {
                type: "div",
                props: {
                  style: {
                    marginTop: "auto",
                    display: "flex",
                    flexDirection: "column" as const,
                    flexShrink: 0,
                  },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: {
                          display: "flex",
                          alignItems: "center" as const,
                          borderTop: `1px solid ${LINE}`,
                          height: "90px",
                        },
                        children: stripCells,
                      },
                    },
                    {
                      type: "div",
                      props: {
                        style: {
                          display: "flex",
                          alignItems: "center" as const,
                          justifyContent: "space-between" as const,
                          borderTop: `1px solid ${LINE}`,
                          padding: "10px 0",
                        },
                        children: [
                          { type: "div", props: { style: { fontSize: "13px", color: MUTED, fontWeight: 600 }, children: "cyberstrike.io" } },
                          { type: "div", props: { style: { fontSize: "12px", color: MUTED }, children: "AI-Powered Security Testing" } },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  }
}

export function tweet(p: PosterParams): string {
  const sev = p.severity.toUpperCase()
  const icon = sev === "CRITICAL" ? "🔴" : sev === "HIGH" ? "🟠" : sev === "MEDIUM" ? "🟡" : "🔵"
  const parts = [`${icon} ${sev}: ${p.title}`]
  const tweetScore = cvss(p.cvss)
  if (tweetScore) parts.push(`CVSS ${tweetScore}`)
  if (p.cwe) parts.push(p.cwe)
  parts.push("")
  const desc = scrub(p.description)
  parts.push(desc.length > 180 ? desc.slice(0, 177) + "..." : desc)
  parts.push("")
  if (p.verified) parts.push("✅ Verified finding")
  parts.push("#bugbounty #pentest #appsec #cybersecurity #infosec")
  parts.push("")
  parts.push("Found with @CyberStrike_io")
  return parts.join("\n")
}

export function blog(p: PosterParams): string {
  const lines: string[] = []
  lines.push(`# ${p.ref ? `[${p.ref}] ` : ""}${p.title}`)
  lines.push("")
  const blogScore = cvss(p.cvss)
  lines.push(`**Severity:** ${p.severity.toUpperCase()}${blogScore ? ` (CVSS ${blogScore})` : ""}`)
  if (p.cwe) lines.push(`**Weakness:** ${p.cwe}`)
  if (p.attack) lines.push(`**Attack Vector:** ${p.attack}`)
  if (p.endpoint) lines.push(`**Target:** ${scrub(redact(p.endpoint))}`)
  if (p.date) lines.push(`**Found:** ${fmtDate(p.date)}`)
  if (p.verified) lines.push(`**Status:** ✅ Verified`)
  lines.push("")
  lines.push("---")
  lines.push("")
  lines.push("## Summary")
  lines.push("")
  lines.push(scrub(p.description))
  lines.push("")
  lines.push("## Impact")
  lines.push("")
  lines.push(`This ${p.severity.toLowerCase()} severity vulnerability${blogScore ? ` (CVSS ${blogScore})` : ""} could allow an attacker to compromise the security of the affected application.${p.attack ? ` The attack vector is ${p.attack.toLowerCase()}-based, making it ${p.attack.toLowerCase() === "network" ? "remotely exploitable" : "exploitable with " + p.attack.toLowerCase() + " access"}.` : ""}`)
  lines.push("")
  lines.push("## Recommendation")
  lines.push("")
  lines.push("- Implement proper input validation and output encoding")
  lines.push("- Follow secure coding best practices")
  lines.push("- Apply the principle of least privilege")
  lines.push("- Regular security testing and code review")
  lines.push("")
  lines.push("---")
  lines.push("")
  lines.push(`*Found by [CyberStrike](https://cyberstrike.io) — AI-Powered Security Testing*`)
  return lines.join("\n")
}

export interface PosterOutput {
  png: Buffer
  tweet: string
  markdown: string
  slug: string
}

export async function generate(params: PosterParams): Promise<PosterOutput> {
  const safe = { ...params, title: scrub(params.title), description: scrub(params.description) }
  const png = await render(safe)
  return {
    png,
    tweet: tweet(safe),
    markdown: blog(safe),
    slug: (params.ref ?? "finding").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  }
}

export async function render(params: PosterParams): Promise<Buffer> {
  const element = buildCard(params)
  const svg = await satori(element as any, {
    width: WIDTH,
    height: HEIGHT,
    fonts: [
      { name: "Space Grotesk", data: spaceRegular, weight: 400, style: "normal" as const },
      { name: "Space Grotesk", data: spaceBold, weight: 700, style: "normal" as const },
      { name: "Inter", data: interRegular, weight: 400, style: "normal" as const },
    ],
  })
  const resvg = new Resvg(svg, { fitTo: { mode: "width" as const, value: WIDTH } })
  return Buffer.from(resvg.render().asPng())
}
