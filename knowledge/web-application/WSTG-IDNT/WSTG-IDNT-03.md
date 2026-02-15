# WSTG-IDNT-03: Test Account Provisioning Process

## Test ID
WSTG-IDNT-03

## Test Name
Test Account Provisioning Process

## High-Level Description

Account provisioning is the process by which user accounts are created, modified, and managed by administrators or automated systems. This test evaluates the security of the provisioning workflow, including how accounts are created, what privileges are assigned, and whether proper authorization is required. Weaknesses in provisioning can lead to unauthorized account creation, privilege escalation, and insider threats.

---

## What to Check

### Provisioning Security Controls

- [ ] Authorization required for account creation
- [ ] Approval workflows exist
- [ ] Audit logging of provisioning actions
- [ ] Principle of least privilege applied
- [ ] Separation of duties enforced
- [ ] Temporary/service account management

### Account Lifecycle Stages

| Stage | Security Consideration |
|-------|------------------------|
| Creation | Who can create accounts? Authorization required? |
| Modification | Who can change roles/permissions? |
| Suspension | Process for disabling accounts |
| Deletion | Complete removal of access and data |
| Review | Regular access reviews conducted? |

---

## How to Test

### Step 1: Identify Provisioning Endpoints

```bash
# Admin user creation endpoints
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
    "https://target.com/api/admin/users" -X GET

# Check for provisioning API
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
    "https://target.com/api/admin/provision" -X GET

# Look for bulk user creation
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
    "https://target.com/api/admin/users/bulk" -X GET

# Self-service provisioning
curl -s -H "Authorization: Bearer $USER_TOKEN" \
    "https://target.com/api/users/invite" -X GET
```

### Step 2: Test Authorization for Provisioning

```bash
# Try creating user with non-admin token
curl -s -X POST "https://target.com/api/admin/users" \
    -H "Authorization: Bearer $USER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "unauthorized_user",
        "email": "unauthorized@test.com",
        "password": "TestPass123!",
        "role": "user"
    }'

# Try without any authentication
curl -s -X POST "https://target.com/api/admin/users" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "noauth_user",
        "email": "noauth@test.com",
        "password": "TestPass123!"
    }'
```

### Step 3: Test Privilege Escalation During Provisioning

```bash
# If authorized to create users, try creating admin
curl -s -X POST "https://target.com/api/admin/users" \
    -H "Authorization: Bearer $MANAGER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "newadmin",
        "email": "newadmin@test.com",
        "password": "TestPass123!",
        "role": "admin"
    }'

# Try assigning permissions higher than own level
curl -s -X POST "https://target.com/api/admin/users" \
    -H "Authorization: Bearer $MANAGER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "superuser",
        "email": "super@test.com",
        "password": "TestPass123!",
        "permissions": ["all", "superadmin"]
    }'
```

### Step 4: Test Self-Provisioning Vulnerabilities

```bash
# Check if users can invite others
curl -s -X POST "https://target.com/api/users/invite" \
    -H "Authorization: Bearer $USER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "email": "invited@test.com",
        "role": "admin"
    }'

# Check for API key self-provisioning
curl -s -X POST "https://target.com/api/users/apikeys" \
    -H "Authorization: Bearer $USER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "name": "my-api-key",
        "permissions": ["admin", "write", "delete"]
    }'
```

### Step 5: Test Bulk Provisioning

```bash
# Bulk user creation
curl -s -X POST "https://target.com/api/admin/users/bulk" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "users": [
            {"username": "bulk1", "email": "bulk1@test.com", "role": "admin"},
            {"username": "bulk2", "email": "bulk2@test.com", "role": "admin"},
            {"username": "bulk3", "email": "bulk3@test.com", "role": "admin"}
        ]
    }'

# CSV upload endpoint
curl -s -X POST "https://target.com/api/admin/users/import" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -F "file=@users.csv"
```

### Step 6: Test Service Account Provisioning

```bash
# Create service account
curl -s -X POST "https://target.com/api/admin/service-accounts" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "name": "automation-service",
        "type": "service",
        "permissions": ["api:full"]
    }'

# Check service account token generation
curl -s -X POST "https://target.com/api/admin/service-accounts/1/token" \
    -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Step 7: Test Account Modification

```bash
# Elevate own privileges
curl -s -X PUT "https://target.com/api/users/me" \
    -H "Authorization: Bearer $USER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "role": "admin"
    }'

# Modify another user's role
curl -s -X PUT "https://target.com/api/admin/users/5" \
    -H "Authorization: Bearer $MANAGER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "role": "admin"
    }'
```

---

## Tools

### Manual Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Suite** | Request interception | Analyze provisioning flow |
| **Postman** | API testing | Test provisioning endpoints |
| **curl** | Command-line HTTP | Scripted tests |

### Automated Testing

| Tool | Description |
|------|-------------|
| **Burp Autorize** | Authorization testing |
| **OWASP ZAP** | Automated scanning |
| **Custom scripts** | Python/Bash automation |

---

## Example Commands/Payloads

### Provisioning Attack Payloads

```json
// Privilege escalation in user creation
{
    "username": "escalated",
    "role": "superadmin",
    "admin": true,
    "permissions": ["*"]
}

// Group-based privilege escalation
{
    "username": "grouptest",
    "groups": ["administrators", "superusers"]
}

// Attribute manipulation
{
    "username": "attrtest",
    "attributes": {
        "isAdmin": true,
        "accessLevel": 999
    }
}
```

### Provisioning Audit Script

```python
#!/usr/bin/env python3
import requests
import json

class ProvisioningTester:
    def __init__(self, base_url, tokens):
        self.base_url = base_url
        self.tokens = tokens  # Dict of role: token

    def test_user_creation(self, creator_role, target_role):
        """Test if creator_role can create target_role"""
        token = self.tokens.get(creator_role)

        response = requests.post(
            f"{self.base_url}/api/admin/users",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "username": f"test_{creator_role}_creates_{target_role}",
                "email": f"{creator_role}_{target_role}@test.com",
                "password": "TestPass123!",
                "role": target_role
            }
        )

        return {
            "creator": creator_role,
            "target": target_role,
            "status": response.status_code,
            "success": response.status_code in [200, 201]
        }

    def run_matrix_test(self):
        """Test all role combinations"""
        roles = list(self.tokens.keys())
        results = []

        for creator in roles:
            for target in roles:
                result = self.test_user_creation(creator, target)
                results.append(result)

                if result["success"] and self.is_escalation(creator, target):
                    print(f"[!] PRIVILEGE ESCALATION: {creator} created {target}")

        return results

    def is_escalation(self, creator, target):
        """Check if creating target role is escalation for creator"""
        hierarchy = {"user": 1, "moderator": 2, "admin": 3, "superadmin": 4}
        return hierarchy.get(target, 0) >= hierarchy.get(creator, 0)

# Usage
tester = ProvisioningTester(
    "https://target.com",
    {
        "user": "user_token",
        "moderator": "mod_token",
        "admin": "admin_token"
    }
)
results = tester.run_matrix_test()
```

---

## Remediation Guide

### 1. Authorization Checks for Provisioning

```python
# Python/Flask example
def can_create_user_with_role(creator, target_role):
    """Check if creator can provision users with target_role"""
    role_hierarchy = {
        'user': 1,
        'moderator': 2,
        'manager': 3,
        'admin': 4,
        'superadmin': 5
    }

    creator_level = role_hierarchy.get(creator.role, 0)
    target_level = role_hierarchy.get(target_role, 999)

    # Can only create users with lower privilege level
    return creator_level > target_level

@app.route('/api/admin/users', methods=['POST'])
@admin_required
def create_user():
    data = request.get_json()
    target_role = data.get('role', 'user')

    if not can_create_user_with_role(current_user, target_role):
        return jsonify({
            'error': 'Cannot create user with equal or higher privileges'
        }), 403

    # Proceed with user creation
    user = create_new_user(data)

    # Audit log
    log_provisioning_action(
        action='create_user',
        actor=current_user.id,
        target=user.id,
        details=data
    )

    return jsonify({'user': user.to_dict()}), 201
```

### 2. Approval Workflows

```python
# Two-person approval for elevated roles
@app.route('/api/admin/users', methods=['POST'])
@admin_required
def create_user():
    data = request.get_json()
    target_role = data.get('role', 'user')

    if target_role in ['admin', 'superadmin']:
        # Requires approval
        request = create_provisioning_request(
            requester=current_user.id,
            data=data,
            status='pending_approval'
        )
        notify_approvers(request)
        return jsonify({
            'message': 'Request submitted for approval',
            'request_id': request.id
        }), 202

    # Direct creation for lower roles
    return create_user_directly(data)
```

### 3. Comprehensive Audit Logging

```python
from datetime import datetime

def log_provisioning_action(action, actor, target, details, result):
    """Log all provisioning actions for audit"""
    audit_entry = {
        'timestamp': datetime.utcnow().isoformat(),
        'action': action,  # create, modify, delete, suspend
        'actor_id': actor.id,
        'actor_role': actor.role,
        'actor_ip': request.remote_addr,
        'target_id': target,
        'details': details,
        'result': result  # success, denied, error
    }

    audit_log.insert(audit_entry)

    # Alert on sensitive actions
    if action in ['create_admin', 'elevate_privileges']:
        send_security_alert(audit_entry)
```

### 4. Separation of Duties

```python
# Prevent self-elevation
@app.route('/api/admin/users/<user_id>', methods=['PUT'])
@admin_required
def modify_user(user_id):
    if str(current_user.id) == str(user_id):
        return jsonify({
            'error': 'Cannot modify your own account'
        }), 403

    # Proceed with modification
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Unauthorized account creation | 9.8 | Critical |
| Privilege escalation via provisioning | 8.8 | High |
| Missing approval workflows | 6.5 | Medium |
| Insufficient audit logging | 5.3 | Medium |
| Self-privilege elevation | 8.8 | High |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-269** | Improper Privilege Management | Privilege escalation |
| **CWE-862** | Missing Authorization | No auth for provisioning |
| **CWE-863** | Incorrect Authorization | Wrong privilege checks |
| **CWE-778** | Insufficient Logging | Missing audit trail |

---

## References

- [OWASP WSTG - Test Account Provisioning Process](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/03-Identity_Management_Testing/03-Test_Account_Provisioning_Process)
- [NIST Account Management](https://csrc.nist.gov/Topics/identity-access-management)
- [CIS Controls - Account Management](https://www.cisecurity.org/controls)

---

## Checklist

```
[ ] Provisioning endpoints identified
[ ] Authorization requirements tested
[ ] Privilege escalation tested
[ ] Self-provisioning vulnerabilities checked
[ ] Bulk provisioning tested
[ ] Service account creation tested
[ ] Account modification tested
[ ] Audit logging verified
[ ] Approval workflows evaluated
[ ] Separation of duties verified
[ ] Account lifecycle reviewed
[ ] Findings documented
[ ] Remediation recommendations provided
```
