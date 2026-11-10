// aws-cloudfront stack checks — ported from infra-security-mcp `providers/aws-cloudfront` (cloudfront_*).
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, summarize, type Check } from "./shared"

export namespace Cloudfront {
  export async function detect(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    if (failed(res)) return { check: "detect", hit: false, severity: "info", detail: "no response" }
    const pop = header(res, "x-amz-cf-pop")
    const cf = header(res, "x-amz-cf-id") !== "" || pop !== "" || /CloudFront/i.test(header(res, "server") + header(res, "via"))
    if (!cf) return { check: "detect", hit: false, severity: "info", detail: "CloudFront not detected" }
    const s3 = /AmazonS3/i.test(header(res, "server"))
    return { check: "detect", hit: true, severity: "info", detail: `CloudFront in front of origin${pop ? ` (POP ${pop})` : ""}${s3 ? ", S3 origin" : ""}`, evidence: header(res, "x-amz-cf-id") || pop }
  }

  export async function s3Misconfig(sender: HttpSender, origin: string): Promise<Check> {
    const listing = await get(sender, origin)
    if (ok(listing) && listing.body.includes("<ListBucketResult"))
      return { check: "s3_misconfig", hit: true, severity: "high", detail: "S3 bucket listing exposed through CloudFront", evidence: listing.body.slice(0, 200) }
    const files = ["/.env", "/.git/config", "/.aws/credentials", "/wp-config.php.bak", "/crossdomain.xml", "/backup.zip", "/config.json"]
    for (const f of files) {
      const res = await get(sender, `${origin}${f}`)
      if (ok(res) && res.status === 200 && res.body.length > 0 && !/<!doctype html/i.test(res.body.slice(0, 200)))
        return { check: "s3_misconfig", hit: true, severity: "high", detail: `sensitive file served from S3 origin at ${f}`, evidence: res.body.slice(0, 150) }
    }
    return { check: "s3_misconfig", hit: false, severity: "info", detail: "no bucket listing or sensitive-file exposure" }
  }

  export async function originAccess(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, `${origin}/__nosuchkey_${Date.now()}`)
    if (failed(res)) return { check: "origin_access", hit: false, severity: "info", detail: "no response" }
    if (/<Error>[\s\S]*<Code>(NoSuchKey|AccessDenied)<\/Code>/i.test(res.body))
      return { check: "origin_access", hit: true, severity: "medium", detail: "raw S3 XML error passthrough (missing OAC/OAI — origin reachable semantics leaked)", evidence: res.body.slice(0, 200) }
    return { check: "origin_access", hit: false, severity: "info", detail: "no S3 error passthrough (OAC/OAI likely enforced)" }
  }

  export async function signedUrlBypass(sender: HttpSender, origin: string): Promise<Check> {
    const paths = ["/private/", "/private/index.html", "/protected/", "/secure/", "/internal/", "/admin/"]
    for (const p of paths) {
      const direct = await get(sender, `${origin}${p}`)
      if (ok(direct) && direct.status === 200 && direct.body.length > 0)
        return { check: "signed_url_bypass", hit: true, severity: "high", detail: `protected path served without a signature at ${p}`, evidence: `status=200` }
      const trav = await get(sender, `${origin}/public/..${p}`)
      if (ok(trav) && trav.status === 200)
        return { check: "signed_url_bypass", hit: true, severity: "high", detail: `signed-URL path traversal to ${p} via /public/..`, evidence: `traversal 200` }
    }
    return { check: "signed_url_bypass", hit: false, severity: "info", detail: "no unsigned/traversal access to protected paths" }
  }

  export async function lambdaEdge(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    if (failed(res)) return { check: "lambda_edge", hit: false, severity: "info", detail: "no response" }
    const amzn = ["x-amzn-requestid", "x-amzn-trace-id", "x-amzn-remapped-authorization", "x-edge-response-result-type"].filter((h) => header(res, h) !== "")
    const arn = (res.body.match(/arn:aws:lambda:[\w-]+:\d+:function:[\w-]+/) || [])[0]
    if (arn) return { check: "lambda_edge", hit: true, severity: "medium", detail: "Lambda@Edge ARN leaked in response", evidence: arn }
    if (amzn.length > 0) return { check: "lambda_edge", hit: true, severity: "info", detail: "Lambda@Edge / CloudFront Functions in the request path", evidence: amzn.join(", ") }
    return { check: "lambda_edge", hit: false, severity: "info", detail: "no Lambda@Edge indicators" }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    detect,
    s3_misconfig: s3Misconfig,
    origin_access: originAccess,
    signed_url_bypass: signedUrlBypass,
    lambda_edge: lambdaEdge,
  }

  export async function run(sender: HttpSender, origin: string, which: string): Promise<Check[]> {
    const names = which === "all" ? Object.keys(RUNNERS) : [which]
    const out: Check[] = []
    for (const n of names) out.push(await RUNNERS[n](sender, origin))
    return out
  }
}

const DESCRIPTION = `AWS CloudFront checks (detection + POP, S3 bucket-listing / sensitive-file exposure, missing OAC/OAI origin-access leak, signed-URL bypass + traversal, Lambda@Edge ARN/indicator leak).

Run after Vortex fingerprints CloudFront. S3/origin probes respect the captured-host scope guard. check="all" (default) runs every check.`

export const CloudfrontTestTool = defineWebhookTool({
  name: "cloudfront_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "detect", "s3_misconfig", "origin_access", "signed_url_bypass", "lambda_edge"])
      .default("all")
      .describe("Which check to run; 'all' runs every CloudFront check."),
  }),
  async run(params, ctx) {
    const origin = base(params.target)
    const results = await Cloudfront.run(ctx.sender, origin, params.check)
    return { target: origin, results }
  },
  format(r) {
    return summarize("cloudfront_test", r.target, r.results)
  },
})
