import { describe, test, expect } from "bun:test"
import { probeFileUpload } from "../../../src/tool/inject-probe/probe/file-upload"
import { uploadVariants, uploadBaseline } from "../../../src/tool/inject-probe/payloads/file-upload"
import { firstFileField, setMultipartFile, multipartBoundary } from "../../../src/tool/inject-probe/multipart"
import type { HttpSender } from "../../../src/tool/inject-probe/send"
import type { ResolvedRequest, SendBudget } from "../../../src/tool/inject-probe/types"

const BOUNDARY = "----CSbound"
const MP_BODY = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="avatar"; filename="me.png"\r\nContent-Type: image/png\r\n\r\n\x89PNG\r\n--${BOUNDARY}--\r\n`

const makeR = (opts: Partial<ResolvedRequest> = {}): ResolvedRequest => ({
  method: opts.method ?? "POST",
  url: opts.url ?? new URL("http://example.com/upload"),
  headers: opts.headers ?? {},
  body: opts.body ?? MP_BODY,
  contentType: opts.contentType ?? `multipart/form-data; boundary=${BOUNDARY}`,
  auth: { source: "none" },
  provenance: { fromRaw: false, reconstructed: false, bodyMaybeTruncated: false },
})
const budget = (max = 200): SendBudget => ({ sent: 0, max })
const sig = () => new AbortController().signal

describe("payloads/file-upload — the encoded checklist", () => {
  test("uploadVariants covers every category and embeds the canary", () => {
    const vs = uploadVariants("CANARY")
    const cats = new Set(vs.map((v) => v.category))
    expect([...cats].sort()).toEqual(["content", "content-type", "extension", "filename-path", "magic-byte", "server-config"])
    expect(vs.some((v) => v.filename.endsWith(".php"))).toBe(true) // dangerous extension
    expect(vs.some((v) => v.filename === "shell.php.jpg".replace("shell", "cs_CANARY"))).toBe(true) // double-ext bypass
    expect(vs.some((v) => v.filename === ".htaccess")).toBe(true) // config override
    expect(vs.some((v) => v.content.startsWith("GIF89a"))).toBe(true) // magic-byte bypass
    expect(vs.some((v) => v.filename.includes("../"))).toBe(true) // path traversal
    expect(vs.every((v) => v.content.includes("CANARY"))).toBe(true) // canary in every payload (retrieval)
  })
})

describe("multipart — file-part helpers", () => {
  test("firstFileField finds the file part; setMultipartFile rewrites filename/content-type/content", () => {
    expect(firstFileField(MP_BODY, BOUNDARY)).toBe("avatar")
    const b = uploadBaseline("Z")
    const out = setMultipartFile(MP_BODY, BOUNDARY, "avatar", b)!
    expect(out).toContain(`filename="${b.filename}"`)
    expect(out).toContain(`Content-Type: ${b.contentType}`)
    expect(out).toContain(b.content)
    // still a valid single-file multipart with the same boundary
    expect(multipartBoundary(makeR({ body: out }))).toBe(BOUNDARY)
  })
})

// A vulnerable upload: accepts anything, echoes a stored URL, and serves the file back EXECUTED (the
// GET returns the bare canary, no <?php wrapper) — models unrestricted upload → RCE.
const vulnSender: HttpSender = {
  send: async (req) => {
    if (req.method === "GET") {
      const m = req.url.match(/cs_(up[a-z0-9]+)/i)
      return { status: 200, body: m ? m[1]! : "", headers: {} } // executed: evaluated canary only
    }
    const fn = req.body?.match(/filename="([^"]+)"/)?.[1] ?? ""
    return { status: 200, body: JSON.stringify({ ok: true, url: `/uploads/${fn}` }), headers: {} }
  },
}

// A safe upload: allowlists real image extensions and rejects anything else with a validation error.
const safeSender: HttpSender = {
  send: async (req) => {
    if (req.method === "GET") return { status: 404, body: "", headers: {} }
    const fn = req.body?.match(/filename="([^"]+)"/)?.[1] ?? ""
    const clean = /\.(png|jpe?g|gif)$/i.test(fn) && !/\.(php|phtml|phar|asp|jsp|cgi|pl|sh|svg|html)/i.test(fn) && !fn.includes("/") && !fn.includes("\\")
    return clean ? { status: 200, body: '{"ok":true}', headers: {} } : { status: 400, body: "Invalid file type — only images are allowed", headers: {} }
  },
}

describe("probeFileUpload (WSTG-INPV-09)", () => {
  test("unrestricted upload → dangerous files accepted, canary retrieved EXECUTED (RCE)", async () => {
    const obs = await probeFileUpload(vulnSender, makeR(), sig(), 0, budget())
    expect(obs.point).toBe("file:avatar")
    expect(obs.baseline_accepted).toBe(true)
    expect(obs.accepted_dangerous.some((r) => r.filename.endsWith(".php"))).toBe(true)
    expect(obs.executed.length).toBeGreaterThan(0) // retrieval proved execution
    expect(obs.executed[0]!.retrieved).toBe("executed")
    expect(obs.executed[0]!.stored_url).toContain("/uploads/")
  })

  test("safe upload → baseline accepted but NO dangerous file accepted", async () => {
    const obs = await probeFileUpload(safeSender, makeR(), sig(), 0, budget())
    expect(obs.baseline_accepted).toBe(true)
    expect(obs.accepted_dangerous).toHaveLength(0)
    expect(obs.executed).toHaveLength(0)
    expect(obs.tried).toBeGreaterThan(0) // it DID try the matrix (not a skip)
  })

  test("non-multipart request is skipped cleanly", async () => {
    const obs = await probeFileUpload(vulnSender, makeR({ contentType: "application/json", body: "{}" }), sig(), 0, budget())
    expect(obs.point).toBe("file:none")
    expect(obs.note).toMatch(/multipart/i)
  })

  test("GET request is skipped (upload needs a write)", async () => {
    const obs = await probeFileUpload(vulnSender, makeR({ method: "GET" }), sig(), 0, budget())
    expect(obs.note).toMatch(/write/i)
  })
})
