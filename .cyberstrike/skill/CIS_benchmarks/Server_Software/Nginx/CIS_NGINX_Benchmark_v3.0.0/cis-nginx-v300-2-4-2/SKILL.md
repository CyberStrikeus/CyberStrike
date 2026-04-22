---
name: cis-nginx-v300-2-4-2
description: "Ensure requests for unknown host names are rejected (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, network-configuration, basic-configuration]
cis_id: "2.4.2"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.4.2 — Ensure requests for unknown host names are rejected

## Profile Applicability
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description
NGINX routes incoming requests to the appropriate virtual host by matching the `Host` header (HTTP/1.1) or `:authority` pseudo-header (HTTP/2, HTTP/3) against the `server_name` directives. If no explicit match is found, NGINX falls back to the first defined `server` block **or** the one marked as `default_server`. Without a properly configured catch-all block that rejects unknown hostnames, your server will respond to arbitrary domain names that happen to point to your IP address, potentially exposing internal applications or enabling Host Header attacks.

## Rationale
When NGINX receives a request, it selects the virtual host based on the `Host` header (or `:authority` in HTTP/2/3). If requests for unknown host names are not explicitly rejected, your applications may be served for arbitrary domains that simply point to your IP. This behavior can be abused in Host Header attacks and makes it harder to distinguish legitimate traffic from automated scans or misrouted requests in your logs.

## Impact
Clients accessing the server directly via IP address or an unconfigured **CNAME** will be rejected. This is intended behavior but requires that all valid domains are explicitly defined in their own `server` blocks.

## Audit Procedure

**1. Review Configuration:**

Check for the existence of a default `server` block that handles unknown hosts.

```bash
nginx -T 2>/dev/null | grep -Ei "listen.*default_server|ssl_reject_handshake"
```

**Evaluation:**

- Ensure a `server` block exists with `listen ... default_server`.
- Verify it contains `return 444;` (closes connection) or a `4xx` error code.
- For HTTPS/TLS: Verify `ssl_reject_handshake on;` is used to prevent certificate leakage.

**2. Functional Test:**

Send a request with an invalid Host header and verify the connection is rejected or returns an error.

```bash
# Test HTTPS (expect connection reset or 4xx)
curl -k -v https://127.0.0.1 -H 'Host: invalid.example.com'
```

## Remediation
Configure a "Catch-All" default `server` block as the **first** block in your configuration (or explicitly marked with `default_server`).

**Configuration Example (Modern Standard with TLS/HTTP3):**

```nginx
server {
    # Listen on standard ports for IPv4 and IPv6
    listen       80  default_server;
    listen [::]:80  default_server;

    # Listen for HTTPS (TCP) and QUIC (UDP)
    listen       443 ssl  default_server;
    listen [::]:443 ssl  default_server;
    listen       443 quic default_server;
    listen [::]:443 quic default_server;

    # Reject SSL Handshake for unknown domains (Prevents cert leakage)
    ssl_reject_handshake on;

    # Catch-all name
    server_name _;

    # Close connection without response (Non-standard code 444)
    return 444;
}
```

After adding this block, ensure all your valid applications have their own `server` blocks with explicit `server_name` directives.

## Default Value
By default, if no `default_server` is defined, NGINX uses the first `server` block configuration it finds, potentially serving your application for any incoming request regardless of the Host header.

## References
1. https://nginx.org/en/docs/http/request_processing.html
2. https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Host
3. https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/07-Input_Validation_Testing/17-Testing_for_Host_Header_Injection
4. https://portswigger.net/web-security/host-header

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 4.1 Establish and Maintain a Secure Configuration Process | Y | Y | Y |
| v7 | 5.1 Establish Secure Configurations | Y | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Initial Access | T1190 - Exploit Public-Facing Application |
| Reconnaissance | T1595 - Active Scanning |

## Profile
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
