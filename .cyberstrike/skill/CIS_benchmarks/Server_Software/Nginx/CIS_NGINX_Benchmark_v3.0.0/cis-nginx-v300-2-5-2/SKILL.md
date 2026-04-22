---
name: cis-nginx-v300-2-5-2
description: "Ensure default error and index.html pages do not reference NGINX (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, information-disclosure, basic-configuration]
cis_id: "2.5.2"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.5.2 — Ensure default error and index.html pages do not reference NGINX

## Profile Applicability

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description

Default error pages (e.g., `404`, `500`) and the default welcome page often contain NGINX branding or signatures. These pages should be removed or replaced with generic or custom-branded pages that do not disclose the underlying server technology.

## Rationale

Standard NGINX error pages visually identify the server software, even if headers are suppressed. By gathering information about the underlying technology stack, attackers can tailor their exploits to known vulnerabilities of NGINX. Replacing default pages with generic or branded content removes this information leakage vector and increases the effort required for successful reconnaissance.

## Impact

Creating and maintaining custom error pages requires additional administrative effort. Ensure that custom error pages are simple and do not themselves introduce vulnerabilities.

## Audit Procedure

**1. Verify Config:**

Check if `error_page` directives are active:

```bash
nginx -T 2>/dev/null | grep -i "error_page"
```

**2. Verify Content (Functional Test):**

Trigger an error (e.g., request a non-existent page) and inspect the body:

```bash
curl -k https://127.0.0.1/non-existent-page | grep -i "nginx"
```

**Evaluation:**

- **PASS:** The output does not contain "nginx" (or `grep` returns nothing).
- **FAIL:** The HTML body contains "nginx".

## Remediation

Instead of editing the default files (which may be overwritten by package updates), configure NGINX to use custom error pages.

**1. Create Custom Error Pages:**

Create a directory (e.g., `/var/www/html/errors`) and place generic HTML files there (e.g., `404.html`, `50x.html`) **without** NGINX branding.

**2. Configure NGINX:**

Add the `error_page` directive to your `http` or `server` blocks:

```nginx
error_page 404 /404.html;
error_page 500 502 503 504 /50x.html;

location = /50x.html {
    root /var/www/html/errors;
    internal;
}
```

## Default Value

Default error pages identify the server as NGINX.

## References

1. https://nginx.org/en/docs/http/ngx_http_core_module.html#error_page

## CIS Controls

| Controls Version | Control                                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 16.1 Establish and Maintain a Secure Application Development Process | N    | Y    | Y    |
| v7               | 18.1 Establish Secure Coding Practices                               | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic         | Technique                              |
| -------------- | -------------------------------------- |
| Reconnaissance | T1592 - Gather Victim Host Information |

## Profile

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
