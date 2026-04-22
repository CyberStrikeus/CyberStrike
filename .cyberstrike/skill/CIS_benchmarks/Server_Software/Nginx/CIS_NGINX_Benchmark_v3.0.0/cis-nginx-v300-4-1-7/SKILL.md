---
name: cis-nginx-v300-4-1-7
description: "Ensure Online Certificate Status Protocol (OCSP) stapling is enabled (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, tls-ssl, encryption]
cis_id: "4.1.7"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 4.1.7 — Ensure Online Certificate Status Protocol (OCSP) stapling is enabled

## Profile Applicability

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description

OCSP stapling allows a server to efficiently deliver certificate revocation information to the client, improving performance and privacy. The server caches the OCSP response from the Certificate Authority (CA), eliminating the need for the client to make a separate connection. For robust security, certificates should be issued with the OCSP Must-Staple extension, which transforms the traditional "soft-fail" behavior into a "hard-fail," ensuring clients always receive and validate a current revocation status.

## Rationale

OCSP stapling is a critical mechanism for distributing certificate revocation status. Without it, clients might not be aware that a server's certificate has been compromised, allowing for potential man-in-the-middle attacks. The OCSP Must-Staple extension is essential as it mitigates the inherent weakness of optional OCSP ("soft-fail"), where a browser might proceed with a connection if it doesn't receive a staple. By enforcing a "hard-fail", Must-Staple ensures that a compromised certificate can be reliably blocked.

## Impact

If OCSP Must-Staple is used, a misconfiguration on the server (e.g., a firewall blocking outbound OCSP queries, an incorrect DNS resolver) will cause clients to reject the certificate and refuse to connect, leading to a service outage. This "hard-fail" behavior is intentional for security but requires diligent configuration and monitoring of the OCSP stapling mechanism.

## Audit Procedure

Run the following command to inspect the fully loaded NGINX configuration for the four required directives:

```bash
nginx -T 2>/dev/null | grep -E \
'^\s*(ssl_stapling|ssl_stapling_verify|ssl_trusted_certificate|resolver)'
```

Verify that the output contains the following directives with appropriate values within the relevant `http` or `server` blocks:

- `ssl_stapling on;`
- `ssl_stapling_verify on;`
- `ssl_trusted_certificate /path/to/your/chain.pem;`
- `resolver A.B.C.D;`

If any of these four directives are missing, this recommendation is not fully implemented.

## Remediation

Follow this procedure to enable a robust OCSP stapling configuration:

1. When issuing a certificate, request that the OCSP Must-Staple extension be included.
2. Edit your NGINX configuration to include all four necessary directives. The `ssl_trusted_certificate` must point to a file containing your root and intermediate certificates. The resolver must be set to one or more trusted DNS resolvers.

```nginx
# Example for a server block
server {
    # ... other directives ...

    # OCSP Stapling
    ssl_stapling             on;
    ssl_stapling_verify      on;

    # Path to the certificate chain (Root CA + Intermediates) for verification
    ssl_trusted_certificate  /etc/nginx/ssl/full_chain.pem;

    # DNS resolver for NGINX to query the CA's OCSP server
    resolver                 8.8.8.8 1.1.1.1 valid=300s;
}
```

## Default Value

OCSP stapling is not enabled by default.

## References

1. https://nginx.org/en/docs/http/ngx_http_ssl_module.html#ssl_stapling
2. https://datatracker.ietf.org/doc/html/rfc6066
3. https://datatracker.ietf.org/doc/html/rfc7633

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            | N    | Y    | Y    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic            | Technique                             |
| ----------------- | ------------------------------------- |
| Credential Access | T1557 - Adversary-in-the-Middle       |
| Defense Evasion   | T1556 - Modify Authentication Process |

## Profile

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
