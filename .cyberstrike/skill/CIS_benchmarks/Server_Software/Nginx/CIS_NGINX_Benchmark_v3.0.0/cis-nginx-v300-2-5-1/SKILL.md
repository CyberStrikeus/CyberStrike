---
name: cis-nginx-v300-2-5-1
description: "Ensure server_tokens directive is set to off (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, information-disclosure, basic-configuration]
cis_id: "2.5.1"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.5.1 — Ensure server_tokens directive is set to `off`

## Profile Applicability

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description

The `server_tokens` directive is responsible for displaying the NGINX version number and operating system version on error pages and in the `Server` HTTP response header field. This information should not be displayed.

## Rationale

Attackers can conduct reconnaissance on a website using these response headers, then target attacks for specific known vulnerabilities associated with the underlying technologies. Hiding the version will slow down and deter some potential attackers.

## Impact

None. Disabling server tokens does not affect functionality. It merely removes the version string from error pages and headers. Note that determined attackers can still fingerprint NGINX via other methods, but removing the banner raises the bar for opportunistic scanners.

## Audit Procedure

In the NGINX configuration file `nginx.conf`, verify the `server_tokens` directive is set to `off`. To do this, check the response headers for the server header by issuing this command:

```bash
curl -I 127.0.0.1 | grep -i server
```

The output should not contain the server header providing your server version, such as the below:

```
Server: nginx/1.28.0
```

## Remediation

Disable version disclosure globally by adding the directive to the `http` block in `/etc/nginx/nginx.conf`:

```nginx
http {
    ...
    server_tokens       off;
    ...
}
```

## Default Value

The default value of `server_tokens` is `on`.

## References

1. https://nginx.org/en/docs/http/ngx_http_core_module.html#server_tokens

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
