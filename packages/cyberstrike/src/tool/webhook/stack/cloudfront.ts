// aws-cloudfront stack checks — ported 1:1 from infra-security-mcp `providers/aws-cloudfront` (cloudfront_*).
// Every S3 sensitive-file path, bucket-guess pattern, signed-URL path, traversal
// vector and Lambda@Edge probe matches the source exactly; only the transport
// (scope-guarded webhook sender) and the Check/severity adapter are CyberStrike's.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, summarize, type Check } from "./shared"

export namespace Cloudfront {
  export async function detect(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    if (failed(res)) return { check: "detect", hit: false, severity: "info", detail: "no response" }

    const hv = (n: string): string | boolean => header(res, n) || false
    const signals: Record<string, string | boolean> = {}
    signals["x-amz-cf-id"] = hv("x-amz-cf-id")
    signals["x-amz-cf-pop"] = hv("x-amz-cf-pop")
    const server = header(res, "server")
    signals["server_cloudfront"] = server.toLowerCase() === "cloudfront"
    signals["server_amazons3"] = server.toLowerCase() === "amazons3"
    const via = header(res, "via")
    signals["via_cloudfront"] = via.toLowerCase().includes("cloudfront")
    signals["x-cache"] = hv("x-cache")
    signals["x-amz-request-id"] = hv("x-amz-request-id")
    signals["x-amz-id-2"] = hv("x-amz-id-2")
    signals["age_header"] = hv("age")

    const positives = Object.values(signals).filter((v) => v !== false).length
    const isCf = signals["server_cloudfront"] === true || signals["x-amz-cf-id"] !== false || signals["via_cloudfront"] !== false
    const confidence = positives >= 3 ? "high" : positives >= 1 ? "medium" : "none"
    const pop = typeof signals["x-amz-cf-pop"] === "string" ? signals["x-amz-cf-pop"] : null
    const s3Origin = signals["server_amazons3"] !== false || signals["x-amz-request-id"] !== false
    if (!isCf) return { check: "detect", hit: false, severity: "info", detail: "CloudFront not detected" }
    return {
      check: "detect",
      hit: true,
      severity: "info",
      detail: `behind CloudFront (confidence ${confidence}${pop ? `, POP ${pop}` : ""}${s3Origin ? ", S3 origin" : ""})`,
      evidence: (typeof signals["x-amz-cf-id"] === "string" ? signals["x-amz-cf-id"] : "") || (pop ?? "") || server,
    }
  }

  export async function s3Misconfig(sender: HttpSender, origin: string, bucket?: string): Promise<Check> {
    const url = origin
    const domain = new URL(url).hostname
    const bucketGuesses = bucket
      ? [bucket]
      : [
          domain,
          domain.replace(/\./g, "-"),
          domain.split(".")[0],
          `${domain.split(".")[0]}-assets`,
          `${domain.split(".")[0]}-static`,
          `${domain.split(".")[0]}-media`,
          `${domain.split(".")[0]}-public`,
        ]

    const findings: { check: string; url: string; status: number; vulnerable: boolean }[] = []

    // Check if CloudFront serves directory listing (XML bucket listing leaking through)
    const rootRes = await get(sender, url)
    const rootBody = ok(rootRes) ? rootRes.body : ""
    const isXmlListing = rootBody.includes("<ListBucketResult") || rootBody.includes("<ListAllMyBucketsResult")
    findings.push({ check: "directory_listing_via_cloudfront", url, status: ok(rootRes) ? rootRes.status : 0, vulnerable: isXmlListing })

    // Sensitive file checks through CloudFront
    const sensitiveFiles = [
      { path: "/.env", name: "env_file" },
      { path: "/.git/config", name: "git_config" },
      { path: "/.git/HEAD", name: "git_head" },
      { path: "/wp-config.php.bak", name: "wp_config_backup" },
      { path: "/server-status", name: "server_status" },
      { path: "/.aws/credentials", name: "aws_credentials" },
      { path: "/crossdomain.xml", name: "crossdomain_xml" },
    ]
    for (const f of sensitiveFiles) {
      const fileUrl = new URL(f.path, url).toString()
      const res = await get(sender, fileUrl)
      const body = ok(res) ? res.body : ""
      const isExposed = ok(res) && res.status === 200 && body.length > 0 && !body.includes("<Error>") && !body.includes("AccessDenied")
      findings.push({ check: f.name, url: fileUrl, status: ok(res) ? res.status : 0, vulnerable: isExposed })
    }

    // Direct S3 bucket access attempts
    const s3Findings: { bucket: string; region: string; listing: boolean }[] = []
    const regions = ["us-east-1", "us-west-2", "eu-west-1"]
    for (const b of bucketGuesses.slice(0, 3)) {
      for (const region of regions) {
        const s3Url = `https://${b}.s3.${region}.amazonaws.com/`
        const s3Res = await get(sender, s3Url)
        if (failed(s3Res) || s3Res.status === 0) continue
        const hasListing = s3Res.body.includes("<ListBucketResult")
        const isAccessible = s3Res.status !== 404 && s3Res.status !== 0
        if (isAccessible) {
          s3Findings.push({ bucket: b, region, listing: hasListing })
          break // found the region
        }
      }
    }

    const vulnerabilities = findings.filter((f) => f.vulnerable)
    const vulnerableCount = vulnerabilities.length + s3Findings.filter((s) => s.listing).length
    if (vulnerabilities.length === 0 && !s3Findings.some((s) => s.listing))
      return { check: "s3_misconfig", hit: false, severity: "info", detail: "No S3 origin misconfigurations detected" }
    return {
      check: "s3_misconfig",
      hit: true,
      severity: "high",
      detail: `S3 origin misconfigurations found — data may be accessible without CloudFront (${vulnerableCount}): ${[...vulnerabilities.map((v) => v.check), ...s3Findings.filter((s) => s.listing).map((s) => `${s.bucket}(${s.region})`)].join(", ")}`,
      evidence: vulnerabilities.map((v) => `${v.check}[${v.status}]`).join(" "),
    }
  }

  export async function originAccess(sender: HttpSender, origin: string, bucketArg?: string): Promise<Check> {
    const url = origin
    const domain = new URL(url).hostname
    const bucket = bucketArg ?? domain.split(".")[0]

    const checks: { check: string; vulnerable: boolean; detail: string }[] = []

    // Check CloudFront response for OAI/OAC indicators
    const cfRes = await get(sender, url)
    const hasAmzHeaders = ok(cfRes) ? !!header(cfRes, "x-amz-cf-id") : false

    // Test if error pages reveal S3 info
    const notFound = await get(sender, `${url}/__oac_test_${Date.now()}`)
    const nfBody = ok(notFound) ? notFound.body : ""
    const s3Error =
      nfBody.includes("<Error>") && (nfBody.includes("NoSuchKey") || nfBody.includes("AccessDenied") || nfBody.includes("NoSuchBucket"))
    checks.push({
      check: "s3_error_passthrough",
      vulnerable: s3Error,
      detail: s3Error
        ? "S3 errors are not masked by CloudFront custom error pages — reveals S3 origin"
        : "Error pages appear to be custom or CloudFront-generated",
    })

    // Try direct S3 access
    const s3Endpoints = [
      `https://${bucket}.s3.amazonaws.com/`,
      `https://s3.amazonaws.com/${bucket}/`,
      `https://${bucket}.s3-website-us-east-1.amazonaws.com/`,
    ]
    for (const s3Url of s3Endpoints) {
      const s3Res = await get(sender, s3Url)
      if (failed(s3Res)) continue
      const directAccess = s3Res.status !== 404 && s3Res.status !== 403
      const isListing = s3Res.body.includes("<ListBucketResult")
      const isWebsite = s3Res.status === 200 && !s3Res.body.includes("<Error>")
      checks.push({
        check: "direct_s3_access",
        vulnerable: directAccess || isListing,
        detail: isListing
          ? "Direct S3 access with public listing — no OAC/OAI enforced"
          : isWebsite
            ? "Direct S3 website access — OAC/OAI may not be configured"
            : s3Res.status === 403
              ? "Access denied — OAC/OAI may be properly configured"
              : `Status ${s3Res.status}`,
      })
    }

    // Check if signed URLs/cookies are required
    const signedCheck = await get(sender, `${url}/`, { Cookie: "" })
    const scBody = ok(signedCheck) ? signedCheck.body : ""
    const requiresSigned =
      ok(signedCheck) && signedCheck.status === 403 && (scBody.includes("MissingKey") || scBody.includes("Missing Key-Pair-Id"))
    checks.push({
      check: "signed_url_requirement",
      vulnerable: !requiresSigned && hasAmzHeaders,
      detail: requiresSigned
        ? "CloudFront requires signed URLs — good access control"
        : "Content is served without signed URL requirement",
    })

    const vulnerabilities = checks.filter((c) => c.vulnerable)
    if (vulnerabilities.length === 0)
      return { check: "origin_access", hit: false, severity: "info", detail: "Origin access controls appear to be in place" }
    return {
      check: "origin_access",
      hit: true,
      severity: "high",
      detail: `OAC/OAI likely missing — configure Origin Access Control to restrict S3 access exclusively through CloudFront: ${vulnerabilities.map((v) => v.check).join(", ")}`,
      evidence: vulnerabilities.map((v) => `${v.check}: ${v.detail}`).join(" | "),
    }
  }

  export async function signedUrlBypass(sender: HttpSender, origin: string): Promise<Check> {
    const url = origin
    const baseUrl = new URL(url)

    const findings: { test: string; path: string; status: number; accessible: boolean; detail: string }[] = []

    // Test various paths that might not require signing
    const unsignedPaths = [
      "/",
      "/index.html",
      "/favicon.ico",
      "/robots.txt",
      "/public/",
      "/static/",
      "/assets/",
      "/images/",
      "/css/",
      "/js/",
      "/api/health",
      "/api/status",
      "/.well-known/",
    ]
    for (const path of unsignedPaths) {
      const testUrl = new URL(path, baseUrl).toString()
      const res = await get(sender, testUrl)
      const body = ok(res) ? res.body : ""
      const status = ok(res) ? res.status : 0
      const needsSigning =
        status === 403 && (body.includes("MissingKey") || body.includes("Missing Key-Pair-Id") || body.includes("InvalidKey"))
      const accessible = status === 200 || status === 301 || status === 302
      findings.push({
        test: "unsigned_path",
        path,
        status,
        accessible,
        detail: needsSigning ? "Requires signed URL" : accessible ? "Publicly accessible without signing" : `Status ${status}`,
      })
    }

    // Test expired signed URL behavior
    const policy = JSON.stringify({
      Statement: [{ Resource: `${baseUrl.origin}/*`, Condition: { DateLessThan: { "AWS:EpochTime": 1000000000 } } }],
    })
    const expiredPolicy = btoa(policy).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    const expiredUrl = `${url}?Policy=${expiredPolicy}&Signature=expired_test&Key-Pair-Id=TESTKEY`
    const expiredRes = await get(sender, expiredUrl)
    const expiredStatus = ok(expiredRes) ? expiredRes.status : 0
    const expiredBody = ok(expiredRes) ? expiredRes.body : ""
    findings.push({
      test: "expired_policy",
      path: "/?Policy=expired",
      status: expiredStatus,
      accessible: expiredStatus === 200,
      detail: expiredStatus === 200
        ? "Expired policy accepted — signing enforcement may be broken"
        : expiredBody.includes("InvalidKey")
          ? "Properly rejects invalid Key-Pair-Id"
          : expiredBody.includes("ExpiredUrl")
            ? "Properly detects expired policy"
            : `Returned status ${expiredStatus}`,
    })

    // Wildcard path test — if /private/* is signed, try /private/../public/
    const traversalPaths = ["/private/../", "/private/..%2f", "/private/%2e%2e/"]
    for (const path of traversalPaths) {
      const testUrl = new URL(path, baseUrl).toString()
      const res = await get(sender, testUrl)
      const status = ok(res) ? res.status : 0
      findings.push({
        test: "path_traversal_bypass",
        path,
        status,
        accessible: status === 200,
        detail: status === 200 ? "Path traversal may bypass signed URL scope" : `Status ${status}`,
      })
    }

    const publicPaths = findings.filter((f) => f.test === "unsigned_path" && f.accessible)
    const signedPaths = findings.filter((f) => f.test === "unsigned_path" && f.detail === "Requires signed URL")
    const bypassable = findings.filter((f) => f.test !== "unsigned_path" && f.accessible)

    if (bypassable.length === 0) {
      const detail =
        signedPaths.length === 0 && publicPaths.length > 0
          ? "No signed URL enforcement detected — all tested paths are publicly accessible"
          : "Signed URL enforcement appears properly configured"
      return { check: "signed_url_bypass", hit: false, severity: "info", detail }
    }
    return {
      check: "signed_url_bypass",
      hit: true,
      severity: "high",
      detail: `Signed URL policy bypass detected — content may be accessible without valid signature: ${bypassable.map((f) => `${f.test}(${f.path})`).join(", ")}`,
      evidence: bypassable.map((f) => `${f.path}[${f.status}]`).join(" "),
    }
  }

  export async function lambdaEdge(sender: HttpSender, origin: string): Promise<Check> {
    const url = origin

    const findings: { check: string; status: number; detected: boolean; detail: string }[] = []

    // Normal request — look for Lambda indicators
    const res = await get(sender, url)
    const resHeaders = ok(res) ? res.headers : {}
    const resStatus = ok(res) ? res.status : 0
    const xAmzRequestId = ok(res) ? header(res, "x-amzn-requestid") : ""
    const xAmzTraceId = ok(res) ? header(res, "x-amzn-trace-id") : ""
    const xAmzRemapped = Object.keys(resHeaders).filter((k) => k.toLowerCase().startsWith("x-amzn-remapped"))

    findings.push({
      check: "lambda_headers",
      status: resStatus,
      detected: !!xAmzRequestId || xAmzRemapped.length > 0,
      detail: xAmzRequestId
        ? `Lambda request ID: ${xAmzRequestId}`
        : xAmzRemapped.length > 0
          ? `Lambda remapped headers found: ${xAmzRemapped.join(", ")}`
          : "No Lambda@Edge headers detected",
    })

    if (xAmzTraceId) {
      findings.push({ check: "xray_tracing", status: resStatus, detected: true, detail: `X-Ray tracing enabled: ${xAmzTraceId}` })
    }

    // Trigger error to see Lambda ARN in error response
    const errorTriggers: { headers: Record<string, string>; path: string; method?: string; body?: string }[] = [
      { headers: { Accept: "application/json" }, path: `/__lambda_error_test_${Date.now()}` },
      { headers: { "Content-Type": "application/json" }, path: "/", method: "POST", body: "{invalid" },
    ]
    for (const trigger of errorTriggers) {
      const testUrl = new URL(trigger.path, url).toString()
      const errorRes = await sender.send({
        method: trigger.method ?? "GET",
        url: testUrl,
        headers: trigger.headers,
        body: trigger.body,
      })
      const eBody = ok(errorRes) ? errorRes.body : ""
      const arnMatch = eBody.match(/arn:aws:lambda:[^"'\s<]+/)
      const lambdaError = eBody.includes("Lambda") || eBody.includes("FunctionError") || eBody.includes("Unhandled")
      if (arnMatch || lambdaError) {
        findings.push({
          check: "lambda_error_disclosure",
          status: ok(errorRes) ? errorRes.status : 0,
          detected: true,
          detail: arnMatch ? `Lambda ARN exposed: ${arnMatch[0]}` : "Lambda error message detected in response",
        })
      }
    }

    // Check for CloudFront Functions (CF2) vs Lambda@Edge
    const customHeaders = Object.keys(resHeaders).filter(
      (k) => k.toLowerCase().startsWith("x-custom-") || k.toLowerCase().startsWith("x-edge-"),
    )
    const hasCustomProcessing = customHeaders.length > 0
    if (hasCustomProcessing) {
      findings.push({
        check: "cloudfront_functions",
        status: resStatus,
        detected: true,
        detail: `Custom edge-processed headers: ${customHeaders.join(", ")}`,
      })
    }

    // Check common Lambda function URL patterns
    const lambdaUrlPatterns = ["/api", "/auth", "/callback", "/webhook"]
    for (const path of lambdaUrlPatterns) {
      const testUrl = new URL(path, url).toString()
      const pathRes = await get(sender, testUrl)
      const lambdaHeaders =
        ok(pathRes) && (!!header(pathRes, "x-amzn-requestid") || !!header(pathRes, "x-amzn-remapped-content-length"))
      if (lambdaHeaders) {
        findings.push({
          check: `lambda_path_${path.replace("/", "")}`,
          status: ok(pathRes) ? pathRes.status : 0,
          detected: true,
          detail: `${path} appears to be Lambda-backed (x-amzn-requestid present)`,
        })
      }
    }

    const lambdaDetected = findings.some((f) => f.detected)
    const arnLeaked = findings.some((f) => f.detail.includes("ARN exposed"))
    if (!lambdaDetected)
      return { check: "lambda_edge", hit: false, severity: "info", detail: "No Lambda@Edge detected on tested paths" }
    return {
      check: "lambda_edge",
      hit: true,
      severity: arnLeaked ? "medium" : "info",
      detail: `Lambda@Edge / CloudFront Functions detected${arnLeaked ? " — Lambda ARN exposed" : ""}: ${findings.filter((f) => f.detected).map((f) => f.check).join(", ")}`,
      evidence: findings.filter((f) => f.detected).map((f) => f.detail).join(" | "),
    }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string, bucket?: string) => Promise<Check>> = {
    detect,
    s3_misconfig: s3Misconfig,
    origin_access: originAccess,
    signed_url_bypass: signedUrlBypass,
    lambda_edge: lambdaEdge,
  }

  export async function run(sender: HttpSender, origin: string, which: string, bucket?: string): Promise<Check[]> {
    const names = which === "all" ? Object.keys(RUNNERS) : [which]
    const out: Check[] = []
    for (const n of names) out.push(await RUNNERS[n](sender, origin, bucket))
    return out
  }
}

const DESCRIPTION = `AWS CloudFront edge checks (detection via X-Amz-Cf-* headers, S3 origin misconfig — bucket listing/sensitive files/direct bucket access, missing OAC/OAI origin access, signed-URL policy bypass — unsigned paths/expired policy/path traversal, Lambda@Edge + CloudFront Functions detection and ARN disclosure). 1:1 port of the infra-security aws-cloudfront provider.

Run after Vortex fingerprints CloudFront. Direct-S3/bucket probes respect the captured-host scope guard (out-of-scope hosts are refused). check="all" (default) runs every check.`

export const CloudfrontTestTool = defineWebhookTool({
  name: "cloudfront_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    bucket: z.string().optional().describe("Known S3 bucket name (otherwise inferred from the domain)."),
    check: z
      .enum(["all", "detect", "s3_misconfig", "origin_access", "signed_url_bypass", "lambda_edge"])
      .default("all")
      .describe("Which check to run; 'all' runs every CloudFront check."),
  }),
  async run(params, ctx) {
    const origin = base(params.target)
    const results = await Cloudfront.run(ctx.sender, origin, params.check, params.bucket)
    return { target: origin, results }
  },
  format(r) {
    return summarize("cloudfront_test", r.target, r.results)
  },
})
