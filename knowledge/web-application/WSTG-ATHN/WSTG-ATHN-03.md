# WSTG-ATHN-03: Testing for Weak Lock Out Mechanism

## Test ID
WSTG-ATHN-03

## Test Name
Testing for Weak Lock Out Mechanism

## High-Level Description

Account lockout mechanisms are designed to protect against brute-force password attacks by temporarily or permanently locking accounts after a certain number of failed login attempts. This test evaluates whether the lockout mechanism is properly implemented and cannot be bypassed. Weak or missing lockout mechanisms allow attackers to perform unlimited password guessing attempts.

---

## What to Check

### Lockout Implementation

- [ ] Lockout threshold exists
- [ ] Lockout duration appropriate
- [ ] Lockout applies to all authentication methods
- [ ] Lockout cannot be bypassed
- [ ] Account enumeration via lockout
- [ ] Denial of service via lockout

### Bypass Techniques

| Technique | Description |
|-----------|-------------|
| IP rotation | Different IPs reset counter |
| Session rotation | New sessions reset counter |
| Username variation | Case changes bypass counter |
| Simultaneous attacks | Race conditions |
| Alternative endpoints | Different login paths |

---

## How to Test

### Step 1: Determine Lockout Threshold

```bash
#!/bin/bash
TARGET="https://target.com/api/login"
USERNAME="testuser"

echo "Testing lockout threshold..."

for i in {1..20}; do
    response=$(curl -s -X POST "$TARGET" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$USERNAME\",\"password\":\"wrongpass$i\"}")

    echo "Attempt $i: $response"

    # Check for lockout indicators
    if echo "$response" | grep -qi "locked\|blocked\|too many"; then
        echo "[+] Account locked after $i attempts"
        break
    fi
done
```

### Step 2: Test Lockout Duration

```bash
#!/bin/bash
# After account is locked, test how long until it unlocks

TARGET="https://target.com/api/login"
USERNAME="testuser"
CORRECT_PASSWORD="correctpassword"

# First, lock the account
for i in {1..10}; do
    curl -s -X POST "$TARGET" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$USERNAME\",\"password\":\"wrong\"}" > /dev/null
done

echo "Account should be locked. Testing unlock timing..."

# Test every minute
for minute in {1..30}; do
    sleep 60
    response=$(curl -s -X POST "$TARGET" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$USERNAME\",\"password\":\"$CORRECT_PASSWORD\"}")

    if echo "$response" | grep -qi "success\|token"; then
        echo "[+] Account unlocked after $minute minutes"
        break
    else
        echo "Minute $minute: Still locked"
    fi
done
```

### Step 3: Test IP-Based Bypass

```bash
#!/bin/bash
# Test if lockout is per-IP or per-account

TARGET="https://target.com/api/login"
USERNAME="testuser"

# Use different X-Forwarded-For headers
ips=("1.1.1.1" "2.2.2.2" "3.3.3.3" "4.4.4.4" "5.5.5.5")

for ip in "${ips[@]}"; do
    for i in {1..10}; do
        curl -s -X POST "$TARGET" \
            -H "Content-Type: application/json" \
            -H "X-Forwarded-For: $ip" \
            -d "{\"username\":\"$USERNAME\",\"password\":\"wrong$i\"}" > /dev/null
    done
    echo "Sent 10 attempts from $ip"
done

# Now test if account is locked
response=$(curl -s -X POST "$TARGET" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$USERNAME\",\"password\":\"wrongtest\"}")

if echo "$response" | grep -qi "locked"; then
    echo "[+] Account is locked (proper implementation)"
else
    echo "[!] Account not locked - IP-based lockout may be bypassable"
fi
```

### Step 4: Test Session-Based Bypass

```bash
#!/bin/bash
TARGET="https://target.com/login"
USERNAME="testuser"

# Try multiple sessions
for session in {1..5}; do
    echo "Session $session..."

    for i in {1..5}; do
        curl -s -X POST "$TARGET" \
            -H "Content-Type: application/x-www-form-urlencoded" \
            -c cookies_$session.txt \
            -b cookies_$session.txt \
            -d "username=$USERNAME&password=wrong$i" > /dev/null
    done

    rm cookies_$session.txt
done

# Test if still locked
response=$(curl -s -X POST "$TARGET" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=$USERNAME&password=test")

echo "Final response: $response"
```

### Step 5: Test Username Variation Bypass

```bash
#!/bin/bash
TARGET="https://target.com/api/login"

# Test username case sensitivity
usernames=("admin" "Admin" "ADMIN" "aDmIn" " admin" "admin ")

for username in "${usernames[@]}"; do
    for i in {1..5}; do
        curl -s -X POST "$TARGET" \
            -H "Content-Type: application/json" \
            -d "{\"username\":\"$username\",\"password\":\"wrong$i\"}" > /dev/null
    done
    echo "Sent 5 attempts for: '$username'"
done

# Total: 30 attempts if all treated as same user
# Check if any version is locked
for username in "${usernames[@]}"; do
    response=$(curl -s -X POST "$TARGET" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$username\",\"password\":\"test\"}")

    echo "'$username': $response" | head -c 100
    echo ""
done
```

### Step 6: Test Alternative Login Endpoints

```bash
# Test if lockout applies to all login methods

endpoints=(
    "/login"
    "/api/login"
    "/api/v1/login"
    "/api/v2/auth"
    "/oauth/token"
    "/auth/login"
    "/mobile/login"
)

USERNAME="testuser"

# Lock account on main endpoint
for i in {1..10}; do
    curl -s -X POST "https://target.com/login" \
        -d "username=$USERNAME&password=wrong" > /dev/null
done

# Try other endpoints
for endpoint in "${endpoints[@]}"; do
    response=$(curl -s -X POST "https://target.com$endpoint" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$USERNAME\",\"password\":\"test\"}" \
        -w "\n%{http_code}")

    echo "$endpoint: $response" | tail -2
done
```

### Step 7: Test Account Lockout Enumeration

```bash
#!/bin/bash
# Test if lockout behavior reveals valid accounts

TARGET="https://target.com/api/login"

# Test with valid username
echo "Testing with potentially valid username..."
for i in {1..10}; do
    curl -s -X POST "$TARGET" \
        -H "Content-Type: application/json" \
        -d '{"username":"admin","password":"wrong"}' > /dev/null
done

valid_response=$(curl -s -X POST "$TARGET" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"wrong"}')

# Test with invalid username
echo "Testing with invalid username..."
for i in {1..10}; do
    curl -s -X POST "$TARGET" \
        -H "Content-Type: application/json" \
        -d '{"username":"definitelynotauser12345","password":"wrong"}' > /dev/null
done

invalid_response=$(curl -s -X POST "$TARGET" \
    -H "Content-Type: application/json" \
    -d '{"username":"definitelynotauser12345","password":"wrong"}')

echo "Valid username response: $valid_response"
echo "Invalid username response: $invalid_response"

# If responses are different, accounts can be enumerated
```

---

## Tools

### Brute Force Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **Hydra** | Fast brute-forcer | `hydra -l admin -P wordlist.txt target http-post` |
| **Burp Intruder** | Request repeater | Test lockout behavior |
| **Custom scripts** | Targeted testing | Control timing and sources |

### Analysis

| Tool | Description |
|------|-------------|
| **Burp Suite** | Response comparison |
| **OWASP ZAP** | Automated scanning |

---

## Example Commands/Payloads

### Lockout Testing Script

```python
#!/usr/bin/env python3
import requests
import time
from concurrent.futures import ThreadPoolExecutor

class LockoutTester:
    def __init__(self, login_url, username):
        self.url = login_url
        self.username = username
        self.results = {}

    def attempt_login(self, password, headers=None):
        """Single login attempt"""
        try:
            response = requests.post(
                self.url,
                json={"username": self.username, "password": password},
                headers=headers or {},
                timeout=10
            )
            return response.status_code, response.text
        except Exception as e:
            return None, str(e)

    def find_lockout_threshold(self, max_attempts=30):
        """Find number of attempts before lockout"""
        print(f"Finding lockout threshold for {self.username}...")

        for i in range(1, max_attempts + 1):
            status, text = self.attempt_login(f"wrongpassword{i}")

            if "locked" in text.lower() or "too many" in text.lower():
                self.results["threshold"] = i
                print(f"[+] Lockout after {i} attempts")
                return i

            time.sleep(0.5)  # Small delay

        self.results["threshold"] = f">{max_attempts}"
        print(f"[!] No lockout after {max_attempts} attempts")
        return None

    def test_ip_bypass(self, attempts_per_ip=5):
        """Test if X-Forwarded-For bypasses lockout"""
        print("Testing IP-based bypass...")

        fake_ips = [f"10.0.0.{i}" for i in range(1, 11)]

        for ip in fake_ips:
            for i in range(attempts_per_ip):
                self.attempt_login(
                    f"wrong{i}",
                    headers={"X-Forwarded-For": ip}
                )

        # Test if account is now locked
        status, text = self.attempt_login("test")

        if "locked" in text.lower():
            self.results["ip_bypass"] = False
            print("[+] IP bypass NOT possible - lockout is per-account")
        else:
            self.results["ip_bypass"] = True
            print("[!] IP bypass MAY be possible")

    def test_concurrent_bypass(self, num_threads=10):
        """Test race condition in lockout"""
        print("Testing concurrent request bypass...")

        def attempt():
            return self.attempt_login("wrongpassword")

        with ThreadPoolExecutor(max_workers=num_threads) as executor:
            futures = [executor.submit(attempt) for _ in range(50)]
            results = [f.result() for f in futures]

        # Check final state
        success_count = sum(1 for s, t in results if s == 200 and "locked" not in t.lower())

        self.results["concurrent_bypass"] = success_count > 10
        print(f"Successful attempts during race: {success_count}")

    def test_username_variation(self):
        """Test if username case affects lockout"""
        print("Testing username variation bypass...")

        variations = [
            self.username,
            self.username.upper(),
            self.username.lower(),
            self.username.capitalize(),
            f" {self.username}",
            f"{self.username} "
        ]

        for var in variations:
            for i in range(3):
                requests.post(
                    self.url,
                    json={"username": var, "password": f"wrong{i}"},
                    timeout=10
                )

        # Test original username
        status, text = self.attempt_login("test")

        if "locked" in text.lower():
            self.results["username_bypass"] = False
            print("[+] Username normalization working correctly")
        else:
            self.results["username_bypass"] = True
            print("[!] Username variation may bypass lockout")

    def generate_report(self):
        """Generate test report"""
        print("\n=== LOCKOUT MECHANISM TEST REPORT ===\n")

        for test, result in self.results.items():
            status = "[VULN]" if result is True or result == ">30" else "[OK]"
            print(f"{status} {test}: {result}")

# Usage
tester = LockoutTester("https://target.com/api/login", "testuser")
tester.find_lockout_threshold()
tester.test_ip_bypass()
tester.test_concurrent_bypass()
tester.test_username_variation()
tester.generate_report()
```

---

## Remediation Guide

### 1. Implement Proper Account Lockout

```python
import redis
from datetime import datetime, timedelta

redis_client = redis.Redis()

class AccountLockout:
    LOCKOUT_THRESHOLD = 5
    LOCKOUT_DURATION = 900  # 15 minutes
    ATTEMPT_WINDOW = 3600  # 1 hour

    def record_failure(self, username):
        """Record failed login attempt"""
        # Normalize username
        username = username.lower().strip()

        key = f"login_attempts:{username}"
        attempts = redis_client.incr(key)

        if attempts == 1:
            redis_client.expire(key, self.ATTEMPT_WINDOW)

        if attempts >= self.LOCKOUT_THRESHOLD:
            self.lock_account(username)
            return True

        return False

    def lock_account(self, username):
        """Lock the account"""
        username = username.lower().strip()
        lock_key = f"account_locked:{username}"
        redis_client.setex(lock_key, self.LOCKOUT_DURATION, datetime.utcnow().isoformat())

        # Log security event
        log_security_event("account_locked", {
            "username": username,
            "locked_until": datetime.utcnow() + timedelta(seconds=self.LOCKOUT_DURATION)
        })

    def is_locked(self, username):
        """Check if account is locked"""
        username = username.lower().strip()
        return redis_client.exists(f"account_locked:{username}")

    def get_remaining_lockout(self, username):
        """Get remaining lockout time in seconds"""
        username = username.lower().strip()
        ttl = redis_client.ttl(f"account_locked:{username}")
        return max(0, ttl)

    def clear_on_success(self, username):
        """Clear attempts on successful login"""
        username = username.lower().strip()
        redis_client.delete(f"login_attempts:{username}")

lockout = AccountLockout()

@app.route('/login', methods=['POST'])
def login():
    username = request.json.get('username', '')
    password = request.json.get('password', '')

    # Check lockout first
    if lockout.is_locked(username):
        remaining = lockout.get_remaining_lockout(username)
        return jsonify({
            "error": "Account temporarily locked",
            "retry_after": remaining
        }), 429

    user = authenticate(username, password)

    if not user:
        locked = lockout.record_failure(username)

        if locked:
            return jsonify({
                "error": "Account locked due to too many failed attempts",
                "retry_after": lockout.LOCKOUT_DURATION
            }), 429

        return jsonify({"error": "Invalid credentials"}), 401

    # Clear attempts on success
    lockout.clear_on_success(username)

    return jsonify({"token": generate_token(user)})
```

### 2. Prevent Lockout-Based Enumeration

```python
def login():
    username = request.json.get('username', '')
    password = request.json.get('password', '')

    # Always check lockout, even for non-existent users
    if lockout.is_locked(username):
        # Generic message - don't reveal account existence
        return jsonify({
            "error": "Account temporarily locked",
            "retry_after": lockout.LOCKOUT_DURATION
        }), 429

    user = authenticate(username, password)

    if not user:
        # Record failure even for non-existent users
        # Prevents enumeration via different lockout behavior
        lockout.record_failure(username)

        # Generic error message
        return jsonify({"error": "Invalid credentials"}), 401

    return jsonify({"token": generate_token(user)})
```

### 3. Prevent DoS via Lockout

```python
class SmartLockout:
    """Prevent attackers from locking out legitimate users"""

    def record_failure(self, username, ip_address):
        # Track both account and IP
        account_attempts = self.get_account_attempts(username)
        ip_attempts = self.get_ip_attempts(ip_address)

        # If single IP causing all attempts, don't lock account
        if ip_attempts >= 10 and account_attempts < 3:
            # Block IP, not account
            self.block_ip(ip_address)
            return "ip_blocked"

        # Normal lockout
        if account_attempts >= 5:
            self.lock_account(username)
            return "account_locked"

        return "attempt_recorded"
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| No account lockout | 7.5 | High |
| Lockout bypass via IP rotation | 6.5 | Medium |
| Lockout bypass via username variation | 6.5 | Medium |
| Account enumeration via lockout | 5.3 | Medium |
| Very high lockout threshold (>20) | 5.3 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-307** | Improper Restriction of Excessive Authentication Attempts | Missing/weak lockout |
| **CWE-799** | Improper Control of Interaction Frequency | No rate limiting |
| **CWE-204** | Observable Response Discrepancy | Enumeration via lockout |

---

## References

- [OWASP WSTG - Testing for Weak Lock Out Mechanism](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/04-Authentication_Testing/03-Testing_for_Weak_Lock_Out_Mechanism)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [NIST Digital Identity Guidelines](https://pages.nist.gov/800-63-3/)

---

## Checklist

```
[ ] Lockout threshold identified
[ ] Lockout duration tested
[ ] IP-based bypass tested
[ ] Session-based bypass tested
[ ] Username variation bypass tested
[ ] Alternative endpoints tested
[ ] Race condition tested
[ ] Account enumeration tested
[ ] DoS via lockout considered
[ ] Lockout logging verified
[ ] Unlock mechanism tested
[ ] Findings documented
[ ] Remediation recommendations provided
```
