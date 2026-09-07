import { describe, expect, test } from "bun:test"
import { renderFinding } from "../../src/tool/report-format"
import { Request } from "../../src/session/request"
import { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

async function withReq(fn: (sid: string, reqID: string) => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const sid = (await Session.create({})).id
      const raw =
        "GET /api/orders/456 HTTP/1.1\r\nHost: app.example.com\r\nAuthorization: Bearer TOK_A\r\nAccept: application/json\r\n\r\n"
      const req = Request.add({
        sessionID: sid,
        method: "GET",
        normalizedPath: "/api/orders/{id}",
        rawRequest: raw,
        scheme: "https",
        host: "app.example.com",
        origin: "https://app.example.com",
        response: { status: 200, headers: { "content-type": "application/json" }, body: '{"order_id":456,"user_id":20}' },
      })!
      await fn(sid, req.id)
    },
  })
}

function finding(over: Record<string, unknown>): any {
  return {
    id: "vul_x",
    session_id: "s",
    severity: "high",
    title: "IDOR in Order Endpoint",
    description: "The endpoint does not check ownership.",
    cwe_id: "CWE-639",
    endpoint: "GET /api/orders/{id}",
    status: "pending_fix",
    ...over,
  }
}

describe("renderFinding — Bugcrowd template", () => {
  test("emits every REQUIRED section header in order", async () => {
    await withReq(async (sid, reqID) => {
      const md = renderFinding(finding({ evidence_request_ids: [reqID] }), sid, "HIGH-001")
      const idx = (s: string) => md.indexOf(s)
      expect(idx("# [HIGH-001] IDOR in Order Endpoint")).toBeGreaterThanOrEqual(0)
      expect(idx("Affected Resource:")).toBeGreaterThan(idx("# [HIGH-001]"))
      expect(idx("Weakness:")).toBeGreaterThan(idx("Affected Resource:"))
      expect(idx("Severity:")).toBeGreaterThan(idx("Weakness:"))
      expect(idx("## Vulnerability Overview")).toBeGreaterThan(idx("Severity:"))
      expect(idx("### Finding Details")).toBeGreaterThan(idx("## Vulnerability Overview"))
      expect(idx("### Steps To Reproduce")).toBeGreaterThan(idx("### Finding Details"))
      expect(idx("## Recommendations")).toBeGreaterThan(idx("### Steps To Reproduce"))
      expect(idx("## References")).toBeGreaterThan(idx("## Recommendations"))
      expect(idx("## Impacts")).toBeGreaterThan(idx("## References"))
    })
  })

  test("Steps To Reproduce carries a deterministic curl AND the full raw HTTP request/response", async () => {
    await withReq(async (sid, reqID) => {
      const md = renderFinding(finding({ evidence_request_ids: [reqID] }), sid, "HIGH-001")
      expect(md).toContain("```bash")
      expect(md).toContain("curl -sk -X 'GET' 'https://app.example.com/api/orders/456'")
      expect(md).toContain("-H 'Authorization: Bearer TOK_A'")
      expect(md).toContain("```http")
      expect(md).toContain("GET /api/orders/456 HTTP/1.1") // full raw request
      expect(md).toContain("HTTP 200") // response
    })
  })

  test("known CWE fills the per-class overview + references from the library", async () => {
    await withReq(async (sid, reqID) => {
      const md = renderFinding(finding({ evidence_request_ids: [reqID] }), sid, "HIGH-001")
      expect(md).toContain("An Insecure Direct Object Reference (IDOR) occurs when")
      expect(md).toContain("Broken Object Level Authorization")
    })
  })

  test("no evidence → explicit placeholder, not a silently missing section", async () => {
    await withReq(async (sid) => {
      const md = renderFinding(finding({ evidence_request_ids: [] }), sid, "LOW-001")
      expect(md).toContain("### Steps To Reproduce")
      expect(md).toContain("No captured request evidence was attached")
    })
  })

  test("unknown CWE degrades gracefully (still all sections)", async () => {
    await withReq(async (sid, reqID) => {
      const md = renderFinding(
        finding({ cwe_id: "CWE-99999", title: "Odd finding", evidence_request_ids: [reqID] }),
        sid,
        "LOW-001",
      )
      expect(md).toContain("## Vulnerability Overview")
      expect(md).toContain("## Impacts")
      expect(md).toContain("Weakness: CWE-99999")
    })
  })
})
