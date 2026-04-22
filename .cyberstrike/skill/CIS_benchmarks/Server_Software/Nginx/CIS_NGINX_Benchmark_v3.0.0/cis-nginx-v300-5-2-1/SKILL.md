---
name: cis-nginx-v300-5-2-1
description: "Ensure timeout values for reading the client header and body are set correctly (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, request-limits, request-filtering]
cis_id: "5.2.1"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 5.2.1 — Ensure timeout values for reading the client header and body are set correctly

## Profile Applicability

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description

To protect against slow clients holding connections open indefinitely, NGINX supports several timeout directives. The most important ones for client-facing connections are:

- `client_header_timeout`: Sets the maximum time the server will wait for a client to send the request header.
- `client_body_timeout`: Sets the maximum time allowed between sequential read operations when receiving the request body. This timer does not apply to the total time of the transfer.
- `send_timeout`: Sets the maximum time allowed between sequential write operations when sending a response to the client.

If any of these timeouts are reached, the server closes the connection, freeing up resources.

## Rationale

Aggressively low timeout values are a primary defense against slow-read Denial of Service (DoS) attacks. These attacks attempt to exhaust server resources by opening many connections and keeping them alive for as long as possible by sending data extremely slowly. By setting low timeouts, NGINX efficiently closes these malicious connections, preserving resources for legitimate users.

## Impact

Setting these values too low can terminate legitimate connections too early. For example, a user uploading a large file over a slow mobile connection could be cut off if `client_body_timeout` is too aggressive. The values must be carefully evaluated to achieve a balance between security (low values) **and** functionality (higher values for specific use cases such as file uploads).

## Audit Procedure

Run the following command to inspect the fully loaded NGINX configuration for the relevant directives:

```bash
nginx -T 2>/dev/null | grep -E '^\s*(client_header_timeout|client_body_timeout|send_timeout)'
```

Verify that these values are explicitly set to a reasonably low, non-default value (e.g., 10-20 seconds) in the main `http` or `server` context. If the application requires long-running connections, verify that `client_body_timeout` is overridden to a higher value in the specific `location` block that handles uploads.

## Remediation

Set reasonably low timeout values globally in your `http` block. If specific locations **require** longer timeouts (e.g., for file uploads), override them within that `location` block.

**Example Configuration:**

```nginx
http {

    # Set a global default of 15 seconds, which overrides the default of 60s.

    client_header_timeout 15s;
    client_body_timeout   15s;
    send_timeout          15s;

    server {
        # ... other settings ...

        # This location handles large file uploads and needs a longer timeout.
        location /upload {

            client_body_timeout 300s; # Allow 5 minutes between read operations for uploads
            # ...
        }
    }
}
```

## Default Value

The default value for `client_header_timeout`, `client_body_timeout`, and `send_timeout` is 60 seconds. This is often considered **too high for public-facing servers**, because it allows slow or malicious clients to uphold connections and resources for an extended period.

## References

1. https://nginx.org/en/docs/http/ngx_http_core_module.html#client_header_timeout
2. https://nginx.org/en/docs/http/ngx_http_core_module.html#client_body_timeout
3. https://nginx.org/en/docs/http/ngx_http_core_module.html#send_timeout

## CIS Controls

| Controls Version | Control                                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 16.1 Establish and Maintain a Secure Application Development Process | N    | Y    | Y    |
| v7               | 18.1 Establish Secure Coding Practices                               | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic | Technique                          |
| ------ | ---------------------------------- |
| Impact | T1499 - Endpoint Denial of Service |
| Impact | T1499.001 - OS Exhaustion Flood    |

## Profile

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
