# WSTG-ATHN-07: Testing for Weak Password Policy

## Test ID
WSTG-ATHN-07

## Test Name
Testing for Weak Password Policy

## High-Level Description

Password policy testing evaluates the strength requirements enforced by an application during password creation and change. Weak policies allow users to create easily guessable passwords, making accounts vulnerable to brute-force and dictionary attacks. This test examines minimum length, complexity requirements, and protection against common weak passwords.

---

## What to Check

### Password Policy Elements

- [ ] Minimum length requirement
- [ ] Maximum length limit
- [ ] Complexity requirements (uppercase, lowercase, numbers, symbols)
- [ ] Dictionary word prevention
- [ ] Common password blocklist
- [ ] Personal information restrictions
- [ ] Password history (prevent reuse)

### Policy Weaknesses

| Weakness | Risk |
|----------|------|
| Short minimum length (<8) | Easy brute-force |
| No complexity requirements | Dictionary attacks |
| No blocklist | Common password usage |
| Allows personal info | Social engineering |
| No history check | Password cycling |

---

## How to Test

### Step 1: Test Minimum Length

```bash
#!/bin/bash
# Test minimum password length

lengths=(1 2 3 4 5 6 7 8 10 12 16)

for len in "${lengths[@]}"; do
    password=$(head -c $len < /dev/urandom | base64 | head -c $len)

    response=$(curl -s -X POST "https://target.com/api/change-password" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"current_password\": \"OldPassword123!\",
            \"new_password\": \"$password\"
        }")

    echo "Length $len: $response" | head -c 100
    echo ""
done
```

### Step 2: Test Complexity Requirements

```bash
#!/bin/bash
# Test password complexity requirements

# Test passwords with different complexity
passwords=(
    "password"           # lowercase only
    "PASSWORD"           # uppercase only
    "12345678"          # numbers only
    "!!!!!!!!!"         # symbols only
    "Password"          # mixed case
    "password1"         # lowercase + numbers
    "Password1"         # mixed case + numbers
    "Password1!"        # all complexity
)

for password in "${passwords[@]}"; do
    response=$(curl -s -X POST "https://target.com/api/change-password" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"current_password\": \"OldPassword123!\",
            \"new_password\": \"$password\"
        }")

    echo "$password: $response" | head -c 100
    echo ""
done
```

### Step 3: Test Common Passwords

```bash
#!/bin/bash
# Test if common passwords are blocked

common_passwords=(
    "password"
    "password123"
    "123456"
    "12345678"
    "qwerty"
    "abc123"
    "letmein"
    "welcome"
    "admin"
    "iloveyou"
    "monkey"
    "dragon"
    "master"
    "123456789"
    "Password1!"
)

for password in "${common_passwords[@]}"; do
    response=$(curl -s -X POST "https://target.com/api/change-password" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"current_password\": \"OldPassword123!\",
            \"new_password\": \"$password\"
        }")

    if echo "$response" | grep -qi "success"; then
        echo "[WEAK] Accepted common password: $password"
    else
        echo "[OK] Rejected: $password"
    fi
done
```

### Step 4: Test Personal Information in Password

```bash
# Test if password can contain username or email

username="johndoe"
email="john.doe@example.com"

test_passwords=(
    "${username}123!"
    "${username}Password"
    "Password${username}"
    "john.doe123"
    "johndoe2024"
)

for password in "${test_passwords[@]}"; do
    response=$(curl -s -X POST "https://target.com/api/change-password" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"new_password\": \"$password\"
        }")

    echo "$password: $response" | head -c 100
    echo ""
done
```

### Step 5: Test Password History

```bash
#!/bin/bash
# Test if previous passwords can be reused

original_password="OldPassword123!"
new_password="NewPassword456!"

# Change password
curl -s -X POST "https://target.com/api/change-password" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"current_password\": \"$original_password\",
        \"new_password\": \"$new_password\"
    }"

# Try to change back to original
response=$(curl -s -X POST "https://target.com/api/change-password" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"current_password\": \"$new_password\",
        \"new_password\": \"$original_password\"
    }")

if echo "$response" | grep -qi "success"; then
    echo "[WEAK] Password reuse allowed"
else
    echo "[OK] Password reuse prevented"
fi
```

### Step 6: Test Maximum Length

```bash
# Test maximum password length
# Some systems truncate long passwords silently

lengths=(64 128 256 512 1024)

for len in "${lengths[@]}"; do
    password=$(head -c $len < /dev/urandom | base64 | head -c $len)

    response=$(curl -s -X POST "https://target.com/api/change-password" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"current_password\": \"OldPassword123!\",
            \"new_password\": \"$password\"
        }" \
        -w "\nStatus: %{http_code}")

    echo "Length $len: $(echo "$response" | tail -1)"
done

# Test if long password is truncated
# Set very long password, then try to login with truncated version
```

### Step 7: Test Registration Password Policy

```bash
# Test password policy during registration
# May differ from change password policy

test_passwords=(
    "123"
    "password"
    "test"
    "abc123"
    "Password1"
    "Str0ngP@ssw0rd!"
)

for password in "${test_passwords[@]}"; do
    response=$(curl -s -X POST "https://target.com/api/register" \
        -H "Content-Type: application/json" \
        -d "{
            \"username\": \"testuser$(date +%s)\",
            \"email\": \"test$(date +%s)@example.com\",
            \"password\": \"$password\"
        }")

    echo "$password: $response" | head -c 100
    echo ""
done
```

---

## Tools

### Password Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Intruder** | Payload testing | Test password variations |
| **Custom scripts** | Automated testing | Systematic policy testing |
| **SecLists** | Common passwords | Wordlist testing |

### Password Analysis

| Tool | Description |
|------|-------------|
| **zxcvbn** | Password strength meter |
| **Have I Been Pwned** | Compromised password check |

---

## Example Commands/Payloads

### Password Policy Tester

```python
#!/usr/bin/env python3
import requests
import string
import random

class PasswordPolicyTester:
    def __init__(self, base_url, token):
        self.base_url = base_url
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        self.results = {}

    def try_password(self, password, endpoint="/api/change-password"):
        """Try to set a password and check if accepted"""
        try:
            response = requests.post(
                f"{self.base_url}{endpoint}",
                headers=self.headers,
                json={
                    "current_password": "CurrentPass123!",
                    "new_password": password
                }
            )

            accepted = response.status_code == 200 and \
                       "error" not in response.text.lower() and \
                       "invalid" not in response.text.lower()

            return accepted, response.text[:200]

        except Exception as e:
            return None, str(e)

    def test_minimum_length(self):
        """Find minimum password length"""
        print("[*] Testing minimum length...")

        for length in range(1, 20):
            # Create password that would pass complexity if length is ok
            password = "Aa1!" + "a" * (length - 4) if length >= 4 else "a" * length
            accepted, _ = self.try_password(password)

            if accepted:
                self.results["min_length"] = length
                print(f"    Minimum length: {length}")
                return length

        self.results["min_length"] = ">20"
        return None

    def test_complexity(self):
        """Test complexity requirements"""
        print("[*] Testing complexity requirements...")

        base_length = 12  # Use length that should pass length check

        tests = {
            "lowercase_only": "a" * base_length,
            "uppercase_only": "A" * base_length,
            "numbers_only": "1" * base_length,
            "symbols_only": "!" * base_length,
            "lower_upper": "Aa" * (base_length // 2),
            "lower_number": "a1" * (base_length // 2),
            "lower_upper_number": "Aa1" + "a" * (base_length - 3),
            "all_types": "Aa1!" + "a" * (base_length - 4),
        }

        complexity_results = {}
        for name, password in tests.items():
            accepted, _ = self.try_password(password)
            complexity_results[name] = accepted
            status = "ACCEPTED" if accepted else "REJECTED"
            print(f"    {name}: {status}")

        self.results["complexity"] = complexity_results

        # Determine required complexity
        if complexity_results.get("lowercase_only"):
            self.results["min_complexity"] = "None (lowercase only accepted)"
        elif complexity_results.get("lower_upper"):
            self.results["min_complexity"] = "Low (mixed case only)"
        elif complexity_results.get("lower_upper_number"):
            self.results["min_complexity"] = "Medium (letters + numbers)"
        elif complexity_results.get("all_types"):
            self.results["min_complexity"] = "High (all character types)"
        else:
            self.results["min_complexity"] = "Very High (all types rejected?)"

    def test_common_passwords(self):
        """Test common password blocking"""
        print("[*] Testing common password blocking...")

        common = [
            "password", "password123", "123456", "qwerty",
            "letmein", "welcome", "admin123", "Password1!",
            "iloveyou", "sunshine", "princess", "dragon"
        ]

        blocked = 0
        for pwd in common:
            # Add complexity if needed
            test_pwd = pwd if len(pwd) >= 8 else pwd + "123!"

            accepted, _ = self.try_password(test_pwd)
            if not accepted:
                blocked += 1

        self.results["common_blocked"] = f"{blocked}/{len(common)}"
        print(f"    Blocked {blocked}/{len(common)} common passwords")

    def test_password_history(self):
        """Test password reuse prevention"""
        print("[*] Testing password history...")

        # This would require actual password changes
        # Simplified version
        self.results["password_history"] = "Requires manual testing"

    def generate_report(self):
        """Generate policy report"""
        print("\n" + "=" * 50)
        print("PASSWORD POLICY ANALYSIS REPORT")
        print("=" * 50 + "\n")

        for key, value in self.results.items():
            print(f"{key}: {value}")

        # Security assessment
        print("\n--- SECURITY ASSESSMENT ---")

        issues = []

        if isinstance(self.results.get("min_length"), int):
            if self.results["min_length"] < 8:
                issues.append("Minimum length too short (< 8)")
            elif self.results["min_length"] < 12:
                issues.append("Consider increasing minimum to 12+")

        if "lowercase_only" in str(self.results.get("min_complexity", "")):
            issues.append("No complexity requirements")

        if self.results.get("common_blocked", "0/") == "0/":
            issues.append("Common passwords not blocked")

        if issues:
            print("\nISSUES FOUND:")
            for issue in issues:
                print(f"  - {issue}")
        else:
            print("\nNo major issues found.")

# Usage
tester = PasswordPolicyTester("https://target.com", "auth_token")
tester.test_minimum_length()
tester.test_complexity()
tester.test_common_passwords()
tester.generate_report()
```

---

## Remediation Guide

### 1. Implement Strong Password Policy

```python
import re
from zxcvbn import zxcvbn

# Common password list (use full list in production)
COMMON_PASSWORDS = {
    'password', 'password123', '123456', 'qwerty',
    'letmein', 'welcome', 'admin', 'admin123'
}

class PasswordValidator:
    MIN_LENGTH = 12
    MAX_LENGTH = 128
    HISTORY_COUNT = 10

    def validate(self, password, user=None):
        """Validate password against policy"""
        errors = []

        # Length check
        if len(password) < self.MIN_LENGTH:
            errors.append(f"Password must be at least {self.MIN_LENGTH} characters")

        if len(password) > self.MAX_LENGTH:
            errors.append(f"Password cannot exceed {self.MAX_LENGTH} characters")

        # Complexity check
        if not re.search(r'[a-z]', password):
            errors.append("Password must contain lowercase letters")

        if not re.search(r'[A-Z]', password):
            errors.append("Password must contain uppercase letters")

        if not re.search(r'\d', password):
            errors.append("Password must contain numbers")

        if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
            errors.append("Password must contain special characters")

        # Common password check
        if password.lower() in COMMON_PASSWORDS:
            errors.append("This password is too common")

        # Personal info check
        if user:
            if user.username.lower() in password.lower():
                errors.append("Password cannot contain username")
            if user.email.split('@')[0].lower() in password.lower():
                errors.append("Password cannot contain email")

        # Strength check using zxcvbn
        result = zxcvbn(password)
        if result['score'] < 3:
            errors.append(f"Password is too weak: {result['feedback']['warning']}")

        return errors

    def check_history(self, user, new_password):
        """Check against password history"""
        for old_hash in user.password_history[-self.HISTORY_COUNT:]:
            if check_password_hash(old_hash, new_password):
                return False
        return True
```

### 2. Integrate HaveIBeenPwned

```python
import hashlib
import requests

def check_pwned_password(password):
    """Check if password has been compromised"""
    sha1_hash = hashlib.sha1(password.encode()).hexdigest().upper()
    prefix = sha1_hash[:5]
    suffix = sha1_hash[5:]

    response = requests.get(
        f'https://api.pwnedpasswords.com/range/{prefix}',
        headers={'Add-Padding': 'true'}
    )

    if response.status_code == 200:
        hashes = response.text.split('\n')
        for hash_line in hashes:
            parts = hash_line.split(':')
            if parts[0] == suffix:
                return int(parts[1])  # Number of times seen

    return 0

# Usage in validation
def validate_password(password):
    pwned_count = check_pwned_password(password)
    if pwned_count > 0:
        return f"This password has been seen in {pwned_count} data breaches"
    return None
```

### 3. Password Strength Meter

```javascript
// Client-side password strength feedback
import zxcvbn from 'zxcvbn';

function checkPasswordStrength(password, userInputs = []) {
    const result = zxcvbn(password, userInputs);

    return {
        score: result.score,  // 0-4
        feedback: result.feedback,
        crackTime: result.crack_times_display.offline_slow_hashing_1e4_per_second,
        suggestions: result.feedback.suggestions
    };
}

// Usage
document.getElementById('password').addEventListener('input', (e) => {
    const strength = checkPasswordStrength(e.target.value, [username, email]);
    updateStrengthMeter(strength.score);
    showFeedback(strength.feedback);
});
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| No minimum length requirement | 7.5 | High |
| No complexity requirements | 6.5 | Medium |
| Common passwords allowed | 7.5 | High |
| Password reuse allowed | 5.3 | Medium |
| Very short minimum (<6) | 8.8 | High |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-521** | Weak Password Requirements | Insufficient policy |
| **CWE-262** | Not Using Password Aging | No history check |
| **CWE-263** | Password Aging with Long Expiration | Policy issues |

---

## References

- [OWASP WSTG - Testing for Weak Password Policy](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/04-Authentication_Testing/07-Testing_for_Weak_Password_Policy)
- [NIST Password Guidelines](https://pages.nist.gov/800-63-3/sp800-63b.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

---

## Checklist

```
[ ] Minimum length tested
[ ] Maximum length tested
[ ] Lowercase requirement tested
[ ] Uppercase requirement tested
[ ] Number requirement tested
[ ] Symbol requirement tested
[ ] Common passwords tested
[ ] Dictionary words tested
[ ] Personal info restriction tested
[ ] Password history tested
[ ] Password strength meter available
[ ] Breached password check implemented
[ ] Findings documented
[ ] Remediation recommendations provided
```
