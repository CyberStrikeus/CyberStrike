---
name: cis-nginx-v300-5-2-2
description: "Ensure the maximum request body size is set correctly (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, request-limits, request-filtering]
cis_id: "5.2.2"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 5.2.2 — Ensure the maximum request body size is set correctly

## Profile Applicability
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description
The `client_max_body_size` directive defines the maximum permissible size for a client request body, as indicated by the `Content-Length` header. If a request exceeds this size, NGINX will immediately reject it with a `413 Request Entity Too Large` error, preventing the oversized request from being processed further or passed to a backend application.

## Rationale
Limiting the request body size is a crucial defense against resource exhaustion DoS attacks and prevents oversized, potentially malicious payloads from reaching application backends. By setting a logical default limit and only increasing it for specific application endpoints that require it (e.g., file uploads), the principle of least functionality is enforced, significantly reducing the attack surface.

## Impact
Setting this value too low is a common cause of application failure. Legitimate user actions, such as uploading files or submitting large forms, will be blocked with a `413` error **if** they exceed the configured limit. It is essential that this value is determined based on application requirements and not set to an arbitrary low number.

## Audit Procedure
Run the following command to inspect the fully loaded NGINX configuration for the `client_max_body_size` directive:

```bash
nginx -T 2>/dev/null | grep -E '^\s*(client_max_body_size)'
```

Verify that a global `client_max_body_size` is set in the `http` block. For any location blocks that override this value (e.g., for uploads), **manually** verify that the increased limit is documented and aligns with the application's functional requirements.

## Remediation
Define a restrictive global limit in the `http` block. For specific application endpoints that need to accept larger request bodies, override this directive within the corresponding `location` block.

**Example Configuration:**

```nginx
http {

    # Set a restrictive global default of 2 Megabytes. This prevents
    # unexpected large requests on most endpoints.
    client_max_body_size 2M;

    server {
        # ...

        # This location handles API requests with potentially large JSON payloads.
        location /api/v1/data {
            client_max_body_size 10M; # Allow up to 10MB
            # ...
        }

        # This location is for large file uploads.
        location /uploads {
            client_max_body_size 50M; # Allow up to 50MB
            # ...
        }
    }
}
```

## Default Value
The default value is 1 megabyte (`1m`). It's recommended to set this value **explicitly** in the `http` block to serve as a documented, global default. For many API endpoints or static content locations, even this default may be more permissive than necessary.

## References
1. https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 16.1 Establish and Maintain a Secure Application Development Process | N | Y | Y |
| v7 | 18.1 Establish Secure Coding Practices | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Impact | T1499 - Endpoint Denial of Service |
| Initial Access | T1190 - Exploit Public-Facing Application |

## Profile
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
