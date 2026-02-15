# WSTG-IDNT-05: Test Username Policy

## Test ID
WSTG-IDNT-05

## Test Name
Testing for Weak or Unenforced Username Policy

## High-Level Description

Username policy testing evaluates the rules and restrictions applied to username creation and management. Weak username policies can lead to account enumeration, impersonation attacks, and user confusion. This test examines whether the application enforces appropriate restrictions on username format, length, allowed characters, and uniqueness while preventing predictable or malicious usernames.

---

## What to Check

### Username Policy Elements

- [ ] Minimum/maximum length requirements
- [ ] Allowed character sets
- [ ] Case sensitivity handling
- [ ] Reserved username protection
- [ ] Duplicate prevention
- [ ] Username format validation
- [ ] Special character handling

### Security Considerations

| Aspect | Risk |
|--------|------|
| Predictable usernames | Account enumeration |
| Similar usernames | User confusion/impersonation |
| No reserved words | Admin impersonation |
| Case insensitive | Duplicate accounts |
| Special chars allowed | XSS/Injection |

---

## How to Test

### Step 1: Test Username Length Limits

```bash
# Test minimum length
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "a",
        "email": "short1@test.com",
        "password": "TestPass123!"
    }'

curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "ab",
        "email": "short2@test.com",
        "password": "TestPass123!"
    }'

# Test maximum length
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "'$(python3 -c "print('a'*100)"))'"',
        "email": "long1@test.com",
        "password": "TestPass123!"
    }'

curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "'$(python3 -c "print('a'*1000)"))'"',
        "email": "long2@test.com",
        "password": "TestPass123!"
    }'
```

### Step 2: Test Reserved/Restricted Usernames

```bash
#!/bin/bash
# Test reserved usernames

RESERVED_NAMES=(
    "admin" "administrator" "root" "system"
    "support" "help" "info" "security"
    "moderator" "mod" "staff" "official"
    "webmaster" "postmaster" "hostmaster"
    "null" "undefined" "anonymous" "guest"
    "api" "www" "mail" "ftp" "smtp"
)

for name in "${RESERVED_NAMES[@]}"; do
    response=$(curl -s -X POST "https://target.com/api/register" \
        -H "Content-Type: application/json" \
        -d "{
            \"username\": \"$name\",
            \"email\": \"${name}@test.com\",
            \"password\": \"TestPass123!\"
        }")

    echo "$name: $response"
done
```

### Step 3: Test Case Sensitivity

```bash
# First, create a user
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "testuser",
        "email": "case1@test.com",
        "password": "TestPass123!"
    }'

# Try variations
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "TestUser",
        "email": "case2@test.com",
        "password": "TestPass123!"
    }'

curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "TESTUSER",
        "email": "case3@test.com",
        "password": "TestPass123!"
    }'

curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "tEsTuSeR",
        "email": "case4@test.com",
        "password": "TestPass123!"
    }'
```

### Step 4: Test Special Characters

```bash
#!/bin/bash
# Test special character handling

SPECIAL_CHARS=(
    "test<script>"
    "test'user"
    "test\"user"
    "test;user"
    "test--user"
    "test/*user"
    "test../user"
    "test%00user"
    "test\nuser"
    "test\tuser"
    "test user"
    "test@user"
    "test#user"
    "test&user"
    "test=user"
    "test+user"
)

for username in "${SPECIAL_CHARS[@]}"; do
    response=$(curl -s -X POST "https://target.com/api/register" \
        -H "Content-Type: application/json" \
        -d "{
            \"username\": \"$username\",
            \"email\": \"special$(date +%s)@test.com\",
            \"password\": \"TestPass123!\"
        }" 2>/dev/null)

    echo "Testing: $username"
    echo "Response: $response"
    echo "---"
done
```

### Step 5: Test Unicode/Homograph Attacks

```bash
# Test Unicode lookalikes
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "аdmin",
        "email": "unicode1@test.com",
        "password": "TestPass123!"
    }'  # Cyrillic 'а' instead of Latin 'a'

curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "ɑdmin",
        "email": "unicode2@test.com",
        "password": "TestPass123!"
    }'  # Latin alpha

curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "admin\u200b",
        "email": "unicode3@test.com",
        "password": "TestPass123!"
    }'  # Zero-width space

curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "admin\u00a0",
        "email": "unicode4@test.com",
        "password": "TestPass123!"
    }'  # Non-breaking space
```

### Step 6: Test Similar Username Prevention

```bash
# Test confusing similar usernames
# If "company_admin" exists, try:
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "company-admin",
        "email": "similar1@test.com",
        "password": "TestPass123!"
    }'

curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "company.admin",
        "email": "similar2@test.com",
        "password": "TestPass123!"
    }'

curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "companyadmin",
        "email": "similar3@test.com",
        "password": "TestPass123!"
    }'

curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "company__admin",
        "email": "similar4@test.com",
        "password": "TestPass123!"
    }'
```

### Step 7: Test Numeric/Sequential Usernames

```bash
# Test purely numeric usernames
for num in 1 12 123 1234 12345; do
    curl -s -X POST "https://target.com/api/register" \
        -H "Content-Type: application/json" \
        -d "{
            \"username\": \"$num\",
            \"email\": \"num$num@test.com\",
            \"password\": \"TestPass123!\"
        }"
done

# Test sequential patterns
for user in user1 user2 user3 test1 test2 test3; do
    curl -s -X POST "https://target.com/api/register" \
        -H "Content-Type: application/json" \
        -d "{
            \"username\": \"$user\",
            \"email\": \"$user@test.com\",
            \"password\": \"TestPass123!\"
        }"
done
```

---

## Tools

### Manual Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Suite** | Request manipulation | Test various username formats |
| **curl** | Command-line HTTP | Scripted testing |
| **Unicode tools** | Character lookup | Homograph testing |

### Automated Testing

| Tool | Description |
|------|-------------|
| **Burp Intruder** | Fuzzing usernames |
| **Custom scripts** | Comprehensive testing |
| **Regex testers** | Validate patterns |

---

## Example Commands/Payloads

### Username Policy Test Payloads

```text
# Length tests
a
ab
abc
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa (very long)

# Reserved names
admin
administrator
root
system
support
null
undefined

# Case variations
Admin
ADMIN
aDmIn

# Special characters
user<script>
user'test
user"test
user;test
user--test
user/../admin
user%00admin

# Unicode/Homograph
аdmin (Cyrillic a)
ɑdmin (Latin alpha)
admin​ (zero-width space)
admin (with invisible chars)

# Similar patterns
company_admin
company-admin
company.admin
companyadmin

# Numeric
123456
user123
1user
```

### Comprehensive Policy Tester

```python
#!/usr/bin/env python3
import requests
import json
import unicodedata

class UsernamePolicyTester:
    def __init__(self, register_url):
        self.url = register_url
        self.results = []

    def test_username(self, username, description):
        """Test a single username"""
        try:
            response = requests.post(
                self.url,
                json={
                    "username": username,
                    "email": f"test_{hash(username)}@test.com",
                    "password": "TestPass123!"
                },
                timeout=10
            )

            result = {
                "username": username,
                "description": description,
                "status": response.status_code,
                "accepted": response.status_code in [200, 201],
                "response": response.text[:200]
            }

        except Exception as e:
            result = {
                "username": username,
                "description": description,
                "error": str(e)
            }

        self.results.append(result)
        return result

    def run_all_tests(self):
        """Run comprehensive policy tests"""

        # Length tests
        self.test_username("a", "1 character")
        self.test_username("ab", "2 characters")
        self.test_username("abc", "3 characters")
        self.test_username("a" * 50, "50 characters")
        self.test_username("a" * 100, "100 characters")
        self.test_username("a" * 500, "500 characters")

        # Reserved names
        reserved = ["admin", "administrator", "root", "system",
                   "support", "null", "undefined", "api", "www"]
        for name in reserved:
            self.test_username(name, f"Reserved: {name}")

        # Case sensitivity
        self.test_username("TestCase", "Mixed case")
        self.test_username("testcase", "Lower case")
        self.test_username("TESTCASE", "Upper case")

        # Special characters
        specials = [
            ("test<tag>", "HTML tag"),
            ("test'quote", "Single quote"),
            ("test\"quote", "Double quote"),
            ("test;semi", "Semicolon"),
            ("test--sql", "SQL comment"),
            ("test../path", "Path traversal"),
            ("test user", "Space"),
            ("test\tuser", "Tab"),
        ]
        for username, desc in specials:
            self.test_username(username, desc)

        # Unicode/Homograph
        self.test_username("аdmin", "Cyrillic 'a'")  # Cyrillic
        self.test_username("admin\u200b", "Zero-width space")
        self.test_username("admin\u00a0", "Non-breaking space")

        # Numeric
        self.test_username("123456", "Pure numeric")
        self.test_username("user123", "Alphanumeric")

        return self.results

    def print_report(self):
        """Print test results"""
        print("\n=== USERNAME POLICY TEST RESULTS ===\n")

        accepted = [r for r in self.results if r.get("accepted")]
        rejected = [r for r in self.results if not r.get("accepted") and "error" not in r]
        errors = [r for r in self.results if "error" in r]

        print(f"Accepted: {len(accepted)}")
        print(f"Rejected: {len(rejected)}")
        print(f"Errors: {len(errors)}")

        print("\n--- ACCEPTED (Potential Issues) ---")
        for r in accepted:
            print(f"  {r['description']}: {r['username'][:30]}")

        print("\n--- REJECTED (Expected) ---")
        for r in rejected:
            print(f"  {r['description']}: {r['username'][:30]}")

# Usage
tester = UsernamePolicyTester("https://target.com/api/register")
tester.run_all_tests()
tester.print_report()
```

---

## Remediation Guide

### 1. Comprehensive Username Validation

```python
import re
import unicodedata

def validate_username(username):
    """Validate username against security policy"""
    errors = []

    # Length check
    if len(username) < 3:
        errors.append("Username must be at least 3 characters")
    if len(username) > 30:
        errors.append("Username must be 30 characters or less")

    # Allowed characters (alphanumeric + underscore only)
    if not re.match(r'^[a-zA-Z0-9_]+$', username):
        errors.append("Username can only contain letters, numbers, and underscores")

    # Must start with letter
    if not re.match(r'^[a-zA-Z]', username):
        errors.append("Username must start with a letter")

    # No consecutive underscores
    if '__' in username:
        errors.append("Username cannot contain consecutive underscores")

    # Reserved names check
    reserved = ['admin', 'administrator', 'root', 'system', 'support',
                'null', 'undefined', 'api', 'www', 'mail', 'ftp']
    if username.lower() in reserved:
        errors.append("This username is reserved")

    # Check for Unicode tricks
    normalized = unicodedata.normalize('NFKC', username)
    if normalized != username:
        errors.append("Username contains invalid characters")

    # Check for confusable characters
    if contains_confusables(username):
        errors.append("Username contains potentially confusing characters")

    return errors

def contains_confusables(username):
    """Check for homograph/confusable characters"""
    # Simple check - only allow ASCII
    try:
        username.encode('ascii')
        return False
    except UnicodeEncodeError:
        return True
```

### 2. Case-Insensitive Uniqueness

```python
from sqlalchemy import func

def is_username_available(username):
    """Check username availability (case-insensitive)"""
    normalized = username.lower()

    existing = User.query.filter(
        func.lower(User.username) == normalized
    ).first()

    return existing is None

def create_user(username, email, password):
    if not is_username_available(username):
        raise ValueError("Username already taken")

    # Store normalized (lowercase) version
    user = User(
        username=username,
        username_normalized=username.lower(),
        email=email
    )
    # ...
```

### 3. Similar Username Detection

```python
def is_similar_to_existing(username):
    """Check if username is too similar to existing ones"""
    normalized = normalize_for_comparison(username)

    similar_users = User.query.filter(
        User.username_normalized.like(f"%{normalized}%")
    ).all()

    for user in similar_users:
        if calculate_similarity(normalized, user.username_normalized) > 0.8:
            return True

    return False

def normalize_for_comparison(username):
    """Normalize username for similarity comparison"""
    # Remove separators
    normalized = re.sub(r'[-_.]', '', username.lower())
    # Remove numbers
    normalized = re.sub(r'[0-9]', '', normalized)
    return normalized
```

### 4. Display Name vs Username

```python
# Allow more flexibility in display names
# Keep strict rules for usernames (used in URLs, mentions)

class User:
    username = Column(String(30))  # Strict validation
    display_name = Column(String(50))  # More relaxed

    @validates('username')
    def validate_username(self, key, username):
        errors = validate_username(username)
        if errors:
            raise ValueError('; '.join(errors))
        return username
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Reserved names allowed (admin) | 7.5 | High |
| Unicode homograph allowed | 6.5 | Medium |
| Case sensitivity issues | 5.3 | Medium |
| XSS via username | 6.1 | Medium |
| Weak length requirements | 3.7 | Low |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-20** | Improper Input Validation | Weak username validation |
| **CWE-79** | Cross-site Scripting | XSS via username |
| **CWE-178** | Improper Handling of Case | Case sensitivity issues |

---

## References

- [OWASP WSTG - Testing for Weak Username Policy](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/03-Identity_Management_Testing/05-Testing_for_Weak_or_Unenforced_Username_Policy)
- [Unicode Security Considerations](https://unicode.org/reports/tr36/)
- [OWASP Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)

---

## Checklist

```
[ ] Minimum length requirement tested
[ ] Maximum length limit tested
[ ] Reserved username protection tested
[ ] Case sensitivity verified
[ ] Special character handling tested
[ ] Unicode/homograph attacks tested
[ ] SQL injection in username tested
[ ] XSS in username tested
[ ] Similar username prevention tested
[ ] Numeric-only usernames tested
[ ] Sequential pattern prevention tested
[ ] Whitespace handling tested
[ ] Findings documented
[ ] Remediation recommendations provided
```
