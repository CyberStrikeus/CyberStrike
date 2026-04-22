---
name: cis-nginx-v300-2-5-4
description: "Ensure the NGINX reverse proxy does not enable information disclosure (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, information-disclosure, basic-configuration]
cis_id: "2.5.4"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.5.4 — Ensure the NGINX reverse proxy does not enable information disclosure

## Profile Applicability
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description
When NGINX acts as a reverse proxy, it forwards headers sent by the upstream application (e.g., `"X-Powered-By: Custom_APP"` or `"Server: Apache/2.4"`). These headers should be stripped before the response reaches the client to prevent information disclosure about the backend infrastructure.

## Rationale
Attackers conduct reconnaissance by inspecting response headers to identify the technologies used in the backend (e.g., specific versions of PHP, Java/Tomcat, or Python frameworks). Knowing the exact version allows attackers to target specific CVEs associated with that software stack. Removing these headers reduces the information available for targeted attacks.

## Impact
Removing upstream headers may affect debugging or monitoring tools that rely on these headers. Ensure that any required headers are logged internally before being stripped.

## Audit Procedure

**1. Configuration Check:**

Search the loaded configuration for header hiding directives:

```bash
nginx -T 2>/dev/null | grep -Ei "(proxy|fastcgi)_hide_header"
```

**Evaluation:**

- Verify that directives exist to hide `X-Powered-By` and `Server`.

**2. Functional Check (Recommended):**

Send a request to a proxied endpoint and inspect the response headers:

```bash
curl -k -I https://127.0.0.1 | grep -Ei "^(Server|X-Powered-By)"
```

**Evaluation:**

- **PASS:** The output does not contain backend details (e.g., `X-Powered-By: PHP/8.2`). If Server is present, it should only be `Server: nginx` (controlled by Control 2.5.1).
- **FAIL:** The output contains backend information or unmasked version numbers.

## Remediation
Configure NGINX to strip the sensitive headers. The directive depends on the upstream protocol (HTTP Proxy vs. FastCGI).

**For Standard Reverse Proxy (`proxy_pass`):**

Add the following directives to your `http`, `server`, or `location` block:

```nginx
proxy_hide_header X-Powered-By;
proxy_hide_header Server;
```

**For PHP/FastCGI (`fastcgi_pass`):**

If you are using FastCGI (e.g., for PHP-FPM), use the `fastcgi_hide_header` directive instead:

```nginx
fastcgi_hide_header X-Powered-By;
```

## Default Value
By default, NGINX passes all headers received from the upstream server to the client unchanged.

## References
1. https://nginx.org/en/docs/http/ngx_http_proxy_module.html
2. https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_hide_header

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 16.1 Establish and Maintain a Secure Application Development Process | N | Y | Y |
| v7 | 18.1 Establish Secure Coding Practices | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Reconnaissance | T1592 - Gather Victim Host Information |

## Profile
- Level 1 - Proxy
- Level 1 - Loadbalancer
