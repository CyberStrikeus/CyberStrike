// SSRF response oracle (plan §05 ssrf_test). PURE: given a response body an SSRF
// payload elicited, report which internal-resource fingerprints are present —
// cloud-metadata (per provider), an internal-service banner, or a local-file read.
// FACTS, not verdicts: presence is a strong lead the agent confirms. Markers are
// kept specific (AND-combined where a single token would false-positive) so a body
// that merely mentions "instance-id" in prose is not flagged.
import type { CloudProvider } from "./payloads"

export interface SsrfFinding {
  metadataLeak?: CloudProvider
  internalService?: string // e.g. "redis", "ssh", "memcached", "elasticsearch"
  fileRead?: string // e.g. "/etc/passwd", "win.ini"
  signals: string[] // human-readable evidence lines
  reachedInternal: boolean // any positive fingerprint
}

export namespace SsrfOracle {
  // Cloud metadata — combined markers so an incidental token can't trip it.
  function cloudMetadata(body: string): { provider: CloudProvider; signal: string } | undefined {
    if (/"AccessKeyId"\s*:/.test(body) && /"SecretAccessKey"\s*:/.test(body))
      return { provider: "aws", signal: "AWS IAM credentials (AccessKeyId + SecretAccessKey) in response" }
    if (/\biam\/security-credentials\b/.test(body) || (/\bami-id\b/.test(body) && /\binstance-id\b/.test(body)))
      return { provider: "aws", signal: "AWS instance metadata listing returned" }
    if (/"access_token"\s*:/.test(body) && /"token_type"\s*:\s*"?Bearer/i.test(body))
      return { provider: "gcp", signal: "GCP service-account access token in response" }
    if (/computeMetadata|"numericProjectId"/.test(body))
      return { provider: "gcp", signal: "GCP computeMetadata response returned" }
    if (/"vmId"\s*:/.test(body) && /"subscriptionId"\s*:/.test(body))
      return { provider: "azure", signal: "Azure IMDS compute metadata (vmId + subscriptionId) returned" }
    if (/"droplet_id"\s*:/.test(body)) return { provider: "digitalocean", signal: "DigitalOcean droplet metadata returned" }
    return undefined
  }

  function internalService(body: string): { service: string; signal: string } | undefined {
    if (/redis_version:/.test(body) || /-ERR unknown command|\+PONG/.test(body))
      return { service: "redis", signal: "Redis banner/error in response" }
    if (/^SSH-2\.0-/m.test(body)) return { service: "ssh", signal: "SSH server banner in response" }
    if (/STAT pid \d|STAT version /.test(body)) return { service: "memcached", signal: "Memcached stats in response" }
    if (/"cluster_name"\s*:/.test(body) && /"cluster_uuid"\s*:/.test(body))
      return { service: "elasticsearch", signal: "Elasticsearch cluster info returned" }
    return undefined
  }

  function fileRead(body: string): { file: string; signal: string } | undefined {
    if (/root:.*?:0:0:/.test(body)) return { file: "/etc/passwd", signal: "/etc/passwd contents (root:...:0:0:) in response" }
    if (/\[fonts\]|\[extensions\]/.test(body) && /; for 16-bit app support/.test(body))
      return { file: "win.ini", signal: "Windows win.ini contents in response" }
    return undefined
  }

  /** Classify one response body for SSRF fingerprints. Empty/benign → reachedInternal:false. */
  export function assess(body: string): SsrfFinding {
    const signals: string[] = []
    const finding: SsrfFinding = { signals, reachedInternal: false }
    if (!body) return finding

    const meta = cloudMetadata(body)
    if (meta) {
      finding.metadataLeak = meta.provider
      signals.push(meta.signal)
    }
    const svc = internalService(body)
    if (svc) {
      finding.internalService = svc.service
      signals.push(svc.signal)
    }
    const file = fileRead(body)
    if (file) {
      finding.fileRead = file.file
      signals.push(file.signal)
    }
    finding.reachedInternal = signals.length > 0
    return finding
  }
}
