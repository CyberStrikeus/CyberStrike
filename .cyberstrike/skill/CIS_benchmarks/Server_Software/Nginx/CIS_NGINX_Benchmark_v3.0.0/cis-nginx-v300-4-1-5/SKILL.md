---
name: cis-nginx-v300-4-1-5
description: "Disable weak ciphers (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, tls-ssl, encryption]
cis_id: "4.1.5"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 4.1.5 — Disable weak ciphers

## Profile Applicability
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description
The `ssl_protocols` directive must be used to disable weak protocols and exclusively enable TLS 1.3. In a TLS 1.3-only configuration, the `ssl_ciphers` directive is no longer necessary, as the protocol itself mandates a small, non-negotiable set of highly secure AEAD ciphers (**A**uthenticated **E**ncryption with **A**ssociated **D**ata). This approach simplifies configuration and eliminates the risk of choosing weak or insecure cipher suites.

The `ssl_prefer_server_ciphers` directive should be set to off for TLS 1.3. Since all available ciphers are secure, allowing the client (user agent) to choose the most performant cipher for its hardware provides a performance benefit without compromising security.

In a reverse proxy setup, it is critical to ensure that any upstream services also support TLS 1.3. If an upstream server requires an older protocol, the `proxy_ssl_protocols` and `proxy_ssl_ciphers` directives must be configured to match the upstream's requirements, but this should be treated as a temporary exception to be remediated.

## Rationale
Weak cryptographic ciphers can lead to the compromise of sensitive data. In modern TLS configurations, the most effective way to disable all weak ciphers is to exclusively enable the TLS 1.3 protocol. The TLS 1.3 specification removes all previously known weak and legacy cipher suites, mandating the use of a small set of highly secure Authenticated Encryption (AEAD) ciphers. This approach is simpler and less error-prone than maintaining a complex denylist or allowlist of ciphers for older protocols.

## Impact
Impact of Mandating TLS 1.3:

Enforcing an exclusive TLS 1.3 configuration enhances security but will intentionally cause connection failures for legacy clients. This primarily affects:

- Unsupported User Agents: Clients on outdated operating systems (e.g., Android < 10, iOS < 12.2, Windows < 10 without updates) and very old browsers (e.g., Internet Explorer) that do not support TLS 1.3 will be unable to connect. These clients are typically outside their vendor's security lifecycle and pose an independent risk.
- Legacy Upstream Services: In a reverse proxy scenario, if NGINX is configured for TLS 1.3 exclusively, it will be unable to establish a connection to an upstream (backend) server that only supports TLS 1.2 or older. This will cause service disruptions. A thorough assessment of backend compatibility is required before enforcement.

## Audit Procedure
Use the following procedure to verify that only `ssl_protocols TLSv1.3;` is used.

```bash
nginx -T 2>/dev/null | grep -E '^\s*ssl_protocols'
```

The output must show `ssl_protocols TLSv1.3;` exclusively for every relevant configuration block (e.g., at the `http` or `server` level).

Example output:

```
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
# configuration file /etc/nginx/nginx.conf:
        ssl_protocols TLSv1.3;
# configuration file /etc/nginx/conf.d/default.conf:
        ssl_protocols TLSv1.3;
```

## Remediation
Set `ssl_protocols TLSv1.3;`. The `ssl_ciphers` directive is not required for a TLS 1.3-only configuration, as the secure defaults of the underlying crypto library (e.g., OpenSSL) will be used.

## Default Value
These directives are not specified by default and are set to the default of `HIGH:!aNULL:!MD5`.

## References
1. https://mozilla.github.io/server-side-tls/ssl-config-generator/
2. https://nginx.org/en/docs/http/ngx_http_ssl_module.html

## Additional Information
**Note:** TLS configuration should always be set to your organizational policy. This recommendation is designed to meet best practices and offers several profiles your organization may align to.

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.10 Encrypt Sensitive Data in Transit | N | Y | Y |
| v7 | 14.4 Encrypt All Sensitive Information in Transit | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Credential Access | T1557 - Adversary-in-the-Middle |
| Initial Access | T1190 - Exploit Public-Facing Application |

## Profile
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
