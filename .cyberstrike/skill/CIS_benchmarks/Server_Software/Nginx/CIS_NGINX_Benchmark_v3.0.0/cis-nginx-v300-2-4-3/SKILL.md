---
name: cis-nginx-v300-2-4-3
description: "Ensure keepalive_timeout is 10 seconds or less, but not 0 (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, network-configuration, basic-configuration]
cis_id: "2.4.3"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.4.3 — Ensure keepalive_timeout is 10 seconds or less, but not 0

## Profile Applicability

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description

Persistent connections are leveraged by all modern browsers to facilitate greater web performance. The keep-alive timeout limits the time a persistent connection may remain open. Setting the keep-alive timeout allows this timeout to be controlled on the server side.

## Rationale

Setting a keep-alive timeout on the server side helps mitigate denial of service attacks that establish too many persistent connections, exhausting server resources.

## Impact

Setting the `keepalive_timeout` to a low value may impact performance for clients with high-latency connections or applications that require long-lived connections.

## Audit Procedure

To check the current setting for the `keepalive_timeout` directive, issue the below command. You should also manually check your nginx configuration for include statements that may be located outside the `/etc/nginx` directory. If none of these are present, the value is set at the default.

```bash
grep -ir keepalive_timeout /etc/nginx
```

The output of the command should contain something similar to the following:

```nginx
keepalive_timeout 10;
```

## Remediation

Find the `HTTP` or `server` block of your nginx configuration, and add the `keepalive_timeout` directive. Set it to `10` seconds or less, but not `0`. This example command sets it to `10` seconds:

```nginx
keepalive_timeout 10;
```

## Default Value

By default, this timeout is dictated by the user agent and varies. It is not set on the server side by default.

## References

1. https://nginx.org/en/docs/http/ngx_http_core_module.html#keepalive_timeout

## CIS Controls

| Controls Version | Control                                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 16.1 Establish and Maintain a Secure Application Development Process | N    | Y    | Y    |
| v7               | 18.1 Establish Secure Coding Practices                               | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic | Technique                          |
| ------ | ---------------------------------- |
| Impact | T1499 - Endpoint Denial of Service |

## Profile

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
