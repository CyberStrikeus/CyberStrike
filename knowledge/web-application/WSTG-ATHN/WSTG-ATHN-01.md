# WSTG-ATHN-01: Testing for Credentials Transported over an Encrypted Channel

## Test ID
WSTG-ATHN-01

## Test Name
Testing for Credentials Transported over an Encrypted Channel

## High-Level Description

This test verifies that user credentials (usernames, passwords, tokens) are transmitted over encrypted channels (HTTPS/TLS) to prevent interception by attackers. Transmitting credentials over unencrypted HTTP exposes them to man-in-the-middle attacks, network sniffing, and session hijacking. All authentication-related traffic must be encrypted.

---

## What to Check

### Encryption Requirements

- [ ] Login pages served over HTTPS
- [ ] Login form submits to HTTPS endpoint
- [ ] Password reset over HTTPS
- [ ] Registration over HTTPS
- [ ] API authentication over HTTPS
- [ ] Session tokens transmitted securely

### Common Vulnerabilities

| Issue | Risk |
|-------|------|
| HTTP login page | Credential interception |
| Mixed content (HTTPS page, HTTP form action) | Form hijacking |
| HTTP redirects before HTTPS | SSL stripping |
| Insecure API endpoints | Token theft |

---

## How to Test

### Step 1: Check Login Page Protocol

```bash
# Check if login page is served over HTTPS
curl -sI "http://target.com/login" | head -20
curl -sI "https://target.com/login" | head -20

# Check for HTTP to HTTPS redirect
curl -sI -L "http://target.com/login" 2>&1 | grep -i "location\|http"

# Verify no mixed content
curl -s "https://target.com/login" | grep -i "http://"
```

### Step 2: Analyze Login Form Action

```bash
# Get login form and check action URL
curl -s "https://target.com/login" | grep -i "<form" | grep -i "action"

# Check if form action is HTTPS
curl -s "https://target.com/login" | \
    grep -oP 'action="[^"]*"' | \
    head -5

# Look for JavaScript that might change form action
curl -s "https://target.com/login" | grep -i "form.action\|submit"
```

### Step 3: Test Actual Login Request

```bash
# Attempt login and capture request details
curl -v -X POST "https://target.com/api/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"test","password":"test123"}' 2>&1 | \
    grep -i "< \|> \|ssl\|tls"

# Check for secure cookies
curl -sI -X POST "https://target.com/api/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"test","password":"test123"}' | \
    grep -i "set-cookie"

# Verify Secure flag on session cookies
```

### Step 4: Test HTTP Availability

```bash
# Check if HTTP endpoints are accessible
endpoints=(
    "/login"
    "/api/login"
    "/api/auth"
    "/register"
    "/password-reset"
    "/api/token"
)

for endpoint in "${endpoints[@]}"; do
    http_status=$(curl -s -o /dev/null -w "%{http_code}" "http://target.com$endpoint")
    https_status=$(curl -s -o /dev/null -w "%{http_code}" "https://target.com$endpoint")

    echo "$endpoint - HTTP: $http_status, HTTPS: $https_status"

    if [ "$http_status" != "301" ] && [ "$http_status" != "302" ] && [ "$http_status" != "000" ]; then
        echo "  [WARNING] HTTP endpoint accessible without redirect"
    fi
done
```

### Step 5: Check TLS Configuration

```bash
# Test TLS version support
nmap --script ssl-enum-ciphers -p 443 target.com

# Check for weak protocols
openssl s_client -connect target.com:443 -ssl3 2>&1 | head -5
openssl s_client -connect target.com:443 -tls1 2>&1 | head -5
openssl s_client -connect target.com:443 -tls1_1 2>&1 | head -5
openssl s_client -connect target.com:443 -tls1_2 2>&1 | head -5
openssl s_client -connect target.com:443 -tls1_3 2>&1 | head -5

# Check certificate validity
openssl s_client -connect target.com:443 -servername target.com 2>/dev/null | \
    openssl x509 -noout -dates
```

### Step 6: Test HSTS Implementation

```bash
# Check for HSTS header
curl -sI "https://target.com" | grep -i "strict-transport-security"

# Verify HSTS parameters
# Should include: max-age (long duration), includeSubDomains, preload

# Check HSTS preload status
# https://hstspreload.org/?domain=target.com
```

### Step 7: Test API Authentication Endpoints

```bash
# Check API endpoints for HTTPS
api_endpoints=(
    "/api/v1/auth/login"
    "/api/v1/auth/token"
    "/api/v1/auth/refresh"
    "/api/oauth/token"
    "/oauth2/token"
)

for endpoint in "${api_endpoints[@]}"; do
    # Test HTTP (should fail or redirect)
    http_response=$(curl -s -o /dev/null -w "%{http_code}" \
        "http://target.com$endpoint")

    # Test HTTPS
    https_response=$(curl -s -o /dev/null -w "%{http_code}" \
        "https://target.com$endpoint")

    echo "$endpoint"
    echo "  HTTP: $http_response (should be 301/302 or unavailable)"
    echo "  HTTPS: $https_response"
done
```

---

## Tools

### TLS Analysis

| Tool | Description | Usage |
|------|-------------|-------|
| **SSLyze** | TLS configuration analyzer | `sslyze target.com` |
| **testssl.sh** | TLS testing | `./testssl.sh target.com` |
| **nmap** | SSL enumeration | `nmap --script ssl-*` |

### Traffic Analysis

| Tool | Description |
|------|-------------|
| **Wireshark** | Network traffic analysis |
| **Burp Suite** | Proxy with TLS inspection |
| **mitmproxy** | MITM proxy |

---

## Example Commands/Payloads

### Comprehensive TLS Test Script

```bash
#!/bin/bash
TARGET=$1

echo "=== CREDENTIAL TRANSPORT SECURITY TEST ==="
echo "Target: $TARGET"
echo ""

# 1. Check HTTPS availability
echo "[+] Checking HTTPS availability..."
https_status=$(curl -s -o /dev/null -w "%{http_code}" "https://$TARGET")
if [ "$https_status" == "000" ]; then
    echo "  [FAIL] HTTPS not available!"
    exit 1
else
    echo "  [OK] HTTPS available (Status: $https_status)"
fi

# 2. Check HTTP redirect
echo ""
echo "[+] Checking HTTP to HTTPS redirect..."
http_location=$(curl -sI "http://$TARGET" | grep -i "^location:" | cut -d' ' -f2)
if echo "$http_location" | grep -qi "https://"; then
    echo "  [OK] HTTP redirects to HTTPS"
else
    echo "  [WARNING] HTTP may not redirect to HTTPS"
fi

# 3. Check HSTS
echo ""
echo "[+] Checking HSTS header..."
hsts=$(curl -sI "https://$TARGET" | grep -i "strict-transport-security")
if [ -n "$hsts" ]; then
    echo "  [OK] HSTS enabled: $hsts"
else
    echo "  [WARNING] HSTS not enabled"
fi

# 4. Check login form
echo ""
echo "[+] Checking login form..."
login_form=$(curl -s "https://$TARGET/login" 2>/dev/null)
if echo "$login_form" | grep -qi 'action="http://'; then
    echo "  [FAIL] Login form submits over HTTP!"
elif echo "$login_form" | grep -qi 'action="https://\|action="/\|action=""'; then
    echo "  [OK] Login form submits securely"
else
    echo "  [INFO] Could not determine form action"
fi

# 5. Check for mixed content
echo ""
echo "[+] Checking for mixed content..."
mixed=$(curl -s "https://$TARGET/login" | grep -i "http://" | grep -v "https://")
if [ -n "$mixed" ]; then
    echo "  [WARNING] Potential mixed content found"
else
    echo "  [OK] No obvious mixed content"
fi

# 6. Check TLS version
echo ""
echo "[+] Checking TLS versions..."
for version in tls1 tls1_1 tls1_2 tls1_3; do
    result=$(echo | timeout 5 openssl s_client -connect "$TARGET:443" -$version 2>&1)
    if echo "$result" | grep -q "Cipher is"; then
        echo "  $version: Supported"
    else
        echo "  $version: Not supported"
    fi
done

# 7. Check secure cookie flags
echo ""
echo "[+] Checking cookie security..."
cookies=$(curl -sI -X POST "https://$TARGET/login" \
    -d "username=test&password=test" 2>/dev/null | \
    grep -i "set-cookie")

if echo "$cookies" | grep -qi "secure"; then
    echo "  [OK] Secure flag present on cookies"
else
    echo "  [WARNING] Secure flag may be missing"
fi

if echo "$cookies" | grep -qi "httponly"; then
    echo "  [OK] HttpOnly flag present"
else
    echo "  [WARNING] HttpOnly flag may be missing"
fi

echo ""
echo "[+] Test complete"
```

---

## Remediation Guide

### 1. Enforce HTTPS Everywhere

```nginx
# Nginx - Redirect all HTTP to HTTPS
server {
    listen 80;
    server_name example.com www.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Strong TLS configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;
}
```

### 2. Implement HSTS

```nginx
# Nginx HSTS header
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
```

```apache
# Apache HSTS header
Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
```

### 3. Secure Cookie Configuration

```python
# Python/Flask
app.config.update(
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax'
)

# Set secure cookies
response.set_cookie(
    'session',
    value=session_token,
    secure=True,
    httponly=True,
    samesite='Lax'
)
```

### 4. Application-Level HTTPS Enforcement

```python
# Flask - Redirect HTTP to HTTPS
from flask import Flask, redirect, request

@app.before_request
def enforce_https():
    if not request.is_secure and not app.debug:
        url = request.url.replace('http://', 'https://', 1)
        return redirect(url, code=301)
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Credentials over HTTP | 7.5 | High |
| No HTTP to HTTPS redirect | 5.3 | Medium |
| Missing HSTS | 4.3 | Medium |
| Weak TLS configuration | 5.3 | Medium |
| Missing Secure cookie flag | 4.3 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-319** | Cleartext Transmission of Sensitive Information | HTTP credentials |
| **CWE-523** | Unprotected Transport of Credentials | Missing encryption |
| **CWE-614** | Sensitive Cookie Without Secure Flag | Cookie theft |

---

## References

- [OWASP WSTG - Testing for Credentials Transported over Encrypted Channel](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/04-Authentication_Testing/01-Testing_for_Credentials_Transported_over_an_Encrypted_Channel)
- [OWASP TLS Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html)
- [Mozilla SSL Configuration Generator](https://ssl-config.mozilla.org/)

---

## Checklist

```
[ ] Login page served over HTTPS
[ ] Login form action is HTTPS
[ ] HTTP redirects to HTTPS
[ ] HSTS header present
[ ] HSTS max-age sufficient (>1 year)
[ ] No mixed content on auth pages
[ ] TLS 1.2+ only
[ ] Strong cipher suites
[ ] Secure flag on session cookies
[ ] HttpOnly flag on session cookies
[ ] API auth endpoints HTTPS only
[ ] Certificate valid and not expired
[ ] Findings documented
[ ] Remediation recommendations provided
```
