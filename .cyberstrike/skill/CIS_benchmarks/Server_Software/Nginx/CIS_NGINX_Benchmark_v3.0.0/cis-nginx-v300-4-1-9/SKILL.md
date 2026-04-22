---
name: cis-nginx-v300-4-1-9
description: "Ensure upstream server traffic is authenticated with a client certificate (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, tls-ssl, encryption]
cis_id: "4.1.9"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 4.1.9 — Ensure upstream server traffic is authenticated with a client certificate

## Profile Applicability

- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description

In a reverse proxy configuration, NGINX acts as a client when communicating with an upstream server. To secure this server-to-server connection based on a Zero Trust principle, **m**utual **TLS** (mTLS) must be used. This is achieved by configuring NGINX to present its own client certificate to the upstream server. The upstream server then authenticates NGINX based on this certificate, ensuring that only trusted proxies can access backend services.

## Rationale

Authenticating the proxy's connection to the upstream server via a client certificate provides strong, cryptographic proof of identity. This is vastly superior to weaker authentication methods like IP whitelisting, which can be spoofed. In a modern microservices or cloud environment, mTLS is a cornerstone of network security, as it prevents unauthorized services from making requests to sensitive backends, thereby mitigating lateral movement attacks.

## Impact

Implementing mTLS introduces operational overhead for certificate management. You must have a process (often an internal **P**ublic **K**ey Infrastructure, or PKI) for issuing, renewing, and revoking these client certificates. If the client certificate used by NGINX expires, or if the CA certificate on the upstream server expires, the connection between NGINX and the upstream will fail, leading to a service outage.

## Audit Procedure

Run the following command to inspect the fully loaded NGINX configuration for the required directives:

```bash
nginx -T 2>/dev/null | grep -E \
'^\s*(proxy_ssl_certificate|proxy_ssl_certificate_key)'
```

Verify that the output includes both `proxy_ssl_certificate` and `proxy_ssl_certificate_key` directives with the correct paths within the relevant location block.

**Note:** A complete audit is two-sided. You must also verify that the upstream server is configured to require and validate client certificates against a trusted CA. This part of the audit is outside the scope of the NGINX configuration itself.

## Remediation

Implementing mTLS requires configuration on both the NGINX proxy (the client) and the upstream server (the server). This example assumes you have a simple internal CA.

**Prerequisite: Create a CA**

```bash
# Create CA Key
openssl genrsa -out my-ca.key 4096
# Create CA Certificate
openssl req -x509 -new -nodes -key my-ca.key -sha256 -days 3650 -out my-ca.crt
```

**Step 1: Configure the Upstream Server to Require Client Certificates**

The upstream server must be configured to request and verify client certificates against your CA. (If your upstream is also NGINX, the config would look like this):

```nginx
# On the Upstream Server's configuration
server {
    listen 443 ssl;
    # ... other ssl directives ...

    ssl_client_certificate  /path/to/my-ca.crt; # The CA to verify against
    ssl_verify_client on;                        # Require a valid client cert
}
```

**Step 2: Create and Sign a Client Certificate for NGINX**

On your NGINX proxy, create a key and a certificate signing request (CSR).

```bash
# Create a key for the NGINX proxy
openssl genrsa -out       nginx-client.key 4096
# Create CSR
openssl req    -new -key nginx-client.key -out nginx-client.csr
```

Sign this CSR with your CA to create the client certificate:

```bash
openssl x509  -req -in nginx-client.csr -CA my-ca.crt -CAkey my-ca.key -CAcreateserial -out nginx-client.crt -days 365
```

**Step 3: Configure NGINX to Present its Client Certificate**

In your NGINX reverse proxy configuration, use the generated client certificate and key.

```nginx
# In your reverse proxy's location block
location /api/ {
    proxy_pass                https://your-upstream-server;

    # Present this client cert to the upstream
    proxy_ssl_certificate     /etc/nginx/ssl/nginx-client.crt;
    proxy_ssl_certificate_key /etc/nginx/ssl/nginx-client.key;
}
```

## Default Value

This is not authenticated by default.

## References

1. https://docs.nginx.com/nginx-instance-manager/system-configuration/secure-traffic/
2. https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_ssl_certificate

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            | N    | Y    | Y    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic            | Technique                       |
| ----------------- | ------------------------------- |
| Credential Access | T1557 - Adversary-in-the-Middle |
| Lateral Movement  | T1021 - Remote Services         |

## Profile

- Level 1 - Proxy
- Level 1 - Loadbalancer
