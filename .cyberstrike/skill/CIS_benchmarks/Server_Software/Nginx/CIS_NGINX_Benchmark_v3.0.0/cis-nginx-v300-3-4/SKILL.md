---
name: cis-nginx-v300-3-4
description: "Ensure proxies pass source IP information (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, logging]
cis_id: "3.4"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 3.4 — Ensure proxies pass source IP information

## Profile Applicability
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description
When NGINX acts as a reverse proxy or load balancer, it terminates the client connection and opens a new connection to the upstream application server. By default, the upstream server sees the NGINX server's internal IP address as the source, obscuring the original client IP. Standard HTTP headers like `X-Forwarded-For` and `X-Real-IP` must be explicitly configured to pass the original client's IP address and protocol information to the backend application.

## Rationale
Visibility of the true client IP address is essential for security auditing, incident response, and access control within the backend application. Without forwarding this information:

1. **Forensics:** Application logs will show all traffic coming from the NGINX proxy IP, making it impossible to trace malicious activity to a specific attacker.
2. **Access Control:** Application-level IP allow/deny lists or rate limits will fail or mistakenly block the entire proxy.
3. **Compliance:** Accurate logging of the user origin is often a regulatory requirement.

## Impact
Enabling these headers allows the backend application to see the original client IP. However, if NGINX simply appends to an existing `X-Forwarded-For` header sent by a malicious client, the backend might be tricked into trusting a spoofed IP at the beginning of the list.

## Audit Procedure

**1. Verify Configuration:**

Check the active configuration for proxy header directives in proxied locations:

```bash
nginx -T 2>/dev/null | grep -E "proxy_set_header (X-Real-IP|X-Forwarded-For)"
```

**Evaluation:**

- **Presence:** Verify that `proxy_set_header X-Forwarded-For` **and** `proxy_set_header X-Real-IP` are present in `location` blocks that use `proxy_pass` (or `grpc_pass`, `fastcgi_pass`).
- **Correctness:**
  - `X-Forwarded-For` should typically use `$proxy_add_x_forwarded_for` (to preserve the chain) or `$remote_addr` (if NGINX is the first trusted hop).
  - `X-Real-IP` should use `$remote_addr`.
- **Scope:** Check that this is applied to all relevant proxied locations.

## Remediation
Configure NGINX to forward client IP information in your `server` or `location` blocks where `proxy_pass` is used.

**Configuration Example:**

```nginx
location / {
    # Use 'https' for Zero Trust environments (requires proxy_ssl_verify configuration)
    # Use 'http'  for standard TLS offloading (upstream traffic is unencrypted)
    proxy_pass <protocol>://example_backend_application;

    # Standard header: Appends the client IP to the list of proxies
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;

    # NGINX-specific header: Sets the direct client IP (useful for apps expecting a single value)
    proxy_set_header X-Real-IP         $remote_addr;

    # Recommended: Forward the protocol (http vs https)
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Default Value
By default, NGINX does not add these headers. The upstream server receives requests appearing to originate from the NGINX server's IP address.

## References
1. https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-For
2. https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header

## Additional Information
**Privacy:** Users' privacy should be considered when forwarding client IP addresses. Ensure your organization's privacy policy discloses the collection and processing of IP address information.

**Security Trust:** Any information in the `X-Forwarded-For` header supplied by the client (before reaching your trusted infrastructure) is untrusted and can be easily spoofed. Backend applications and security controls (like rate limiting) must be configured to trust only the IPs appended by your own NGINX instance or known trusted proxies, ignoring the client-supplied part of the chain.

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 8.11 Conduct Audit Log Reviews | N | Y | Y |
| v7 | 6.7 Regularly Review Logs | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Defense Evasion | T1070 - Indicator Removal |
| Command and Control | T1090 - Proxy |

## Profile
- Level 1 - Proxy
- Level 1 - Loadbalancer
