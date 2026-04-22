---
name: cis-nginx-v300-2-4-4
description: "Ensure send_timeout is set to 10 seconds or less, but not 0 (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, network-configuration, basic-configuration]
cis_id: "2.4.4"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.4.4 — Ensure send_timeout is set to 10 seconds or less, but not 0

## Profile Applicability
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description
The `send_timeout` directive sets a timeout for transmitting a response to the client between two successive write operations.

## Rationale
Setting the `send_timeout` directive on the server side helps mitigate slow HTTP denial of service attacks by ensuring write operations taking up large amounts of time are closed.

## Impact
Setting the `send_timeout` to a low value may impact clients with slow connections or applications that stream large responses.

## Audit Procedure

To check the current setting for the `send_timeout` directive, issue the below command. You should also manually check your nginx configuration for include statements that may be located outside the `/etc/nginx` directory. If none of these are present, the value is set at the default.

```bash
grep -ir send_timeout /etc/nginx
```

The output of the command should be similar to the following:

```nginx
send_timeout  10;
```

## Remediation
Find the `HTTP` or `server` block of your nginx configuration, and add the `send_timeout` directive. Set it to `10` seconds or less, but not `0`.

```nginx
send_timeout    10;
```

## Default Value

```nginx
send_timeout 60s;
```

## References
1. https://www.owasp.org/index.php/SCG_WS_nginx
2. https://nginx.org/en/docs/http/ngx_http_core_module.html#send_timeout

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 16.1 Establish and Maintain a Secure Application Development Process | N | Y | Y |
| v7 | 18.1 Establish Secure Coding Practices | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Impact | T1499 - Endpoint Denial of Service |

## Profile
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
