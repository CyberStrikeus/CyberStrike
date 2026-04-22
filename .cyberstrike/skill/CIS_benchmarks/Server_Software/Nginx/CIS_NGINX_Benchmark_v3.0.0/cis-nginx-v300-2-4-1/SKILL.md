---
name: cis-nginx-v300-2-4-1
description: "Ensure NGINX only listens for network connections on authorized ports (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, network-configuration, basic-configuration]
cis_id: "2.4.1"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.4.1 — Ensure NGINX only listens for network connections on authorized ports

## Profile Applicability

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description

NGINX should be configured to listen only on authorized ports and protocols. While traditional HTTP/1.1 and HTTP/2 use TCP ports `80` and `443`, modern HTTP/3 (QUIC) utilizes UDP port `443`. Ensuring that NGINX binds only to approved interfaces and ports minimizes the attack surface.

## Rationale

Limiting listening ports to authorized values ensures that no hidden or unintended services are exposed via NGINX. It also enforces strict control over which protocols (TCP vs. UDP) are accessible, which is particularly important with the introduction of UDP-based HTTP/3 traffic alongside traditional TCP traffic.

## Impact

Disabling unused ports reduces the risk of unauthorized access. However, administrators must be aware that disabling UDP port `443` will break HTTP/3 connectivity, forcing clients to fall back to slower TCP-based HTTP/2 or HTTP/1.1.

## Audit Procedure

**1. Inspect Configuration:**

Run the following command to inspect all listen directives in the loaded configuration:

```bash
nginx -T 2>/dev/null | grep -r "listen"
```

**Evaluation:**

Review the output for unauthorized ports. A modern secure configuration typically includes:

- `listen 80;` (TCP) - Often used only for redirecting to HTTPS.
- `listen 443 ssl;` (TCP) - For HTTP/1.1 and HTTP/2.
- `listen 443 quic;` (UDP) - For HTTP/3 (QUIC).

**Example Output:**

```nginx
server {
    listen  80;
    listen 443 ssl;
    listen 443 quic reuseport; # HTTP/3 (UDP)
    ...
}
```

Ensure that no other ports (e.g., `8080`, `8443`) are open unless explicitly authorized for internal services or management interfaces.

**2. Verify System Listening Ports:**

Optionally, verify what the process is actually binding to on the OS level:

```bash
netstat -tulpen | grep -i nginx
```

- Look for `tcp` lines for standard traffic.
- Look for `udp` lines (e.g., `*:443`) if HTTP/3 is enabled.

## Remediation

Remove or comment out any `listen` directives that bind to unauthorized ports.

**For HTTP/3 (QUIC) Support:** Ensure that you explicitly authorize and configure UDP port `443` in addition to TCP port `443`.

```nginx
server {
    # Standard HTTPS (TCP)
    listen 443 ssl;

    # HTTP/3 (UDP)
    listen 443 quic reuseport;

    # ... SSL/TLS configuration ...
}
```

## Default Value

By default, NGINX often listens only on TCP port `80`. Modern secure defaults should listen on TCP `80` (for redirect), TCP `443`, and optionally UDP `443` (for HTTP/3).

## References

1. https://nginx.org/en/docs/http/ngx_http_core_module.html#listen

## CIS Controls

| Controls Version | Control                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 16.10 Apply Secure Design Principles in Application Architectures  | N    | Y    | Y    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic    | Technique                         |
| --------- | --------------------------------- |
| Discovery | T1046 - Network Service Discovery |

## Profile

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
