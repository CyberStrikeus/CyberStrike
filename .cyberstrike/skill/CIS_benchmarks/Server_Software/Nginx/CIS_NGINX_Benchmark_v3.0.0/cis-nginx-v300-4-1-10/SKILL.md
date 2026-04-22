---
name: cis-nginx-v300-4-1-10
description: "Ensure the upstream traffic server certificate is trusted (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, tls-ssl, encryption]
cis_id: "4.1.10"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 4.1.10 — Ensure the upstream traffic server certificate is trusted

## Profile Applicability
- Level 2 - Proxy
- Level 2 - Loadbalancer

## Description
When acting as a reverse proxy, NGINX must be configured to function as a secure TLS client. This requires validating the identity of the upstream server by verifying its certificate against a **trusted Certificate Authority** (CA). Furthermore, NGINX must ensure that the hostname of the upstream server matches the name (Subject Name / SAN) within the certificate itself.

## Rationale
Without proper validation, NGINX blindly trusts the identity of the upstream server, making it vulnerable to man-in-the-middle (MitM) attacks within the internal network. An attacker could impersonate a legitimate backend service and intercept sensitive traffic. By enforcing certificate validation (`proxy_ssl_verify`) and hostname verification (`proxy_ssl_name`), NGINX guarantees that it is communicating with the intended, authentic upstream server.

## Impact
Enabling strict upstream verification introduces a dependency on certificate lifecycle management. If the upstream server's certificate expires or is misconfigured, or if the CA certificate file on the NGINX server is outdated, NGINX will refuse to connect to the upstream, resulting in a service outage. This behavior is intentional and secures the connection at the cost of requiring careful certificate management.

## Audit Procedure
Run the following command to inspect the fully loaded NGINX configuration for the three required directives within the relevant proxy `location` block:

```bash
nginx -T 2>/dev/null | grep -E \
'^\s*(proxy_ssl_verify|proxy_ssl_trusted_certificate|proxy_ssl_name)'
```

Verify that the output contains the following directives:

- `proxy_ssl_verify on;`
- `proxy_ssl_trusted_certificate /path/to/ca.crt;`
- `proxy_ssl_name your-upstream-hostname.com;`

If any of these three directives are missing, this recommendation is not fully implemented. Additionally, manually verify that the certificate referenced by `proxy_ssl_trusted_certificate` is the correct, valid CA certificate for your upstream services.

## Remediation
To securely configure upstream validation, you must obtain the CA certificate that signed your upstream server's certificate.

1. Place the CA certificate (e.g., `upstream_ca.crt`) in a secure directory on the NGINX server (e.g., `/etc/nginx/ssl/`).
2. In the `location` block that proxies traffic, add the following three directives. The `proxy_ssl_name` must match the hostname used in the `proxy_pass` directive.

```nginx
location /api/ {
    proxy_pass                    https://your-upstream-hostname.com;

    # 1. Enable verification
    proxy_ssl_verify              on;

    # 2. Specify the CA to trust for verification
    proxy_ssl_trusted_certificate /etc/nginx/ssl/upstream_ca.crt;

    # 3. Verify the certificate's name matches the server's hostname
    proxy_ssl_name                your-upstream-hostname.com;
}
```

## Default Value
By default, `proxy_ssl_verify` is set to `off`. This means NGINX **does not validate the upstream server's certificate**, creating a significant security risk equivalent to a browser ignoring all certificate warnings.

## References
1. https://docs.nginx.com/nginx/admin-guide/security-controls/securing-http-traffic-upstream/
2. https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_ssl_trusted_certificate

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.10 Encrypt Sensitive Data in Transit | N | Y | Y |
| v7 | 14.4 Encrypt All Sensitive Information in Transit | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Credential Access | T1557 - Adversary-in-the-Middle |
| Lateral Movement | T1021 - Remote Services |

## Profile
- Level 2 - Proxy
- Level 2 - Loadbalancer
