# WSTG-ERRH-01: Testing for Improper Error Handling

## Test ID
WSTG-ERRH-01

## Test Name
Testing for Improper Error Handling

## High-Level Description

Improper error handling can reveal sensitive information about the application's internal workings, including technology stack, database structure, file paths, and configuration details. Attackers use this information to craft more targeted attacks. Proper error handling should provide minimal information to users while logging detailed information securely on the server.

---

## What to Check

### Information Disclosure via Errors

- [ ] Stack traces exposed
- [ ] Database error messages
- [ ] File path disclosure
- [ ] Framework/version info
- [ ] Debug information
- [ ] Internal IP addresses
- [ ] SQL queries in errors
- [ ] Configuration details

### Error Scenarios to Test

| Scenario | Potential Disclosure |
|----------|---------------------|
| Invalid input | Framework info |
| Database errors | SQL structure |
| File operations | Path disclosure |
| Authentication failures | User enumeration |
| Authorization errors | Role information |
| Server errors (500) | Stack traces |

---

## How to Test

### Step 1: Trigger Various Error Types

```bash
#!/bin/bash
TARGET="https://target.com"

# Test 404 errors
curl -s "$TARGET/nonexistent-page-12345"
curl -s "$TARGET/../../../etc/passwd"
curl -s "$TARGET/%00"

# Test 500 errors
curl -s "$TARGET/api/user?id='"
curl -s "$TARGET/api/user?id=1 OR 1=1"
curl -s -X POST "$TARGET/api/data" -d "invalid-json"

# Test with malformed requests
curl -s "$TARGET" -H "Content-Length: -1"
curl -s "$TARGET" -H "Content-Type: application/invalid"

# Test file operations
curl -s "$TARGET/download?file=../../../etc/passwd"
curl -s "$TARGET/download?file=/etc/passwd"

# Test with long input
curl -s "$TARGET/search?q=$(python3 -c 'print("A"*10000)')"
```

### Step 2: Analyze Error Responses

```bash
#!/bin/bash
TARGET="https://target.com"

# Collect errors and analyze
payloads=(
    "'"
    "\""
    ";"
    "../"
    "<script>"
    "{{7*7}}"
    "%00"
    "%0a"
    "null"
    "-1"
)

for payload in "${payloads[@]}"; do
    echo "=== Testing: $payload ==="
    response=$(curl -s "$TARGET/api/search?q=$payload")

    # Check for sensitive information
    echo "$response" | grep -iE "exception|error|stack|trace|warning|sql|mysql|oracle|postgres|path|file|line|debug|internal" | head -5

    # Check for technology disclosure
    echo "$response" | grep -iE "asp\.net|php|java|python|ruby|django|laravel|spring|express" | head -5

    echo ""
done
```

### Step 3: Test SQL Error Messages

```bash
#!/bin/bash
TARGET="https://target.com"

# SQL injection payloads to trigger errors
sql_payloads=(
    "'"
    "''"
    "1'"
    "1' OR '1'='1"
    "1' AND '1'='2"
    "1; DROP TABLE users--"
    "1 UNION SELECT 1,2,3--"
    "1' WAITFOR DELAY '0:0:5'--"
)

for payload in "${sql_payloads[@]}"; do
    response=$(curl -s "$TARGET/api/user?id=$payload")

    # Check for SQL error disclosure
    if echo "$response" | grep -qiE "sql|syntax|mysql|oracle|postgres|mssql|sqlite|ORA-|PLS-|SP2-"; then
        echo "[VULN] SQL error disclosure with: $payload"
        echo "$response" | head -5
    fi
done
```

### Step 4: Error Handling Analysis Script

```python
#!/usr/bin/env python3
import requests
import re
from urllib.parse import urljoin

class ErrorHandlingTester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.session = requests.Session()
        self.findings = []

    # Sensitive patterns to detect
    SENSITIVE_PATTERNS = {
        'stack_trace': r'(at\s+\w+\.\w+\(.*:\d+\)|Traceback \(most recent|Exception in thread)',
        'file_path': r'(/var/www/|/home/\w+/|C:\\|/app/|/opt/)',
        'sql_error': r'(SQL syntax|mysql_|ORA-\d+|PG::|sqlite|ODBC)',
        'technology': r'(PHP/|ASP\.NET|X-Powered-By|Server: Apache|nginx)',
        'debug_info': r'(DEBUG|NOTICE|WARNING|Error in|Line \d+)',
        'internal_ip': r'(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)',
        'credentials': r'(password|api_key|secret|token|auth).*[:=]',
    }

    def test_error_scenarios(self):
        """Test various error scenarios"""
        print("[*] Testing error handling scenarios...")

        test_cases = [
            # Path traversal
            ("/../../../../etc/passwd", "GET", None),
            ("/%00", "GET", None),

            # SQL injection
            ("/api/user?id='", "GET", None),
            ("/api/user?id=1 OR 1=1", "GET", None),

            # Invalid JSON
            ("/api/data", "POST", "invalid-json"),

            # Non-existent resources
            ("/nonexistent-12345", "GET", None),
            ("/api/nonexistent", "GET", None),

            # Type confusion
            ("/api/user?id[]=1", "GET", None),
            ("/api/user?id=null", "GET", None),

            # Large input
            ("/search?q=" + "A" * 5000, "GET", None),

            # Special characters
            ("/api/search?q=%00%0a%0d", "GET", None),
        ]

        for path, method, data in test_cases:
            self._test_endpoint(path, method, data)

        return self.findings

    def _test_endpoint(self, path, method="GET", data=None):
        """Test single endpoint for error disclosure"""
        url = urljoin(self.base_url, path)

        try:
            if method == "GET":
                response = self.session.get(url, timeout=10)
            else:
                response = self.session.post(url, data=data, timeout=10)

            self._analyze_response(url, response)

        except requests.exceptions.RequestException as e:
            pass

    def _analyze_response(self, url, response):
        """Analyze response for sensitive information"""
        content = response.text

        for pattern_name, pattern in self.SENSITIVE_PATTERNS.items():
            matches = re.findall(pattern, content, re.IGNORECASE)
            if matches:
                finding = {
                    "url": url,
                    "type": pattern_name,
                    "matches": matches[:3],  # First 3 matches
                    "severity": self._get_severity(pattern_name)
                }
                self.findings.append(finding)
                print(f"[VULN] {pattern_name} at {url}")
                print(f"       Sample: {matches[0][:100] if matches else ''}")

    def _get_severity(self, pattern_type):
        """Get severity based on pattern type"""
        high_severity = ['stack_trace', 'sql_error', 'credentials', 'internal_ip']
        medium_severity = ['file_path', 'debug_info']

        if pattern_type in high_severity:
            return "High"
        elif pattern_type in medium_severity:
            return "Medium"
        return "Low"

    def test_http_methods(self):
        """Test error handling for different HTTP methods"""
        print("\n[*] Testing HTTP method error handling...")

        methods = ["OPTIONS", "PUT", "DELETE", "PATCH", "TRACE"]

        for method in methods:
            try:
                response = self.session.request(method, self.base_url, timeout=10)
                self._analyze_response(f"{self.base_url} [{method}]", response)
            except:
                pass

    def test_custom_headers(self):
        """Test error handling with malformed headers"""
        print("\n[*] Testing header error handling...")

        headers_tests = [
            {"Content-Length": "-1"},
            {"Content-Type": "invalid/type"},
            {"Accept": "../../../etc/passwd"},
            {"X-Forwarded-For": "' OR '1'='1"},
        ]

        for headers in headers_tests:
            try:
                response = self.session.get(self.base_url, headers=headers, timeout=10)
                self._analyze_response(f"{self.base_url} [headers]", response)
            except:
                pass

    def generate_report(self):
        """Generate error handling report"""
        print("\n" + "="*60)
        print("ERROR HANDLING TEST REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo sensitive information disclosure found.")
            return

        print(f"\nTotal findings: {len(self.findings)}")

        # Group by severity
        by_severity = {}
        for f in self.findings:
            sev = f['severity']
            if sev not in by_severity:
                by_severity[sev] = []
            by_severity[sev].append(f)

        for severity in ['High', 'Medium', 'Low']:
            if severity in by_severity:
                print(f"\n{severity} ({len(by_severity[severity])}):")
                for finding in by_severity[severity]:
                    print(f"  - {finding['type']} at {finding['url'][:50]}")

# Usage
tester = ErrorHandlingTester("https://target.com")
tester.test_error_scenarios()
tester.test_http_methods()
tester.test_custom_headers()
tester.generate_report()
```

---

## Tools

### Error Analysis

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Suite** | Error interception | Analyze responses |
| **OWASP ZAP** | Automated scanning | Error detection |
| **curl** | Manual testing | Trigger errors |

---

## Remediation Guide

### 1. Generic Error Pages

```python
from flask import Flask, jsonify

app = Flask(__name__)

@app.errorhandler(Exception)
def handle_exception(e):
    # Log detailed error internally
    app.logger.error(f"Error: {str(e)}", exc_info=True)

    # Return generic message to user
    return jsonify({
        "error": "An unexpected error occurred",
        "message": "Please try again later"
    }), 500

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Resource not found"}), 404

@app.errorhandler(400)
def bad_request(e):
    return jsonify({"error": "Invalid request"}), 400
```

### 2. Production Configuration

```python
# Disable debug mode in production
DEBUG = False
TESTING = False

# Configure secure logging
import logging
logging.basicConfig(
    filename='/var/log/app/error.log',
    level=logging.ERROR,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
```

### 3. Web Server Configuration

```nginx
# Nginx - disable server version
server_tokens off;

# Custom error pages
error_page 500 502 503 504 /50x.html;
location = /50x.html {
    root /usr/share/nginx/html;
    internal;
}

error_page 404 /404.html;
location = /404.html {
    root /usr/share/nginx/html;
    internal;
}
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Full stack trace exposure | 5.3 | Medium |
| SQL error messages | 5.3 | Medium |
| File path disclosure | 4.3 | Medium |
| Technology version disclosure | 3.7 | Low |
| Debug information | 5.3 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-209** | Information Exposure Through Error Message | Sensitive info in errors |
| **CWE-211** | Externally-Generated Error Message | External error details |
| **CWE-215** | Information Exposure Through Debug | Debug info exposure |

---

## References

- [OWASP Error Handling](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/08-Testing_for_Error_Handling/01-Testing_For_Improper_Error_Handling)
- [OWASP Error Handling Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html)

---

## Checklist

```
[ ] 404 error pages tested
[ ] 500 error pages tested
[ ] SQL error messages tested
[ ] File operation errors tested
[ ] Invalid input errors tested
[ ] HTTP method errors tested
[ ] Header manipulation tested
[ ] Stack traces checked
[ ] Technology disclosure checked
[ ] Path disclosure checked
[ ] Findings documented
[ ] Remediation recommendations provided
```
