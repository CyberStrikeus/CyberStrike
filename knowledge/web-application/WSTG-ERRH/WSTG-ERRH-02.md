# WSTG-ERRH-02: Testing for Stack Traces

## Test ID
WSTG-ERRH-02

## Test Name
Testing for Stack Traces

## High-Level Description

Stack traces provide detailed information about application internals including function call sequences, file paths, line numbers, and sometimes variable values. When exposed to users, stack traces can reveal sensitive implementation details that help attackers understand the application architecture and identify potential vulnerabilities.

---

## What to Check

- [ ] Stack traces in error responses
- [ ] Debug mode enabled
- [ ] Exception details exposed
- [ ] Framework-specific error pages
- [ ] API error responses
- [ ] JavaScript console errors

---

## How to Test

### Step 1: Trigger Application Errors

```bash
#!/bin/bash
TARGET="https://target.com"

# Force exceptions with various inputs
payloads=(
    # Division/null errors
    "0"
    "null"
    "undefined"
    "NaN"

    # Type errors
    "[]"
    "{}"
    "true"

    # SQL errors
    "'"
    "1'"
    "1 OR 1=1"

    # Path errors
    "../../etc/passwd"
    "/etc/passwd"

    # Format string
    "%s%s%s%s%s"
    "%n%n%n%n%n"

    # Buffer overflow attempt
    "$(python3 -c 'print(\"A\"*10000)')"
)

for payload in "${payloads[@]}"; do
    echo "=== Payload: $payload ==="
    response=$(curl -s "$TARGET/api/process?input=$payload")

    # Check for stack trace indicators
    if echo "$response" | grep -qiE "at\s+\w+\.|Traceback|Exception|Error at line|Stack trace"; then
        echo "[VULN] Stack trace detected!"
        echo "$response" | head -20
    fi
    echo ""
done
```

### Step 2: Check for Debug Mode

```bash
#!/bin/bash
TARGET="https://target.com"

# Look for debug indicators
response=$(curl -s "$TARGET/nonexistent")

# Django debug page
if echo "$response" | grep -q "Using the URLconf defined in"; then
    echo "[VULN] Django DEBUG=True detected"
fi

# Flask debug mode
if echo "$response" | grep -q "Werkzeug Debugger"; then
    echo "[VULN] Flask debug mode detected"
fi

# ASP.NET detailed errors
if echo "$response" | grep -q "Stack Trace:"; then
    echo "[VULN] ASP.NET detailed errors enabled"
fi

# PHP errors
if echo "$response" | grep -qiE "Fatal error:|Parse error:|Warning:.*on line"; then
    echo "[VULN] PHP errors displayed"
fi

# Express.js errors
if echo "$response" | grep -q "at Layer.handle"; then
    echo "[VULN] Express.js stack trace exposed"
fi
```

### Step 3: Stack Trace Analyzer

```python
#!/usr/bin/env python3
import requests
import re

class StackTraceTester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.findings = []

    STACK_TRACE_PATTERNS = {
        'java': r'at\s+[\w.]+\([\w.]+:\d+\)',
        'python': r'File\s+"[^"]+",\s+line\s+\d+',
        'dotnet': r'at\s+[\w.]+\s+in\s+[^:]+:\d+',
        'php': r'in\s+/[\w/]+\.php\s+on\s+line\s+\d+',
        'nodejs': r'at\s+[\w.]+\s+\([^)]+:\d+:\d+\)',
        'ruby': r'from\s+[\w/]+\.rb:\d+',
    }

    FRAMEWORK_PATTERNS = {
        'django': r'Using the URLconf defined in|Django Version:',
        'flask': r'Werkzeug Debugger|werkzeug\.exceptions',
        'rails': r'ActionController::RoutingError|Rails\.root:',
        'spring': r'org\.springframework\.|Whitelabel Error Page',
        'express': r'at Layer\.handle|at Route\.dispatch',
        'laravel': r'Illuminate\\|app/Exceptions/Handler',
    }

    def test_endpoints(self, endpoints):
        """Test multiple endpoints for stack traces"""
        print("[*] Testing for stack trace exposure...")

        for endpoint in endpoints:
            self._test_endpoint(endpoint)

        return self.findings

    def _test_endpoint(self, endpoint):
        """Test single endpoint"""
        # Error-triggering payloads
        payloads = ["'", "null", "0", "{{7*7}}", "../"]

        for payload in payloads:
            try:
                url = f"{self.base_url}{endpoint}?id={payload}"
                response = requests.get(url, timeout=10)
                self._analyze_response(url, response.text)

            except requests.exceptions.RequestException:
                pass

    def _analyze_response(self, url, content):
        """Analyze response for stack traces"""
        # Check for stack traces
        for lang, pattern in self.STACK_TRACE_PATTERNS.items():
            if re.search(pattern, content):
                print(f"[VULN] {lang.upper()} stack trace at: {url}")
                self.findings.append({
                    "url": url,
                    "type": f"{lang}_stack_trace",
                    "severity": "Medium"
                })

        # Check for framework debug pages
        for framework, pattern in self.FRAMEWORK_PATTERNS.items():
            if re.search(pattern, content, re.IGNORECASE):
                print(f"[VULN] {framework.upper()} debug mode at: {url}")
                self.findings.append({
                    "url": url,
                    "type": f"{framework}_debug",
                    "severity": "High"
                })

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*50)
        print("STACK TRACE EXPOSURE REPORT")
        print("="*50)

        if not self.findings:
            print("\nNo stack traces found.")
            return

        print(f"\nFindings: {len(self.findings)}")
        for f in self.findings:
            print(f"\n  [{f['severity']}] {f['type']}")
            print(f"  URL: {f['url']}")

# Usage
tester = StackTraceTester("https://target.com")
tester.test_endpoints(["/api/user", "/api/search", "/api/product"])
tester.generate_report()
```

---

## Remediation Guide

### Disable Debug Mode

```python
# Flask
app.config['DEBUG'] = False
app.config['PROPAGATE_EXCEPTIONS'] = False

# Django
DEBUG = False
ALLOWED_HOSTS = ['example.com']
```

```java
// Spring Boot - application.properties
server.error.include-stacktrace=never
server.error.include-message=never
```

```php
// PHP
display_errors = Off
log_errors = On
error_log = /var/log/php/error.log
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| Full stack trace in production | 5.3 | Medium |
| Debug mode enabled | 7.5 | High |
| Framework debug page | 7.5 | High |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-209** | Generation of Error Message Containing Sensitive Information |
| **CWE-215** | Insertion of Sensitive Information Into Debugging Code |

---

## Checklist

```
[ ] Error-triggering inputs tested
[ ] Debug mode indicators checked
[ ] Framework-specific debug pages tested
[ ] Stack trace patterns analyzed
[ ] API error responses checked
[ ] Findings documented
```
