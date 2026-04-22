---
name: cis-nginx-v300-2-5-3
description: "Ensure hidden file serving is disabled (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, information-disclosure, basic-configuration]
cis_id: "2.5.3"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.5.3 — Ensure hidden file serving is disabled

## Profile Applicability
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description
Hidden files and directories (starting with a dot, e.g., `.git`, `.env`) often contain sensitive metadata, version control history, or environment configurations. Serving these files should be globally disabled.

## Rationale
Version control systems (Git, SVN) and editors create hidden files that may unintentionally be deployed to the web root. If accessible, files like `.git/config` or `.env` can leak database credentials, source code, and infrastructure details, leading to full system compromise. Blocking requests to any path starting with a dot (`.`) neutralizes this risk.

## Impact
Blocking all dot-files will break Let's Encrypt / Certbot validation (`.well-known/acme-challenge`) unless explicitly allowed. Ensure the exception rule is placed **before** the deny rule or is more specific.

## Audit Procedure

**1. Check Configuration:**

Search the loaded configuration for hidden file protection rules:

```bash
nginx -T 2>/dev/null | grep "location.*\\\."
```

**Evaluation:**

- Look for a block like `location ~ /\. { deny all; ... }`.

**2. Functional Test (Recommended):**

Try to access a dummy hidden file:

```bash
curl -k -I https://127.0.0.1/.git/HEAD
```

**Evaluation:**

- **PASS:** Returns `403 Forbidden` or `404 Not Found`.
- **FAIL:** Returns `200 OK` (if file exists) or the content of the file.

## Remediation
To restrict access to hidden files, add the configuration block below inside each server block.

**Option A: Direct Configuration**

Place this block directly into your `server` contexts:

```nginx
# Allow Let's Encrypt validation (must be before the deny rule)
location ^~ /.well-known/acme-challenge/ {
    allow all;
    default_type "text/plain";
}

# Deny access to all other hidden files
location ~ /\. {
    deny all;
    return 404;
}
```

**Option B: Using a Shared Snippet (Recommended)**

Create a reusable snippet file (e.g., `/etc/nginx/snippets/deny-hidden.conf`) containing the rules above, and include it in your `server` blocks:

1. Create `/etc/nginx/snippets/deny-hidden.conf` with the content from Option A.
2. Security Check: Ensure the new file has restrictive permissions (Owner: `root:root`, Mode: `640`) as described in Recommendation 2.3.2.
3. Add the include directive to your server blocks:

```nginx
server {
    # Modern HTTP/3 (QUIC) and HTTP/2 Setup

    listen 443 ssl;              # TCP for HTTP/1.1 & HTTP/2
    listen 443 quic reuseport;   # UDP for HTTP/3
    http2 on;                    # Explicitly enable HTTP/2 (since NGINX 1.25.1)

    server_name example.com;

    include /etc/nginx/snippets/deny-hidden.conf;

    # ... rest of configuration
}
```

## Default Value
This protection is not set by default. NGINX will serve any hidden file if it exists in the web root.

## References
1. https://nginx.org/en/docs/http/ngx_http_core_module.html#location
2. https://nginx.org/en/docs/http/ngx_http_access_module.html#deny
3. https://capec.mitre.org/data/definitions/139.html
4. https://cwe.mitre.org/data/definitions/538.html

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 16.1 Establish and Maintain a Secure Application Development Process | N | Y | Y |
| v7 | 18.1 Establish Secure Coding Practices | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Reconnaissance | T1592 - Gather Victim Host Information |
| Collection | T1213 - Data from Information Repositories |

## Profile
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
