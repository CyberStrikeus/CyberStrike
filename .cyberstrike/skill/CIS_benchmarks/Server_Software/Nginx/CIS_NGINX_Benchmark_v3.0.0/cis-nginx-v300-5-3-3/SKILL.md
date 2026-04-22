---
name: cis-nginx-v300-5-3-3
description: "Ensure the Referrer Policy is enabled and configured properly (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, browser-security, request-filtering]
cis_id: "5.3.3"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 5.3.3 — Ensure the Referrer Policy is enabled and configured properly

## Profile Applicability

- Level 2 - Webserver

## Description

The `Referrer-Policy` HTTP header controls how much referrer information (sent via the `Referer` header) should be included with requests. It allows site administrators to restrict the data sent to upstream servers when a user clicks a link or loads a resource. This is a privacy control to prevent leaking sensitive URL parameters or internal path structures to third parties.

## Rationale

URLs often contain sensitive information such as session tokens, search queries, or **P**ersonally **I**dentifiable **I**nformation (PII) in their query parameters. Without a strict Referrer Policy, this full URL is transmitted to any third-party site the user visits from your page, potentially logging sensitive data on external servers. Configuring this header ensures that only the necessary information (e.g., just the origin domain) is shared, protecting user privacy and preventing data leakage.

## Impact

Choosing an overly restrictive policy like `no-referrer` can break functionality that relies on knowing the source of traffic, such as web analytics, affiliate tracking, or multi-site authentication flows. Conversely, a loose policy (`unsafe-url`) leaks private data. The recommended policy `strict-origin-when-cross-origin` is a balance by preserving full referrer data for internal navigation while stripping sensitive path and query data when navigating to external sites.

## Audit Procedure

Run the following command to inspect the fully loaded NGINX configuration:

```bash
nginx -T 2>/dev/null | grep -i 'Referrer-Policy'
```

**Evaluate the findings:**

- Verify that the directive `add_header Referrer-Policy "..." always;` is present.
- Check the configured value. While `no-referrer` is the most secure, `strict-origin-when-cross-origin` is the widely accepted standard for balancing security and functionality.
- Ensure the `always` parameter is present.

## Remediation

Add the `Referrer-Policy` header to your `server` block. The recommended value is `strict-origin-when-cross-origin`.

```nginx
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

**Policy Options (from most to least restrictive):**

| Policy                            | Behavior                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `no-referrer`                     | Never send the Referer header. Most private but breaks analytics.                                                                    |
| `same-origin`                     | Send full referrer for same-origin requests only. No referrer for cross-origin.                                                      |
| `strict-origin-when-cross-origin` | **Recommended.** Full referrer for same-origin. Origin-only for cross-origin (HTTPS->HTTPS). No referrer on downgrade (HTTPS->HTTP). |
| `origin-when-cross-origin`        | Full referrer for same-origin. Origin-only for cross-origin.                                                                         |
| `unsafe-url`                      | Always send full referrer. **Not recommended.**                                                                                      |

## Default Value

By default, no `Referrer-Policy` header is sent by NGINX. Browsers typically default to `strict-origin-when-cross-origin`, but explicitly setting this header ensures consistent behavior across all browsers and versions.

## References

1. https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy
2. https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html#referrer-policy
3. https://nginx.org/en/docs/http/ngx_http_headers_module.html

## CIS Controls

| Controls Version | Control                                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 16.1 Establish and Maintain a Secure Application Development Process | N    | Y    | Y    |
| v7               | 18.1 Establish Secure Coding Practices                               | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic       | Technique                            |
| ------------ | ------------------------------------ |
| Collection   | T1185 - Browser Session Hijacking    |
| Exfiltration | T1041 - Exfiltration Over C2 Channel |

## Profile

- Level 2 - Webserver
