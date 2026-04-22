---
name: cis-nginx-v300-5-2-4
description: "Ensure the number of connections per IP address is limited (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, request-limits, request-filtering]
cis_id: "5.2.4"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 5.2.4 — Ensure the number of connections per IP address is limited

## Profile Applicability

- Level 2 - Webserver
- Level 2 - Proxy
- Level 2 - Loadbalancer

## Description

NGINX's `ngx_http_limit_conn_module` provides a mechanism to limit the number of simultaneous connections from a single client IP address. This is achieved in two steps:

- `limit_conn_zone`: This directive, typically defined in the `http` block, creates a shared memory zone to store the state for each client IP address.
- `limit_conn`: This directive, applied in a `server` or `location` block, **enforces** a specific connection limit using the previously defined zone.

When a client exceeds this limit, NGINX will reject new connections with a `503 Service Temporarily Unavailable` error.

## Rationale

The primary purpose of connection limiting is to **mitigate** resource exhaustion and certain types of Denial of Service (DoS) attacks where an attacker opens many connections and holds them open for as long as possible. It is a different tool than rate limiting (`limit_req`), which is designed to stop rapid-fire requests (like brute-force attacks). By enforcing a reasonable connection limit, the server can prevent a single malicious or misconfigured client from consuming an unfair share of worker connections.

## Impact

This is a critical consideration. A single public IP address can represent **thousands** of individual users behind a large corporate NAT, a university campus, or a Carrier-Grade NAT (CG-NAT) from a mobile provider. Setting the connection limit too low will block legitimate users in these scenarios. The appropriate limit is a delicate balance and depends entirely on the target audience. A public-facing website requires a much higher limit than a restricted admin interface.

## Audit Procedure

This is a manual check requiring context.

**1. Run the following command to inspect the loaded NGINX configuration for connection limiting rules:**

```bash
nginx -T 2>/dev/null | grep -E '^\s*(limit_conn_zone|limit_conn)'
```

**2. Manually evaluate the findings:**

- Is a `limit_conn_zone` defined in the `http` block?
- Is a `limit_conn` directive applied in the appropriate `server` or `location` blocks?

Critically, assess the configured limit. Is a limit of `10` appropriate for a public website accessed by customers or large companies? Or is it a sensible value for a specific `/login` location? The value must be justifiable for its context.

## Remediation

First, define a shared memory zone in the `http` block. Then, apply a carefully considered limit in the `server` or `location` context.

**Understanding the zone size:** The memory usage for the `$binary_remote_addr` key is fixed (`64 bytes` **on a 64-bit system**). Therefore, `1 megabyte` of zone memory can store approximately `16,384` states. A `10m` zone can store over `160,000` states.

**Example Configuration:**

```nginx
http {

    # Define a 10MB zone named 'per_ip' to track connections by IP.
    # $binary_remote_addr is more memory-efficient than $remote_addr.
    limit_conn_zone $binary_remote_addr zone=per_ip:10m;

    server {

        # Apply a general limit of 20 connections per IP for this server.
        # This might be a reasonable starting point for a public site.
        limit_conn per_ip 20;

        # For a resource-intensive download area, apply a stricter limit.
        location /downloads/ {
            limit_conn per_ip 5;
        }
    }
}
```

## Default Value

By default, no connection limits are configured. NGINX will accept as many simultaneous connections from a single IP address as its worker processes can handle.

## References

1. https://nginx.org/en/docs/http/ngx_http_limit_conn_module.html

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

- Level 2 - Webserver
- Level 2 - Proxy
- Level 2 - Loadbalancer
