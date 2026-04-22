---
name: cis-nginx-v300-4-1-6
description: "Ensure awareness of TLS 1.3 new Diffie-Hellman parameters (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, tls-ssl, encryption]
cis_id: "4.1.6"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 4.1.6 — Ensure awareness of TLS 1.3 new Diffie-Hellman parameters

## Profile Applicability
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description
This control is not applicable to environments exclusively using TLS 1.3.

## Rationale
The TLS 1.3 protocol (RFC 8446) deprecates the use of custom finite-field Diffie-Hellman (DHE) groups, which were configured via the `ssl_dhparam` directive in NGINX. Instead, TLS 1.3 exclusively uses a set of pre-defined, standardized, and secure elliptic curve (ECDHE) and finite-field (FFDHE) groups for its key exchange mechanism. This design eliminates the risk associated with weak or misconfigured custom DH parameters. As such, the `ssl_dhparam` directive has no effect in a TLS 1.3-only configuration.

## Impact
None for a TLS 1.3-only configuration.

## Audit Procedure
Verify that the configuration does not rely on TLS 1.2 **or older protocols** that would require this setting. This control is implicitly passed if control 4.1.4 ("Ensure only modern TLS protocols are used") is configured for TLS 1.3 exclusively.

## Remediation
No remediation is necessary. Ensure `ssl_protocols TLSv1.3;` is set. The `ssl_dhparam` directive should be removed as it is obsolete.

## Default Value
Not applicable for TLS 1.3-only configurations.

## References
1. https://datatracker.ietf.org/doc/html/rfc8446#page-95
2. https://nginx.org/en/docs/http/ngx_http_ssl_module.html#ssl_dhparam

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.10 Encrypt Sensitive Data in Transit | N | Y | Y |
| v7 | 14.4 Encrypt All Sensitive Information in Transit | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Credential Access | T1557 - Adversary-in-the-Middle |

## Profile
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
