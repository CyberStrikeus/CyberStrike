# WSTG-IDNT-01: Test Role Definitions

## Test ID
WSTG-IDNT-01

## Test Name
Test Role Definitions

## High-Level Description

Role definitions testing evaluates how well an application implements role-based access control (RBAC). This test identifies whether roles are properly defined, whether users can only access resources appropriate for their role, and whether role hierarchies are correctly enforced. Poorly defined roles can lead to privilege escalation and unauthorized access to sensitive functionality.

---

## What to Check

### Role Definition Analysis

- [ ] Documented role definitions exist
- [ ] Roles follow principle of least privilege
- [ ] Role separation is properly implemented
- [ ] Administrative roles are properly restricted
- [ ] Role hierarchy is clearly defined

### Access Control Verification

| Check | Description |
|-------|-------------|
| Role boundaries | Each role can only access assigned resources |
| Privilege separation | Sensitive functions require specific roles |
| Role escalation | Users cannot self-assign higher roles |
| Cross-role access | Users cannot access other role's data |

---

## How to Test

### Step 1: Enumerate Available Roles

```bash
# Review application documentation for role definitions
# Common roles to look for:
# - Guest/Anonymous
# - User/Member
# - Moderator
# - Administrator
# - Super Admin

# Check user profile endpoints for role information
curl -s -H "Authorization: Bearer $TOKEN" \
    "https://target.com/api/user/profile" | jq '.role'

# Check for role-related parameters
curl -s -H "Authorization: Bearer $TOKEN" \
    "https://target.com/api/users/me" | jq '.permissions'
```

### Step 2: Map Role Permissions

```bash
#!/bin/bash
# Create accounts for each role and map accessible endpoints

ROLES=("user" "moderator" "admin")
ENDPOINTS=(
    "/api/users"
    "/api/users/1"
    "/api/admin/settings"
    "/api/admin/users"
    "/api/reports"
    "/api/logs"
)

for role in "${ROLES[@]}"; do
    echo "=== Testing role: $role ==="
    # Use token for this role
    TOKEN=$(cat "tokens/${role}_token.txt")

    for endpoint in "${ENDPOINTS[@]}"; do
        status=$(curl -s -o /dev/null -w "%{http_code}" \
            -H "Authorization: Bearer $TOKEN" \
            "https://target.com${endpoint}")
        echo "$endpoint: $status"
    done
    echo ""
done
```

### Step 3: Test Role Boundary Violations

```bash
# Test if lower-privileged role can access admin functions
# Using regular user token
curl -s -H "Authorization: Bearer $USER_TOKEN" \
    "https://target.com/api/admin/users" \
    -w "\nStatus: %{http_code}"

# Test if user can modify their own role
curl -s -X PUT \
    -H "Authorization: Bearer $USER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"role": "admin"}' \
    "https://target.com/api/user/profile"

# Test parameter manipulation
curl -s -X POST \
    -H "Authorization: Bearer $USER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"username": "test", "role": "admin"}' \
    "https://target.com/api/users"
```

### Step 4: Test Horizontal Access Between Same Roles

```bash
# User A trying to access User B's resources
curl -s -H "Authorization: Bearer $USER_A_TOKEN" \
    "https://target.com/api/users/2/profile"

# User A trying to modify User B's data
curl -s -X PUT \
    -H "Authorization: Bearer $USER_A_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"email": "attacker@evil.com"}' \
    "https://target.com/api/users/2/profile"
```

### Step 5: Verify Role Enforcement Consistency

```bash
# Check if role is enforced on all endpoints
# Sometimes GET is protected but POST is not

# Test different HTTP methods
for method in GET POST PUT DELETE PATCH; do
    status=$(curl -s -o /dev/null -w "%{http_code}" \
        -X $method \
        -H "Authorization: Bearer $USER_TOKEN" \
        "https://target.com/api/admin/settings")
    echo "$method /api/admin/settings: $status"
done
```

---

## Tools

### Automated Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Suite Autorize** | Access control testing | Automatic re-request with different sessions |
| **OWASP ZAP Access Control** | Automated role testing | Context-based access testing |
| **AuthMatrix** | Burp extension | Matrix-based authorization testing |

### Manual Testing

| Tool | Description |
|------|-------------|
| **Burp Suite** | Intercept and modify role parameters |
| **Postman** | Create collections for different roles |
| **curl** | Command-line HTTP testing |

---

## Example Commands/Payloads

### Role Manipulation Payloads

```json
// User registration with role injection
{
    "username": "attacker",
    "password": "password123",
    "email": "attacker@test.com",
    "role": "admin"
}

// Profile update with role escalation
{
    "name": "Attacker",
    "role": "administrator",
    "isAdmin": true,
    "permissions": ["all"]
}

// JWT manipulation (if applicable)
// Original: {"sub":"user123","role":"user"}
// Modified: {"sub":"user123","role":"admin"}
```

### Autorize Setup Script

```python
# Burp Autorize configuration
# 1. Install Autorize extension
# 2. Configure low-privileged session cookie
# 3. Enable interception
# 4. Browse as admin
# 5. Review color-coded results:
#    - Green: Access denied (correct)
#    - Red: Access granted (vulnerability)
#    - Yellow: Different response (investigate)
```

---

## Remediation Guide

### 1. Implement Proper RBAC

```python
# Python/Flask example
from functools import wraps
from flask import g, abort

def role_required(required_role):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if not g.user:
                abort(401)
            if g.user.role != required_role and g.user.role != 'admin':
                abort(403)
            return f(*args, **kwargs)
        return decorated_function
    return decorator

@app.route('/admin/users')
@role_required('admin')
def admin_users():
    return get_all_users()
```

### 2. Centralized Authorization

```java
// Java/Spring Security
@Configuration
@EnableGlobalMethodSecurity(prePostEnabled = true)
public class SecurityConfig {

    @PreAuthorize("hasRole('ADMIN')")
    public void adminOnlyMethod() {
        // Only admins can access
    }

    @PreAuthorize("hasAnyRole('ADMIN', 'MODERATOR')")
    public void moderatorMethod() {
        // Admins and moderators
    }
}
```

### 3. Server-Side Role Validation

```javascript
// Node.js/Express middleware
const checkRole = (allowedRoles) => {
    return (req, res, next) => {
        const userRole = req.user.role;

        if (!allowedRoles.includes(userRole)) {
            return res.status(403).json({
                error: 'Access denied'
            });
        }

        next();
    };
};

// Usage
app.get('/admin/users',
    authenticate,
    checkRole(['admin']),
    adminController.getUsers
);
```

### 4. Best Practices

- Define roles in a central configuration
- Use role inheritance carefully
- Never trust client-side role information
- Implement role checks at every access point
- Log all authorization failures
- Regular access control audits

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| No role definitions | 8.8 | High |
| Role bypass possible | 8.8 | High |
| Privilege escalation via role manipulation | 8.8 | High |
| Incomplete role enforcement | 6.5 | Medium |

**Privilege Escalation Vector**: CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-269** | Improper Privilege Management | Incorrect role handling |
| **CWE-284** | Improper Access Control | Missing authorization |
| **CWE-285** | Improper Authorization | Authorization bypass |
| **CWE-862** | Missing Authorization | No role check |

---

## References

- [OWASP WSTG - Test Role Definitions](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/03-Identity_Management_Testing/01-Test_Role_Definitions)
- [OWASP Authorization Testing](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/05-Authorization_Testing/)
- [Burp Suite Autorize](https://github.com/PortSwigger/autorize)

---

## Checklist

```
[ ] Available roles identified
[ ] Role documentation reviewed
[ ] Role permissions mapped
[ ] Vertical privilege escalation tested
[ ] Horizontal access tested
[ ] Role parameter manipulation tested
[ ] All HTTP methods tested
[ ] Role enforcement consistency verified
[ ] Client-side role checks identified
[ ] Server-side enforcement confirmed
[ ] Findings documented
[ ] Remediation recommendations provided
```
