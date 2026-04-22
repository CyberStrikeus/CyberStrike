---
name: cis-nginx-v300-4-1-12
description: "Ensure HTTP/3.0 is used (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, tls-ssl, encryption, http3]
cis_id: "4.1.12"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 4.1.12 — Ensure HTTP/3.0 is used

## Profile Applicability

- Level 2 - Webserver

## Description

HTTP/2 is the established standard for web communication, offering significant performance benefits over HTTP/1.1 through multiplexing. For 2025 and beyond, HTTP/3 should also be enabled. HTTP/3 operates over the **QUIC** protocol, which is built on **UDP**, to solve head-of-line blocking, reduce connection setup time, and improve performance on unreliable networks. Both protocols require a secure TLS 1.3 environment to function.

## Rationale

Enabling HTTP/2 provides a baseline of modern performance via stream multiplexing. Enabling HTTP/3 provides a further competitive advantage by mitigating TCP's head-of-line blocking and offering a faster, more reliable connection handshake, which is especially beneficial for mobile users. A server supporting **both** protocols can serve the vast majority of modern clients with the best possible performance and security. The strong encryption requirements of both protocols naturally align with a TLS 1.3-only policy.

## Impact

HTTP/2 has no significant negative impact as it is universally supported by modern clients. Enabling HTTP/3 has operational considerations:

1. **NGINX Build:** Your NGINX binary must be compiled with HTTP/3 and **QUIC** support. Standard OS packages may not include this. The repository of NGINX itself has the **http_v3** module since NGINX version 1.25.0

   Run this command and check if the **http_v3** module is present:

   ```bash
   nginx -V 2>&1 | tr ' ' '\n' | grep --color=auto 'with-'
   ```

2. **Firewall Configuration: You must allow UDP** traffic on port `443`, as HTTP/3 uses the **QUIC** protocol over **UDP**. This is a common oversight that will cause HTTP/3 to fail.

## Audit Procedure

Run the following command to inspect the fully loaded NGINX configuration:

```bash
nginx -T 2>/dev/null | grep -E '^\s*(listen|add_header.*Alt-Svc)'
```

Verify the following in the output for your primary `server` block:

1. The TCP `listen` directive **includes** the `http2` parameter: `listen 443 ssl http2;`
2. A **UDP** `listen` directive with the `quic` parameter exists: `listen 443 quic reuseport;`
3. An `Alt-Svc` header is being sent to advertise HTTP/3 availability: `add_header Alt-Svc 'h3=":443"; ma=63072000';`

If any of these are missing, this recommendation is not fully implemented.

## Remediation

**Prerequisite:** Ensure your NGINX version is compiled with the `--with-http_v3_module` flag.

1. Open your NGINX server configuration file.
2. In the main `server` block for your HTTPS site, add or modify the directives to enable HTTP/2, HTTP/3, and advertise its availability.
3. Ensure your firewall **allows UDP** traffic on port `443`.

```nginx
server {
    # 1. Enable HTTP/2 on the standard TCP listener
    listen          443       ssl http2;
    listen          [::]:443 ssl http2;

    # 2. Enable HTTP/3 on the UDP listener
    listen          443       quic reuseport;
    listen          [::]:443 quic reuseport;

    # ... other ssl directives like ssl_certificate ...

    # 3. Advertise HTTP/3 availability to browsers
    # The max-age (ma) is in seconds (e.g., 2 years)
    add_header      Alt-Svc 'h3=":443"; ma=63072000';

    # Required for HTTP/3
    ssl_early_data  on;
}
```

## Default Value

By default, NGINX only enables HTTP/1.1. HTTP/2 and HTTP/3 must be explicitly configured.

## References

1. https://nginx.org/en/docs/http/ngx_http_v3_module.html
2. https://datatracker.ietf.org/doc/html/rfc9114
3. https://nginx.org/en/docs/http/ngx_http_v2_module.html

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            | N    | Y    | Y    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic            | Technique                                 |
| ----------------- | ----------------------------------------- |
| Credential Access | T1557 - Adversary-in-the-Middle           |
| Initial Access    | T1190 - Exploit Public-Facing Application |

## Profile

- Level 2 - Webserver
