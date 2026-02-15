# WSTG-IDNT-04: Test Account Enumeration

## Test ID
WSTG-IDNT-04

## Test Name
Testing for Account Enumeration and Guessable User Account

## High-Level Description

Account enumeration occurs when an application reveals whether a username or email exists in the system through different response messages, timing differences, or HTTP status codes. Attackers use this information to compile valid account lists for targeted attacks such as brute-force, credential stuffing, or phishing. This test identifies enumeration vulnerabilities across all authentication-related endpoints.

---

## What to Check

### Enumeration Vectors

- [ ] Login form responses
- [ ] Registration form responses
- [ ] Password reset functionality
- [ ] Username recovery feature
- [ ] API endpoints
- [ ] Response timing differences
- [ ] HTTP status code variations

### Response Indicators

| Location | Enumeration Sign |
|----------|------------------|
| Login | "Invalid username" vs "Invalid password" |
| Registration | "Username already exists" |
| Password Reset | "Email sent" vs "User not found" |
| API | Different status codes (404 vs 401) |
| Timing | Faster response for non-existent users |

---

## How to Test

### Step 1: Test Login Page Enumeration

```bash
# Test with valid username, wrong password
curl -s -X POST "https://target.com/login" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=admin&password=wrongpassword" \
    -w "\nTime: %{time_total}s"

# Test with invalid username
curl -s -X POST "https://target.com/login" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=nonexistentuser12345&password=wrongpassword" \
    -w "\nTime: %{time_total}s"

# Compare responses and timing
```

### Step 2: Test Registration Enumeration

```bash
# Try registering with existing username
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "admin",
        "email": "new@test.com",
        "password": "TestPass123!"
    }'

# Try registering with existing email
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "newuser123",
        "email": "admin@company.com",
        "password": "TestPass123!"
    }'

# Try with new email/username
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "completelynewabc",
        "email": "completelynew@test.com",
        "password": "TestPass123!"
    }'
```

### Step 3: Test Password Reset Enumeration

```bash
# Request reset for existing email
curl -s -X POST "https://target.com/api/password-reset" \
    -H "Content-Type: application/json" \
    -d '{"email": "admin@company.com"}'

# Request reset for non-existing email
curl -s -X POST "https://target.com/api/password-reset" \
    -H "Content-Type: application/json" \
    -d '{"email": "nonexistent@company.com"}'

# Compare responses - should be identical
```

### Step 4: Test API User Endpoints

```bash
# Check if user exists via API
curl -s "https://target.com/api/users/admin" \
    -w "\nStatus: %{http_code}"

curl -s "https://target.com/api/users/nonexistent123" \
    -w "\nStatus: %{http_code}"

# Check user profile endpoint
curl -s "https://target.com/api/profile/admin@company.com" \
    -w "\nStatus: %{http_code}"

# Check availability endpoint (if exists)
curl -s "https://target.com/api/check-username?username=admin"
curl -s "https://target.com/api/check-email?email=admin@company.com"
```

### Step 5: Timing Attack Analysis

```bash
#!/bin/bash
# Measure response times for different users

echo "=== TIMING ANALYSIS ==="

# Test valid users
for user in admin root administrator; do
    total=0
    for i in {1..10}; do
        time=$(curl -s -o /dev/null -w "%{time_total}" \
            -X POST "https://target.com/login" \
            -d "username=$user&password=wrongpassword")
        total=$(echo "$total + $time" | bc)
    done
    avg=$(echo "scale=3; $total / 10" | bc)
    echo "User: $user - Avg time: ${avg}s"
done

echo ""

# Test invalid users
for user in fakeuser123 nonexistent456 randomuser789; do
    total=0
    for i in {1..10}; do
        time=$(curl -s -o /dev/null -w "%{time_total}" \
            -X POST "https://target.com/login" \
            -d "username=$user&password=wrongpassword")
        total=$(echo "$total + $time" | bc)
    done
    avg=$(echo "scale=3; $total / 10" | bc)
    echo "User: $user - Avg time: ${avg}s"
done
```

### Step 6: Response Content Analysis

```bash
#!/bin/bash
# Analyze response differences

echo "=== RESPONSE ANALYSIS ==="

# Login responses
echo "Login - Valid user:"
curl -s -X POST "https://target.com/login" \
    -d "username=admin&password=wrong" | head -50

echo ""
echo "Login - Invalid user:"
curl -s -X POST "https://target.com/login" \
    -d "username=fake123&password=wrong" | head -50

# Compare for differences
echo ""
echo "Password Reset - Valid email:"
curl -s -X POST "https://target.com/password-reset" \
    -d "email=admin@company.com"

echo ""
echo "Password Reset - Invalid email:"
curl -s -X POST "https://target.com/password-reset" \
    -d "email=fake@company.com"
```

### Step 7: Username Guessing

```bash
#!/bin/bash
# Common username enumeration

USERNAMES=(
    "admin" "administrator" "root" "user" "test"
    "guest" "demo" "info" "support" "help"
    "sales" "contact" "webmaster" "postmaster"
)

for user in "${USERNAMES[@]}"; do
    response=$(curl -s -X POST "https://target.com/login" \
        -d "username=$user&password=test" \
        -w "|||%{http_code}")

    body=$(echo "$response" | cut -d'|' -f1)
    status=$(echo "$response" | cut -d'|' -f4)

    # Check for enumeration indicators
    if echo "$body" | grep -qi "incorrect password"; then
        echo "[FOUND] $user - Valid username (password error)"
    elif echo "$body" | grep -qi "user not found\|invalid username"; then
        echo "[NOT FOUND] $user"
    else
        echo "[CHECK] $user - Status: $status"
    fi
done
```

---

## Tools

### Automated Enumeration

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Intruder** | Automated enumeration | Payload lists + response comparison |
| **ffuf** | Fast fuzzer | `ffuf -w users.txt -X POST -d "user=FUZZ"` |
| **Hydra** | Password cracker | Has enumeration capabilities |
| **wfuzz** | Web fuzzer | Response-based filtering |

### Username Lists

| Source | Description |
|--------|-------------|
| **SecLists** | Common usernames |
| **Custom** | Company-specific patterns |
| **OSINT** | LinkedIn, email patterns |

---

## Example Commands/Payloads

### Ffuf User Enumeration

```bash
# Login enumeration
ffuf -w /usr/share/seclists/Usernames/top-usernames-shortlist.txt \
    -X POST \
    -d "username=FUZZ&password=invalidpassword" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -u https://target.com/login \
    -mc all \
    -fc 200 \
    -fr "Invalid username"

# With response size filtering
ffuf -w usernames.txt \
    -X POST \
    -d "username=FUZZ&password=test" \
    -u https://target.com/login \
    -fs 1234  # Filter out size of "invalid user" response
```

### Python Enumeration Script

```python
#!/usr/bin/env python3
import requests
import time
import statistics

class UserEnumerator:
    def __init__(self, target_url):
        self.target = target_url
        self.session = requests.Session()

    def check_login(self, username):
        """Test username via login"""
        start = time.time()
        response = self.session.post(
            f"{self.target}/login",
            data={"username": username, "password": "invalidpassword"},
            allow_redirects=False
        )
        elapsed = time.time() - start

        return {
            "username": username,
            "status": response.status_code,
            "length": len(response.text),
            "time": elapsed,
            "response": response.text[:200]
        }

    def check_password_reset(self, email):
        """Test email via password reset"""
        start = time.time()
        response = self.session.post(
            f"{self.target}/password-reset",
            json={"email": email}
        )
        elapsed = time.time() - start

        return {
            "email": email,
            "status": response.status_code,
            "length": len(response.text),
            "time": elapsed,
            "response": response.text[:200]
        }

    def timing_analysis(self, usernames, iterations=10):
        """Perform timing-based enumeration"""
        results = {}

        for username in usernames:
            times = []
            for _ in range(iterations):
                result = self.check_login(username)
                times.append(result["time"])
                time.sleep(0.1)  # Rate limiting

            results[username] = {
                "avg": statistics.mean(times),
                "stdev": statistics.stdev(times) if len(times) > 1 else 0
            }

        return results

    def enumerate(self, usernames):
        """Main enumeration function"""
        baseline_invalid = self.check_login("definitely_not_a_real_user_xyz")

        findings = []
        for username in usernames:
            result = self.check_login(username)

            # Compare with baseline
            if (result["length"] != baseline_invalid["length"] or
                result["status"] != baseline_invalid["status"]):
                findings.append({
                    "username": username,
                    "reason": "Different response",
                    "details": result
                })

        return findings

# Usage
enumerator = UserEnumerator("https://target.com")
usernames = ["admin", "root", "test", "user", "guest"]
findings = enumerator.enumerate(usernames)

for finding in findings:
    print(f"[FOUND] {finding['username']}: {finding['reason']}")
```

---

## Remediation Guide

### 1. Generic Error Messages

```python
# Bad - Reveals user existence
if not user_exists(username):
    return "User not found"
elif not check_password(username, password):
    return "Incorrect password"

# Good - Generic message
if not authenticate(username, password):
    return "Invalid username or password"
```

### 2. Consistent Response Times

```python
import time
import secrets

def authenticate(username, password):
    # Start timing
    start = time.time()

    user = get_user(username)

    if user:
        # Real password check
        result = verify_password(password, user.password_hash)
    else:
        # Dummy computation to match timing
        verify_password(password, get_dummy_hash())
        result = False

    # Ensure minimum response time
    elapsed = time.time() - start
    if elapsed < 0.5:
        time.sleep(0.5 - elapsed + secrets.randbelow(100) / 1000)

    return result
```

### 3. Rate Limiting

```python
from flask_limiter import Limiter

limiter = Limiter(app, key_func=get_remote_address)

@app.route('/login', methods=['POST'])
@limiter.limit("5 per minute")
def login():
    # Login logic
    pass

@app.route('/password-reset', methods=['POST'])
@limiter.limit("3 per hour")
def password_reset():
    # Always return same message
    return jsonify({
        "message": "If the email exists, a reset link has been sent"
    })
```

### 4. CAPTCHA After Failed Attempts

```python
failed_attempts = get_failed_attempts(request.remote_addr)

if failed_attempts >= 3:
    if not verify_captcha(request.form.get('captcha')):
        return jsonify({"error": "CAPTCHA required"}), 400
```

### 5. Account Lockout

```python
def check_lockout(username):
    attempts = get_failed_attempts(username)
    lockout_time = get_lockout_time(username)

    if lockout_time and datetime.now() < lockout_time:
        # Don't reveal if account exists
        return True

    if attempts >= 5:
        set_lockout(username, datetime.now() + timedelta(minutes=15))
        log_security_event("account_lockout", username)
        return True

    return False
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Username enumeration via login | 5.3 | Medium |
| Email enumeration via password reset | 5.3 | Medium |
| Timing-based enumeration | 3.7 | Low |
| API-based enumeration | 5.3 | Medium |

**Attack Vector**: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-204** | Observable Response Discrepancy | Different error messages |
| **CWE-203** | Observable Discrepancy | Timing differences |
| **CWE-200** | Exposure of Sensitive Information | User existence revealed |

---

## References

- [OWASP WSTG - Testing for Account Enumeration](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/03-Identity_Management_Testing/04-Testing_for_Account_Enumeration_and_Guessable_User_Account)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [PortSwigger - Username Enumeration](https://portswigger.net/web-security/authentication/password-based/lab-username-enumeration-via-different-responses)

---

## Checklist

```
[ ] Login form tested for enumeration
[ ] Registration form tested
[ ] Password reset tested
[ ] Username recovery tested
[ ] API endpoints tested
[ ] Response content compared
[ ] Response timing analyzed
[ ] HTTP status codes compared
[ ] Username guessing performed
[ ] Rate limiting verified
[ ] Lockout mechanism tested
[ ] Findings documented
[ ] Remediation recommendations provided
```
