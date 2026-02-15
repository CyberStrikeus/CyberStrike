# WSTG-SESS-04: Testing for Exposed Session Variables

## Test ID
WSTG-SESS-04

## Test Name
Testing for Exposed Session Variables

## High-Level Description

Session variables may be exposed through various channels including URLs, error messages, logs, HTTP headers, or client-side storage. Exposure of session tokens or sensitive session data can lead to session hijacking, information disclosure, or account takeover. This test identifies instances where session-related information is unintentionally disclosed.

---

## What to Check

- [ ] Session ID in URL parameters
- [ ] Session data in error messages
- [ ] Session tokens in HTTP Referer
- [ ] Session data in browser storage
- [ ] Session info in server logs
- [ ] Session variables in hidden fields
- [ ] Cache exposure of session data

---

## How to Test

### Step 1: Check Session in URLs

```bash
#!/bin/bash
TARGET="https://target.com"

# Check for session in URL after login
response=$(curl -sI -X POST "$TARGET/login" \
    -d "username=test&password=test" \
    -L 2>&1)

# Check redirects for session tokens
echo "$response" | grep -iE "location.*session|location.*token|location.*sid"

if [ $? -eq 0 ]; then
    echo "[VULN] Session token found in URL"
fi

# Check for jsessionid in URL path
echo "$response" | grep -iE "jsessionid|PHPSESSID|ASP.NET_SessionId"
```

### Step 2: Check Referer Header Leakage

```bash
#!/bin/bash
# Test if session leaks via Referer to external resources

TARGET="https://target.com"

# After authentication, check if page has external resources
authenticated_page=$(curl -s -b "session=xxx" "$TARGET/dashboard")

# Extract external URLs
external_urls=$(echo "$authenticated_page" | grep -oP 'https?://[^"'\''>\s]+' | \
    grep -v "target.com")

echo "External resources that may receive session in Referer:"
echo "$external_urls"

# Check Referrer-Policy header
curl -sI "$TARGET/dashboard" | grep -i "referrer-policy"
```

### Step 3: Check Browser Storage

```javascript
// Browser console tests

// Check localStorage for session data
console.log("=== localStorage ===");
for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    console.log(`${key}: ${localStorage.getItem(key)}`);
}

// Check sessionStorage
console.log("\n=== sessionStorage ===");
for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    console.log(`${key}: ${sessionStorage.getItem(key)}`);
}

// Check for sensitive data
const sensitivePatterns = ['session', 'token', 'auth', 'user', 'password', 'secret'];
[localStorage, sessionStorage].forEach(storage => {
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (sensitivePatterns.some(p => key.toLowerCase().includes(p))) {
            console.log(`[SENSITIVE] Found: ${key}`);
        }
    }
});
```

### Step 4: Check Error Messages

```bash
#!/bin/bash
TARGET="https://target.com"

# Trigger errors that might expose session info
payloads=(
    "session=invalid"
    "session="
    "session=<script>alert(1)</script>"
    "session=%00"
    "session=../../etc/passwd"
)

for payload in "${payloads[@]}"; do
    response=$(curl -s -b "$payload" "$TARGET/dashboard")

    # Check for session info in error
    if echo "$response" | grep -qiE "session.*=|sessionid|token"; then
        echo "[VULN] Session info in error response with: $payload"
    fi
done
```

### Step 5: Session Exposure Analyzer

```python
#!/usr/bin/env python3
import requests
import re
from urllib.parse import urlparse, parse_qs

class SessionExposureTester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.session = requests.Session()
        self.findings = []

    def test_url_exposure(self, login_endpoint, credentials):
        """Test for session in URL"""
        print("[*] Testing URL exposure...")

        response = self.session.post(
            f"{self.base_url}{login_endpoint}",
            data=credentials,
            allow_redirects=False
        )

        # Check redirect location
        location = response.headers.get('Location', '')
        parsed = urlparse(location)
        params = parse_qs(parsed.query)

        session_patterns = ['session', 'token', 'sid', 'jsessionid', 'phpsessid']

        for pattern in session_patterns:
            if pattern in location.lower():
                print(f"[VULN] Session in URL: {location}")
                self.findings.append({
                    "type": "url_exposure",
                    "severity": "High",
                    "location": location
                })
                break

        # Check path for session (Java style)
        if ';jsessionid=' in location or ';JSESSIONID=' in location:
            print(f"[VULN] JSESSIONID in URL path")
            self.findings.append({
                "type": "url_path_exposure",
                "severity": "High"
            })

    def test_referrer_leakage(self, page_url):
        """Test for referrer header leakage"""
        print("\n[*] Testing Referer leakage...")

        response = self.session.get(f"{self.base_url}{page_url}")

        # Check Referrer-Policy
        ref_policy = response.headers.get('Referrer-Policy', 'not set')
        print(f"Referrer-Policy: {ref_policy}")

        if ref_policy == 'not set' or ref_policy in ['unsafe-url', 'no-referrer-when-downgrade']:
            # Check for external resources
            external = re.findall(r'https?://(?!{})[\w./-]+'.format(
                urlparse(self.base_url).netloc), response.text)

            if external:
                print(f"[WARN] External resources may receive session in Referer:")
                for url in external[:5]:
                    print(f"  - {url}")

                self.findings.append({
                    "type": "referrer_leakage",
                    "severity": "Medium",
                    "external_resources": len(external)
                })

    def test_error_exposure(self):
        """Test for session info in errors"""
        print("\n[*] Testing error message exposure...")

        test_sessions = [
            "invalid",
            "",
            "null",
            "undefined",
            "'\"<>",
        ]

        for test_session in test_sessions:
            try:
                response = self.session.get(
                    f"{self.base_url}/dashboard",
                    cookies={'SESSIONID': test_session}
                )

                # Look for session info in response
                patterns = [
                    r'session[_\s]*[:=]\s*["\']?[\w-]+',
                    r'SESSIONID[=:]\s*[\w-]+',
                    r'token[=:]\s*[\w.-]+',
                ]

                for pattern in patterns:
                    matches = re.findall(pattern, response.text, re.I)
                    if matches:
                        print(f"[VULN] Session info in error: {matches[0][:50]}")
                        self.findings.append({
                            "type": "error_exposure",
                            "severity": "Medium",
                            "pattern": matches[0][:50]
                        })

            except:
                pass

    def test_cache_exposure(self):
        """Test for cache exposure of session data"""
        print("\n[*] Testing cache exposure...")

        response = self.session.get(f"{self.base_url}/dashboard")

        cache_control = response.headers.get('Cache-Control', '')
        pragma = response.headers.get('Pragma', '')

        print(f"Cache-Control: {cache_control}")
        print(f"Pragma: {pragma}")

        if 'no-store' not in cache_control.lower():
            print("[WARN] Missing no-store - session data may be cached")
            self.findings.append({
                "type": "cache_exposure",
                "severity": "Medium",
                "description": "Missing Cache-Control: no-store"
            })

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*50)
        print("SESSION EXPOSURE REPORT")
        print("="*50)

        if not self.findings:
            print("\nNo exposure issues found.")
            return

        print(f"\nTotal findings: {len(self.findings)}")
        for f in self.findings:
            print(f"\n[{f['type'].upper()}] Severity: {f['severity']}")
            for k, v in f.items():
                if k not in ['type', 'severity']:
                    print(f"  {k}: {v}")

# Usage
tester = SessionExposureTester("https://target.com")
tester.test_url_exposure("/login", {"username": "test", "password": "test"})
tester.test_referrer_leakage("/dashboard")
tester.test_error_exposure()
tester.test_cache_exposure()
tester.generate_report()
```

---

## Remediation Guide

### 1. Prevent URL Session Exposure

```python
# Flask - disable URL sessions
app.config['SESSION_COOKIE_SECURE'] = True
app.config['SESSION_COOKIE_HTTPONLY'] = True

# Never put session in URLs
@app.route('/redirect')
def redirect_handler():
    # BAD: redirect_url = f"/dashboard?session={session['id']}"
    # GOOD: Use cookies only
    return redirect('/dashboard')
```

### 2. Configure Referrer-Policy

```python
@app.after_request
def add_security_headers(response):
    # Prevent session leakage via Referer
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'

    # Prevent caching of sensitive pages
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, private'
    response.headers['Pragma'] = 'no-cache'

    return response
```

### 3. Nginx Configuration

```nginx
# Add Referrer-Policy header
add_header Referrer-Policy "strict-origin-when-cross-origin" always;

# Prevent caching of authenticated pages
location /dashboard {
    add_header Cache-Control "no-store, no-cache, must-revalidate, private";
    add_header Pragma "no-cache";
}
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| Session in URL | 7.5 | High |
| Session in error message | 5.3 | Medium |
| Referer leakage | 4.3 | Medium |
| Cache exposure | 4.3 | Medium |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-598** | Use of GET Request Method with Sensitive Query Strings |
| **CWE-200** | Exposure of Sensitive Information |
| **CWE-532** | Insertion of Sensitive Info into Log File |

---

## Checklist

```
[ ] Session in URL checked
[ ] Referer header leakage tested
[ ] Browser storage analyzed
[ ] Error messages examined
[ ] Cache headers verified
[ ] Hidden fields checked
[ ] Findings documented
[ ] Remediation recommendations provided
```
