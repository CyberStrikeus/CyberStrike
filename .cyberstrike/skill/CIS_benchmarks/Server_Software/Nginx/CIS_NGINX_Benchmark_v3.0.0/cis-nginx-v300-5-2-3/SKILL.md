---
name: cis-nginx-v300-5-2-3
description: "Ensure the maximum buffer size for URIs is defined (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, request-limits, request-filtering]
cis_id: "5.2.3"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 5.2.3 — Ensure the maximum buffer size for URIs is defined

## Profile Applicability
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description
The `large_client_header_buffers` directive allocates the **maximum number** and **size** of buffers for reading the **entire** client request header, which includes **both** the request line (e.g., `GET /path HTTP/1.1`) **and all** subsequent header fields (e.g., `Host:`, `Cookie:`, `Authorization:`). If a client's request header exceeds the total allocated buffer space, NGINX immediately rejects the request with a `400 Bad Request` error. Also, the client's request line cannot exceed the size of **one** buffer, otherwise the `414 Request-URI Too Large` error will be returned to the client.

## Rationale
While NGINX itself is not vulnerable to buffer overflows from large headers, this directive serves two critical purposes:

**1. Denial of Service (DoS) Mitigation:** It prevents malicious clients from attempting to exhaust server memory by sending excessively large headers.

**2. Downstream Protection:** It acts as a gatekeeper, ensuring that malformed or oversized headers **do not** reach backend applications that might be more fragile or could exhibit undefined behavior when processing them.

The default value is intentionally generous to handle legitimate modern web traffic, and lowering it without reason can be counterproductive.

## Impact
Setting this value too low is a common cause of difficult-to-diagnose application failures. Legitimate requests from modern web applications, especially those using complex authentication (OAuth/SAML), or analytics, can easily generate headers larger than a few kilobytes. An overly restrictive value will cause these legitimate requests to fail with a generic `400 Bad Request` error, which is often mistakenly attributed to the application itself rather than the NGINX configuration.

## Audit Procedure
This is a manual check that requires context.

**1. Run the following command to see if the directive is explicitly set:**

```bash
nginx -T 2>/dev/null | grep 'large_client_header_buffers'
```

**2. Evaluate the result:**

- **No output:** The server is using the default value of `4 8k`. This is considered compliant and secure for general use.
- **Output shows `large_client_header_buffers 4 8k;`:** The default is explicitly set. This is compliant.
- **Output shows a different value (e.g., `2 1k;`):** This is a deviation from the default. Manually verify if this restrictive value is documented, intentional, and necessary for the specific application. If not, it represents a potential availability risk and should be flagged.

## Remediation
Unless you have a specific, documented requirement to restrict header sizes further, the recommended action is to rely on the secure default value. If your configuration has an overly restrictive value set without a clear reason, remove the `large_client_header_buffers` directive from your `http` or `server` blocks to allow NGINX to fall back to its default.

**Remediation Action:**

Remove any custom, overly restrictive `large_client_header_buffers` lines from your configuration files.

```nginx
# REMOVE THIS LINE if it exists without good reason:
large_client_header_buffers 2 1k;
```

## Default Value
The default value is `large_client_header_buffers 4 8k;`, meaning NGINX will allocate up to **4x buffers** of **8 kilobytes** each per request. This generous default is designed to accommodate the vast majority of legitimate web traffic, including requests with large cookies or complex authorization headers, without problems. It is considered the secure and recommended baseline.

## References
1. https://nginx.org/en/docs/http/ngx_http_core_module.html#large_client_header_buffers

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 16.1 Establish and Maintain a Secure Application Development Process | N | Y | Y |
| v7 | 18.1 Establish Secure Coding Practices | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Impact | T1499 - Endpoint Denial of Service |
| Impact | T1499.003 - Application Exhaustion Flood |

## Profile
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
