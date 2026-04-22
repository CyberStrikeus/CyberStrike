---
name: cis-nginx-v300-5-3-2
description: "Ensure that Content Security Policy (CSP) is enabled and configured properly (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, browser-security, request-filtering]
cis_id: "5.3.2"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 5.3.2 — Ensure that Content Security Policy (CSP) is enabled and configured properly

## Profile Applicability
- Level 2 - Webserver

## Description
**C**ontent **S**ecurity **P**olicy (CSP) is an HTTP response header that allows site administrators to declare approved sources of content that browsers are allowed to load on that page. It is a mechanism to detect and mitigate certain types of attacks, including **C**ross-**S**ite **S**cripting (XSS) and data injection attacks. Furthermore, CSP's `frame-ancestors` directive is the modern replacement for the `X-Frame-Options` header to prevent Clickjacking.

## Rationale
A robust CSP significantly reduces the attack surface of a web application. By restricting the domains from which scripts, styles, images, and other resources **can be loaded**, it effectively neutralizes many XSS vectors. Additionally, by using the `frame-ancestors` directive, it explicitly controls **which parent pages are allowed to embed the application** (e.g., via `<iframe>`), providing a more flexible protection against Clickjacking than the legacy `X-Frame-Options` header.

## Impact
Implementing a strict CSP is complex and carries **a high risk of breaking application functionality**. **If a legitimate resource** (e.g., a CDN script, a font file, or an inline script) **is not whitelisted**, the browser will block it, potentially making the site unusable. CSP implementation should always start in "Report-Only" mode (`Content-Security-Policy-Report-Only`) to gather violation reports before enforcing the policy.

## Audit Procedure

**1. Run the following command to inspect the CSP configuration:**

```bash
nginx -T 2>/dev/null | grep -i 'Content-Security-Policy'
```

**2. Evaluate the policy:**

- Is the header present?
- Does it include at least a restrictive `default-src` directive (e.g., `'self'` or `'none'`)?
- Does it include the `frame-ancestors` directive to mitigate Clickjacking?
- Critically: Is `unsafe-inline` or `unsafe-eval` avoided in `script-src`? (Allowing these significantly weakens the protection).

## Remediation
CSP must be tailored to the specific application. There is no single "correct" policy.

**Step 1: The Baseline Policy (High Security)**

Start with a policy that denies everything by default and only allows resources from the same origin. It also prevents the site from being framed by anyone (Clickjacking protection).

```nginx
add_header Content-Security-Policy "default-src 'self'; frame-ancestors 'self'; form-action 'self';" always;
```

**Step 2: Adaptation (Example)**

If your application loads images from a CDN and needs to be embeddable by a specific partner site:

```nginx
add_header Content-Security-Policy "default-src 'self'; img-src 'self' https://cdn.example.com; frame-ancestors 'self' https://partner-site.com;" always;
```

**Note:** Use `Content-Security-Policy-Report-Only` during the testing phase to debug your policy without breaking the site.

## Default Value
By default, no Content Security Policy is sent. Browsers default to the standard Same-Origin Policy, which is much less restrictive.

## References
1. https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html
2. https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html
3. https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy
4. https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy-Report-Only
5. https://nginx.org/en/docs/http/ngx_http_headers_module.html#add_header
6. https://caniuse.com/?search=frame-ancestors

## Additional Information
OWASP HTTP Headers Cheat Sheet states:

Content Security Policy (CSP) `frame-ancestors` directive obsoletes `X-Frame-Options` for supporting browsers (source).

`X-Frame-Options` header is only useful when the HTTP response where it is included has something to interact with (e.g. links, buttons). If the HTTP response is a redirect or an API returning JSON data, `X-Frame-Options` does not provide any security.

Recommendation: Use Content Security Policy (CSP) frame-ancestors directive if possible.

Almost all modern browsers do support CSP. A comprehensive overview of compatible browsers can be found here: https://caniuse.com/?search=frame-ancestors

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 2.7 Allowlist Authorized Scripts | N | N | Y |
| v7 | 2.9 Implement Application Whitelisting of Scripts | N | N | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Initial Access | T1189 - Drive-by Compromise |
| Execution | T1059.007 - JavaScript |

## Profile
- Level 2 - Webserver
