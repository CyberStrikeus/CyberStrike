---
name: cis-nginx-v300-4-1-8
description: "Ensure HTTP Strict Transport Security (HSTS) is enabled (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, tls-ssl, encryption]
cis_id: "4.1.8"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 4.1.8 — Ensure HTTP Strict Transport Security (HSTS) is enabled

## Profile Applicability
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description
HTTP Strict Transport Security (HSTS) is a critical security header that instructs browsers to communicate with a domain exclusively over HTTPS. A comprehensive HSTS policy must include the `includeSubDomains` directive to apply the policy to all current and future subdomains. For maximum protection, the policy should also contain the `preload` directive, allowing the domain to be submitted to browser-pre-load lists. This ensures that even the very first connection to the domain is made securely. The `max-age` should be set to a long duration, typically two years (`63072000` seconds), to ensure browsers enforce this policy persistently.

## Rationale
HSTS is the primary mechanism to mitigate protocol downgrade attacks and cookie hijacking. By enforcing HTTPS, it prevents attackers from intercepting requests and manipulating them. The `includeSubDomains` directive is vital as it closes a significant gap where an attacker could otherwise target a non-secure subdomain. The `preload` directive provides protection by removing the initial window of opportunity for an attack on a user's first visit, as the browser already knows to use HTTPS before making any connection.

## Impact
Once an HSTS policy with a long `max-age` is set, there is effectively "no going back." If any part of your site or any subdomain cannot be served over HTTPS, users with a cached HSTS policy will be unable to access it. Enabling `includeSubDomains` requires a commitment that all subdomains of the domain will support HTTPS. Submitting a domain to the HSTS preload list is a long-term commitment and removal is a slow, manual process. Careful planning and testing with short `max-age` values are essential before full deployment.

## Audit Procedure
Run the following command to inspect the fully loaded NGINX configuration for the `Strict-Transport-Security` header:

```bash
nginx -T 2>/dev/null | grep -i 'Strict-Transport-Security'
```

Verify that the output includes a header with the following components:

- A `max-age` directive of at least `31536000` (one year), with `63072000` (two years) being the recommended value.
- The `includeSubDomains` directive.
- The `always` parameter at the end of the `add_header` directive.

Example output:

```
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
```

## Remediation
It is critical to deploy HSTS incrementally to avoid locking users out.

**Step 1: Initial Rollout (Low `max-age`)**

Add the HSTS header with a very short `max-age` to test for any issues. Verify that all parts of your site, including all subdomains, function correctly over HTTPS.

```nginx
# Test with 5 minutes
add_header Strict-Transport-Security "max-age=300; includeSubDomains" always;
```

**Step 2: Increase `max-age`**

Once confident, gradually increase the `max-age`.

```nginx
# Increase to 1 week
add_header Strict-Transport-Security "max-age=604800; includeSubDomains" always;
```

**Step 3: Full Deployment (Long `max-age` and Preload)**

After thorough testing (e.g., one month), set the `max-age` to the recommended final value of two years. Add the `preload` directive if you intend to submit your site to the HSTS preload list.

```nginx
# Final configuration (2 years)
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

If preloading is desired, submit your domain at hstspreload.org.

## Default Value
HSTS headers are not set by default.

## References
1. https://hstspreload.org
2. https://tools.ietf.org/html/rfc6797

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.10 Encrypt Sensitive Data in Transit | N | Y | Y |
| v7 | 14.4 Encrypt All Sensitive Information in Transit | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Credential Access | T1557 - Adversary-in-the-Middle |
| Collection | T1185 - Browser Session Hijacking |

## Profile
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
