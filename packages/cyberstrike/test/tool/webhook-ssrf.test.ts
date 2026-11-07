import { describe, expect, test } from "bun:test"
import { SsrfPayloads } from "../../src/tool/webhook/ssrf/payloads"
import { SsrfOracle } from "../../src/tool/webhook/ssrf/oracle"

describe("SsrfPayloads.select", () => {
  test("no opts returns the full battery, each well-formed", () => {
    const all = SsrfPayloads.select()
    expect(all.length).toBe(SsrfPayloads.TARGETS.length)
    expect(all.length).toBeGreaterThan(20)
    for (const t of all) {
      expect(t.value).toBeTruthy()
      expect(t.category).toBeTruthy()
      expect(t.note).toBeTruthy()
    }
  })

  test("category filter keeps only the requested categories", () => {
    const meta = SsrfPayloads.select({ categories: ["cloud_metadata"] })
    expect(meta.length).toBeGreaterThan(0)
    expect(meta.every((t) => t.category === "cloud_metadata")).toBe(true)
  })

  test("provider filter restricts cloud_metadata but passes non-cloud targets through", () => {
    const awsAndLocal = SsrfPayloads.select({ categories: ["cloud_metadata", "localhost"], providers: ["aws"] })
    const cloud = awsAndLocal.filter((t) => t.category === "cloud_metadata")
    expect(cloud.length).toBeGreaterThan(0)
    expect(cloud.every((t) => t.provider === "aws")).toBe(true)
    // localhost targets are not cloud_metadata → unaffected by the provider filter
    expect(awsAndLocal.some((t) => t.category === "localhost")).toBe(true)
  })

  test("limit caps the count", () => {
    expect(SsrfPayloads.select({ limit: 3 })).toHaveLength(3)
    expect(SsrfPayloads.select({ limit: 0 })).toHaveLength(0)
  })

  test("GCP and Azure metadata targets carry their required headers", () => {
    const gcp = SsrfPayloads.select({ categories: ["cloud_metadata"], providers: ["gcp"] })[0]
    expect(gcp.headers?.["Metadata-Flavor"]).toBe("Google")
    const azure = SsrfPayloads.select({ categories: ["cloud_metadata"], providers: ["azure"] })[0]
    expect(azure.headers?.["Metadata"]).toBe("true")
  })

  test("includes IP-encoding bypasses (decimal/hex/octal)", () => {
    const bypass = SsrfPayloads.select({ categories: ["ip_bypass"] }).map((t) => t.value)
    expect(bypass).toContain("http://2130706433/") // 127.0.0.1 decimal
    expect(bypass.some((v) => v.includes("0x7f000001"))).toBe(true) // hex
  })
})

describe("SsrfOracle.assess — positive fingerprints", () => {
  test("AWS IAM credentials", () => {
    const f = SsrfOracle.assess('{"AccessKeyId":"ASIA...","SecretAccessKey":"abc","Token":"x"}')
    expect(f.metadataLeak).toBe("aws")
    expect(f.reachedInternal).toBe(true)
  })
  test("AWS meta-data listing (ami-id + instance-id)", () => {
    expect(SsrfOracle.assess("ami-id\ninstance-id\nhostname").metadataLeak).toBe("aws")
  })
  test("GCP service-account token", () => {
    expect(SsrfOracle.assess('{"access_token":"ya29...","token_type":"Bearer","expires_in":3599}').metadataLeak).toBe("gcp")
  })
  test("Azure IMDS compute metadata", () => {
    expect(SsrfOracle.assess('{"vmId":"abc","subscriptionId":"def","location":"eastus"}').metadataLeak).toBe("azure")
  })
  test("DigitalOcean droplet metadata", () => {
    expect(SsrfOracle.assess('{"droplet_id":123456,"hostname":"web"}').metadataLeak).toBe("digitalocean")
  })
  test("Redis + SSH internal service banners", () => {
    expect(SsrfOracle.assess("redis_version:6.2.6\r\nconnected_clients:1").internalService).toBe("redis")
    expect(SsrfOracle.assess("SSH-2.0-OpenSSH_8.9\r\n").internalService).toBe("ssh")
  })
  test("/etc/passwd file read", () => {
    const f = SsrfOracle.assess("root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:")
    expect(f.fileRead).toBe("/etc/passwd")
    expect(f.reachedInternal).toBe(true)
  })
})

describe("SsrfOracle.assess — negative / false-positive guards", () => {
  test("prose mentioning a single token is NOT flagged", () => {
    const f = SsrfOracle.assess("Our product has a unique instance-id shown on the dashboard.")
    expect(f.reachedInternal).toBe(false)
    expect(f.metadataLeak).toBeUndefined()
  })
  test("AccessKeyId alone (no SecretAccessKey) is not AWS creds", () => {
    expect(SsrfOracle.assess('{"AccessKeyId":"shown-in-ui"}').reachedInternal).toBe(false)
  })
  test("empty and benign bodies yield nothing", () => {
    expect(SsrfOracle.assess("").reachedInternal).toBe(false)
    expect(SsrfOracle.assess("<html><body>Welcome</body></html>").signals).toHaveLength(0)
  })
})
