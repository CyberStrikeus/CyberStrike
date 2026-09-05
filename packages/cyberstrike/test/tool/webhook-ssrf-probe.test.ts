import { describe, expect, test } from "bun:test"
import { SsrfProbe, detectUrlParams } from "../../src/tool/webhook/ssrf/probe"
import { SsrfTest } from "../../src/tool/webhook/ssrf/ssrf-test"
import { SsrfPayloads, type SsrfTarget } from "../../src/tool/webhook/ssrf/payloads"
import type { HttpSender, ProbeRequest } from "../../src/tool/webhook/transport"

// A vulnerable server that fetches the `url` param and echoes internal content for
// the AWS-IAM and /etc/passwd targets; benign otherwise.
function ssrfServer(): HttpSender {
  return {
    async send(req: ProbeRequest) {
      let target = ""
      try {
        target = new URL(req.url).searchParams.get("url") ?? ""
      } catch {
        /* ignore */
      }
      if (target.includes("169.254.169.254") && target.includes("iam"))
        return { status: 200, headers: {}, body: '{"AccessKeyId":"ASIA...","SecretAccessKey":"x","Token":"y"}' }
      if (target.includes("file:///etc/passwd")) return { status: 200, headers: {}, body: "root:x:0:0:root:/root:/bin/bash" }
      return { status: 200, headers: {}, body: "fetched ok" }
    },
  }
}

const baseReq = (): ProbeRequest => ({
  method: "GET",
  url: "https://app.example.com/fetch?url=https://example.com/logo.png",
  headers: {},
})

const awsIam = SsrfPayloads.select({ categories: ["cloud_metadata"], providers: ["aws"] }).find((t) => /IAM/.test(t.note)) as SsrfTarget
const passwd = SsrfPayloads.select({ categories: ["protocol"] }).find((t) => t.value.includes("/etc/passwd")) as SsrfTarget
const localhost = SsrfPayloads.select({ categories: ["localhost"] })[0]

describe("detectUrlParams", () => {
  test("finds URL-bearing params, ignores others", () => {
    expect(detectUrlParams("https://h/p?url=x&id=5")).toEqual(["url"])
    expect(detectUrlParams("https://h/p?redirect=a&callback=b&q=c")).toEqual(["redirect", "callback"])
    expect(detectUrlParams("https://h/p?id=5&page=2")).toEqual([])
    expect(detectUrlParams("not a url")).toEqual([])
  })
})

describe("SsrfProbe.run", () => {
  test("flags targets that reach internal resources the baseline did not", async () => {
    const probe = new SsrfProbe(ssrfServer())
    const report = await probe.run({ request: baseReq(), param: "url", targets: [awsIam, passwd, localhost] })

    expect(report.baselineStatus).toBe(200)
    expect(report.hits).toContain(awsIam.value)
    expect(report.hits).toContain(passwd.value)
    expect(report.hits).not.toContain(localhost.value)

    const aws = report.results.find((r) => r.target === awsIam.value)!
    expect(aws.finding.metadataLeak).toBe("aws")
    expect(aws.newVsBaseline).toBe(true)
  })

  test("surfaces the informational required-header for metadata targets", async () => {
    const gcp = SsrfPayloads.select({ categories: ["cloud_metadata"], providers: ["gcp"] })[0]
    const probe = new SsrfProbe(ssrfServer())
    const report = await probe.run({ request: baseReq(), param: "url", targets: [gcp] })
    expect(report.results[0].requiresHeader?.["Metadata-Flavor"]).toBe("Google")
  })

  test("a transport error on a target is captured, not thrown", async () => {
    const flaky: HttpSender = {
      async send(req) {
        return new URL(req.url).searchParams.get("url")?.includes("169.254") ? { error: "conn refused" } : { status: 200, headers: {}, body: "ok" }
      },
    }
    const report = await new SsrfProbe(flaky).run({ request: baseReq(), param: "url", targets: [awsIam] })
    expect(report.results[0].error).toBe("conn refused")
    expect(report.hits).toHaveLength(0)
  })

  test("does not double-count evidence already present in the baseline", async () => {
    // A server that ALWAYS returns passwd content (even baseline) → not a new hit.
    const noisy: HttpSender = { async send() { return { status: 200, headers: {}, body: "root:x:0:0:root:/root:/bin/bash" } } }
    const report = await new SsrfProbe(noisy).run({ request: baseReq(), param: "url", targets: [passwd] })
    expect(report.results[0].finding.reachedInternal).toBe(true)
    expect(report.results[0].newVsBaseline).toBe(false) // baseline already showed it
    expect(report.hits).toHaveLength(0)
  })
})

describe("SsrfTest.run", () => {
  test("auto-detects the sink parameter and probes it", async () => {
    const report = await SsrfTest.run({ request: baseReq(), limit: 8 }, ssrfServer())
    if ("error" in report) throw new Error(report.error)
    expect(report.param).toBe("url")
    expect(report.detectedParams).toContain("url")
    expect(report.probe.results.length).toBe(8)
  })

  test("errors when no URL-bearing parameter is present and none given", async () => {
    const report = await SsrfTest.run({ request: { method: "GET", url: "https://app.example.com/x?id=5", headers: {} } }, ssrfServer())
    expect("error" in report).toBe(true)
  })

  test("honors an explicit param + provider filter", async () => {
    const report = await SsrfTest.run({ request: baseReq(), param: "url", categories: ["cloud_metadata"], providers: ["aws"] }, ssrfServer())
    if ("error" in report) throw new Error(report.error)
    expect(report.probe.results.every((r) => r.provider === "aws")).toBe(true)
    expect(report.probe.hits).toContain(awsIam.value)
  })
})
