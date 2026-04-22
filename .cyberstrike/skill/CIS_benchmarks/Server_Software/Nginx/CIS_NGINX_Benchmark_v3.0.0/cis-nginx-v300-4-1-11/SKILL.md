---
name: cis-nginx-v300-4-1-11
description: "Ensure Secure Session Resumption is Enabled (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, tls-ssl, encryption]
cis_id: "4.1.11"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 4.1.11 — Ensure Secure Session Resumption is Enabled

## Profile Applicability

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description

TLS 1.3 introduces a secure session resumption mechanism using **P**re-**S**hared **K**eys (PSKs) that significantly improves performance for returning clients by reducing the handshake latency. This modern mechanism should be enabled to enhance user experience without compromising security.

## Rationale

Unlike older TLS versions, the TLS 1.3 resumption mechanism preserves **P**erfect **F**orward **S**ecrecy (PFS). It accomplishes this by combining the PSK with a **fresh** Ephemeral Diffie-Hellman key exchange (ECDHE) for **every** resumed session. This ensures that a compromise of the resumption key does not compromise any past or future session keys. Disabling this feature provides no security benefit and negatively impacts performance.

## Impact

Enabling session resumption has a positive performance impact. There are no significant negative security implications when using a TLS 1.3-only configuration.

## Audit Procedure

Run the following command to verify that `ssl_session_tickets` **is not** explicitly turned `off`.

```bash
# This command should produce NO output.
grep -ir "ssl_session_tickets" /etc/nginx/ | grep -i "off"
```

If the command produces any output containing `ssl_session_tickets off;`, this recommendation is not implemented.

## Remediation

Ensure that `ssl_session_tickets` is not set to `off`. The recommended approach is to remove the directive entirely, as the default value is `on`.

If the directive is present, either remove it or set it to `on`:

```nginx
# REMOVE this line from your configuration:
# ssl_session_tickets off;

# OR, if you want to be explicit, ensure it is set to ON (optional):
ssl_session_tickets  on;
```

## Default Value

`ssl_session_tickets` is enabled (`on`) by default. This is the desired and secure state for TLS 1.3.

## References

1. https://datatracker.ietf.org/doc/html/rfc8446
2. https://nginx.org/en/docs/http/ngx_http_ssl_module.html#ssl_session_tickets
3. https://www.cloudflare.com/learning/ssl/what-happens-in-a-tls-handshake/

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            | N    | Y    | Y    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic            | Technique                       |
| ----------------- | ------------------------------- |
| Credential Access | T1557 - Adversary-in-the-Middle |

## Profile

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
