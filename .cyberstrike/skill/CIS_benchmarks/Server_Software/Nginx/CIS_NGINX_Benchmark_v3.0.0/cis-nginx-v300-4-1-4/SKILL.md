---
name: cis-nginx-v300-4-1-4
description: "Ensure only modern TLS protocols are used (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, tls-ssl, encryption]
cis_id: "4.1.4"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 4.1.4 — Ensure only modern TLS protocols are used

## Profile Applicability

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description

Only modern TLS protocols should be enabled in NGINX for all client connections and upstream connections. Removing legacy TLS and SSL protocols (SSL 3.0, TLS 1.0, 1.1 and 1.2), and enable stable TLS protocols (TLS 1.3), ensures users are able to take advantage of strong security capabilities and protects them from insecure legacy protocols.

## Rationale

**Why disable SSL 3.0:** The POODLE Vulnerability allowed attackers to exploit SSL 3.0 to obtain cleartext information by exploiting weaknesses in CBC in 2014. SSL 3.0 is also no longer FIPS 140-2 compliant.

**Why disable TLS 1.0:** TLS 1.0 was deprecated from use when PCI DSS Compliance mandated that it not be used for any applications processing credit card numbers in June 2018. TLS 1.0 does not make use of modern protections, and almost all user agents that do not support TLS 1.2 or higher are no longer supported by their vendor.

**Why disable TLS 1.1:** Because of the increased security associated with higher versions of TLS, TLS 1.0 should be disabled. Modern browsers will begin to flag TLS 1.1 as deprecated in early 2019.

**Why disable TLS 1.2:** While robust for its time, TLS 1.2's complexity allows for weak configurations, including cipher suites that lack Perfect Forward Secrecy. TLS 1.3 eliminates this risk by mandating PFS and removing outdated cryptographic primitives. Acknowledging this, NIST SP 800-52 Rev. 2 allows for TLS 1.2 to be disabled if it is not required for interoperability, positioning TLS 1.3 as the sole recommended protocol for modern, secure environments.

**Why enable TLS 1.3:** TLS 1.3 improves security by removing several insecure cipher suites by default and adding several more secure algorithms. All public-key exchange mechanisms support perfect forward secrecy in this version of TLS. Additionally, TLS 1.3 makes drastic performance improvements by removing a full round trip in the TLS handshake.

## Impact

Disabling certain TLS may not allow legacy user agents to connect to your server. Disabling negotiation of specific protocols with your backend server may also limit your ability to connect with legacy servers. You should always consider if you need to support legacy user agents or servers when selecting your TLS protocols.

## Audit Procedure

You can verify which SSL/TLS protocols your server uses by issuing the below command to see the configured cipher suites on the server. If anything older than TLS 1.3 is implemented or nothing appears, this recommendation is not implemented.

```bash
grep -ir ssl_protocol /etc/nginx
```

**Note:** Depending on your configuration, you may see different results. The directive `ssl_protocols` should always be part of your server block. If your NGINX server is also a proxy or load balancer, you should also check for the presence of the `proxy_ssl_protocols` directive as part of the location block of your nginx configuration. This ensures your proxy follows a specific set of negotiation rules for encrypting traffic with your upstream server.

## Remediation

Run the following commands to change your `ssl_protocols` if they are already configured. This remediation advice assumes your nginx configuration file does not include server configuration outside of `/etc/nginx/nginx.conf`. You may have to also inspect the include files in your `nginx.conf` to ensure this is properly implemented.

**Web Server:**

```bash
sed -i "s/ssl_protocols[^;]*/ssl_protocols TLSv1.3;/" /etc/nginx/nginx.conf
```

**Proxy:**

```bash
sed -i "s/proxy_ssl_protocols[^;]*/proxy_ssl_protocols TLSv1.3;/" \
/etc/nginx/nginx.conf
```

If your `ssl_protocols` are not already configured, this can be accomplished manually by opening your web server or proxy server configuration file and manually adding the directives.

**Web Server:**

```nginx
server {
    ssl_protocols TLSv1.3;
}
```

**Proxy:**

```nginx
location / {
    proxy_pass          cisecurity.org;
    proxy_ssl_protocols TLSv1.3;
}
```

## Default Value

By default, NGINX does not specify the TLS protocol and accepts all TLS versions, except for TLS 1.3, which must be enabled by an administrator to take effect.

Defaults: ssl_protocols TLSv1.0 TLSv1.1 TLSv1.2 proxy_ssl_protocols TLSv1.0 TLSv1.1 TLSv1.2

## References

1. https://webkit.org/blog/8462/deprecation-of-legacy-tls-1-0-and-1-1-versions/
2. https://www.cloudflare.com/learning/ssl/why-use-tls-1.3/
3. https://tools.ietf.org/html/rfc8446
4. https://doi.org/10.6028/NIST.SP.800-52r2

## Additional Information

**Note:** TLS configuration should always be set to your organizational policy. This recommendation is designed to meet best practices.

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

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
