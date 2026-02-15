# WSTG-CRYP-03: Testing for Sensitive Information Sent via Unencrypted Channels

## Test ID
WSTG-CRYP-03

## Test Name
Testing for Sensitive Information Sent via Unencrypted Channels

## High-Level Description

Sensitive data transmitted over unencrypted channels (HTTP) can be intercepted by attackers through man-in-the-middle attacks. This includes credentials, session tokens, personal information, and financial data. All sensitive communications must use encrypted channels (HTTPS) with proper configuration.

---

## What to Check

- [ ] Login forms over HTTP
- [ ] Session tokens over HTTP
- [ ] Sensitive data in HTTP requests
- [ ] Mixed content issues
- [ ] HTTP to HTTPS redirects
- [ ] API calls over HTTP
- [ ] Form actions over HTTP

---

## How to Test

### Step 1: Check for HTTP Access

```bash
#!/bin/bash
TARGET="target.com"

# Check if HTTP is accessible
echo "=== HTTP Access ==="
curl -sI "http://$TARGET" | head -10

# Check if redirect to HTTPS
redirect=$(curl -sI "http://$TARGET" | grep -i "location")
if echo "$redirect" | grep -qi "https"; then
    echo "[OK] Redirects to HTTPS"
else
    echo "[VULN] HTTP accessible without redirect"
fi

# Check login page over HTTP
curl -sI "http://$TARGET/login" | head -10
```

### Step 2: Check Form Actions

```bash
#!/bin/bash
TARGET="https://target.com"

# Get login page and check form action
page=$(curl -s "$TARGET/login")

# Check for HTTP form actions
if echo "$page" | grep -qi 'action="http://'; then
    echo "[VULN] Form submits to HTTP"
fi

# Check for protocol-relative or relative URLs
echo "$page" | grep -oP 'action="[^"]*"' | head -5
```

### Step 3: Check for Mixed Content

```bash
#!/bin/bash
TARGET="https://target.com"

# Get page and check for HTTP resources
page=$(curl -s "$TARGET")

# Find HTTP resources
echo "=== HTTP Resources on HTTPS Page ==="
echo "$page" | grep -oP 'src="http://[^"]*"' | head -10
echo "$page" | grep -oP 'href="http://[^"]*"' | head -10
```

### Step 4: Comprehensive Channel Security Tester

```python
#!/usr/bin/env python3
import requests
from urllib.parse import urlparse
import re

class ChannelSecurityTester:
    def __init__(self, domain):
        self.domain = domain
        self.findings = []

    def test_http_redirect(self):
        """Test if HTTP redirects to HTTPS"""
        print("[*] Testing HTTP redirect...")

        try:
            response = requests.get(
                f"http://{self.domain}",
                allow_redirects=False,
                timeout=10
            )

            if response.status_code in [301, 302, 307, 308]:
                location = response.headers.get('Location', '')
                if location.startswith('https://'):
                    print(f"[OK] Redirects to HTTPS: {location}")
                    return
                else:
                    print(f"[WARN] Redirects but not to HTTPS: {location}")

            print("[VULN] HTTP accessible without redirect to HTTPS")
            self.findings.append({
                "issue": "HTTP accessible without HTTPS redirect",
                "severity": "High"
            })

        except requests.exceptions.ConnectionError:
            print("[OK] HTTP not accessible (port closed)")

    def test_hsts(self):
        """Test HSTS implementation"""
        print("\n[*] Testing HSTS...")

        try:
            response = requests.get(f"https://{self.domain}", timeout=10)
            hsts = response.headers.get('Strict-Transport-Security', '')

            if hsts:
                print(f"[OK] HSTS: {hsts}")

                # Check max-age
                if 'max-age=' in hsts:
                    max_age = int(re.search(r'max-age=(\d+)', hsts).group(1))
                    if max_age < 31536000:
                        print("[WARN] HSTS max-age less than 1 year")
                        self.findings.append({
                            "issue": "HSTS max-age too short",
                            "severity": "Low"
                        })
            else:
                print("[VULN] HSTS header missing")
                self.findings.append({
                    "issue": "Missing HSTS header",
                    "severity": "Medium"
                })

        except Exception as e:
            print(f"[ERROR] {e}")

    def test_mixed_content(self, pages):
        """Test for mixed content on HTTPS pages"""
        print("\n[*] Testing for mixed content...")

        http_resources = []

        for page in pages:
            try:
                response = requests.get(f"https://{self.domain}{page}", timeout=10)

                # Find HTTP resources
                http_refs = re.findall(r'(?:src|href|action)=["\']http://[^"\']+["\']',
                                      response.text, re.IGNORECASE)

                for ref in http_refs:
                    print(f"[VULN] Mixed content on {page}: {ref[:60]}")
                    http_resources.append({'page': page, 'resource': ref})

            except Exception as e:
                pass

        if http_resources:
            self.findings.append({
                "issue": f"Mixed content found ({len(http_resources)} resources)",
                "severity": "Medium"
            })

    def test_sensitive_forms(self, form_pages):
        """Test if sensitive forms submit securely"""
        print("\n[*] Testing form security...")

        for page in form_pages:
            try:
                response = requests.get(f"https://{self.domain}{page}", timeout=10)

                # Find form actions
                forms = re.findall(r'<form[^>]*action=["\']([^"\']*)["\']',
                                  response.text, re.IGNORECASE)

                for action in forms:
                    if action.startswith('http://'):
                        print(f"[VULN] Form on {page} submits to HTTP: {action}")
                        self.findings.append({
                            "issue": f"Form submits to HTTP on {page}",
                            "severity": "High"
                        })

            except Exception as e:
                pass

    def generate_report(self):
        """Generate security report"""
        print("\n" + "="*50)
        print("CHANNEL SECURITY REPORT")
        print("="*50)

        if not self.findings:
            print("\nNo issues found.")
            return

        print(f"\nFindings: {len(self.findings)}")
        for f in self.findings:
            print(f"\n  [{f['severity']}] {f['issue']}")

# Usage
tester = ChannelSecurityTester("target.com")
tester.test_http_redirect()
tester.test_hsts()
tester.test_mixed_content(["/", "/login", "/dashboard"])
tester.test_sensitive_forms(["/login", "/register", "/payment"])
tester.generate_report()
```

---

## Remediation Guide

### Force HTTPS Redirect

```nginx
# Nginx
server {
    listen 80;
    server_name example.com;
    return 301 https://$server_name$request_uri;
}
```

### HSTS Header

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
```

### Content Security Policy

```nginx
add_header Content-Security-Policy "upgrade-insecure-requests";
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| Credentials over HTTP | 7.5 | High |
| Session token over HTTP | 7.5 | High |
| Missing HSTS | 4.3 | Medium |
| Mixed content | 4.3 | Medium |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-319** | Cleartext Transmission of Sensitive Information |
| **CWE-311** | Missing Encryption of Sensitive Data |

---

## Checklist

```
[ ] HTTP redirect tested
[ ] HSTS header checked
[ ] Form actions verified
[ ] Mixed content tested
[ ] API endpoints checked
[ ] Findings documented
```
