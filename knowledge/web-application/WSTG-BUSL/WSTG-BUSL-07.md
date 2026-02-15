# WSTG-BUSL-07: Test Defenses Against Application Misuse

## Test ID
WSTG-BUSL-07

## Test Name
Test Defenses Against Application Misuse

## High-Level Description

Application misuse defense testing examines whether an application has adequate controls to detect and prevent abuse patterns. This includes testing for automated attack detection, unusual behavior monitoring, and defensive measures against brute force, scraping, credential stuffing, and other abuse scenarios. Effective defenses should identify malicious activity patterns and respond appropriately.

---

## What to Check

### Defense Mechanisms

- [ ] Rate limiting implementation
- [ ] Account lockout policies
- [ ] CAPTCHA deployment
- [ ] IP-based blocking
- [ ] Behavioral analysis
- [ ] Automated attack detection
- [ ] Fraud detection systems

### Abuse Scenarios

| Scenario | Defense Expected |
|----------|------------------|
| Brute force login | Account lockout, rate limiting |
| Credential stuffing | IP blocking, CAPTCHA |
| Web scraping | Rate limiting, bot detection |
| Price scraping | CAPTCHA, behavior analysis |
| Enumeration attacks | Generic responses, rate limiting |

---

## How to Test

### Step 1: Test Rate Limiting

```bash
#!/bin/bash
# Test rate limiting on various endpoints

ENDPOINTS=(
    "/api/login"
    "/api/password-reset"
    "/api/register"
    "/api/search"
    "/api/products"
)

for endpoint in "${ENDPOINTS[@]}"; do
    echo "Testing: $endpoint"
    count=0
    blocked=false

    for i in {1..100}; do
        status=$(curl -s -o /dev/null -w "%{http_code}" \
            -X POST "https://target.com$endpoint" \
            -H "Content-Type: application/json" \
            -d '{"test": "data"}')

        if [ "$status" == "429" ]; then
            echo "Rate limited after $i requests"
            blocked=true
            break
        fi
        count=$((count + 1))
    done

    if [ "$blocked" = false ]; then
        echo "[WEAK] No rate limiting detected after 100 requests"
    fi
    echo "---"
done
```

### Step 2: Test Account Lockout

```bash
#!/bin/bash
# Test account lockout policy

USERNAME="testuser"
WRONG_PASSWORD="wrongpass"

echo "Testing account lockout..."

for i in {1..20}; do
    response=$(curl -s -X POST "https://target.com/api/login" \
        -H "Content-Type: application/json" \
        -d "{\"username\": \"$USERNAME\", \"password\": \"$WRONG_PASSWORD$i\"}")

    echo "Attempt $i: $response"

    # Check for lockout indicators
    if echo "$response" | grep -qi "locked\|blocked\|too many"; then
        echo "Account locked after $i attempts"
        break
    fi
done

# Try with correct password after lockout
echo "Trying correct password..."
curl -s -X POST "https://target.com/api/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\": \"$USERNAME\", \"password\": \"correct_password\"}"
```

### Step 3: Test CAPTCHA Trigger

```bash
# Test when CAPTCHA is triggered

# Failed logins
for i in {1..10}; do
    response=$(curl -s -X POST "https://target.com/api/login" \
        -H "Content-Type: application/json" \
        -d '{"username": "test", "password": "wrong"}')

    if echo "$response" | grep -qi "captcha"; then
        echo "CAPTCHA triggered after $i failed attempts"
        break
    fi
done

# Rapid requests
for i in {1..50}; do
    response=$(curl -s "https://target.com/api/search?q=test$i")

    if echo "$response" | grep -qi "captcha\|verify"; then
        echo "CAPTCHA triggered after $i requests"
        break
    fi
done
```

### Step 4: Test IP-Based Blocking

```bash
#!/bin/bash
# Test if IP blocking is implemented

# Generate many failed login attempts
for i in {1..50}; do
    curl -s -X POST "https://target.com/api/login" \
        -H "Content-Type: application/json" \
        -d '{"username": "test", "password": "wrong"}' > /dev/null
done

# Check if IP is blocked
response=$(curl -s -o /dev/null -w "%{http_code}" "https://target.com/")

if [ "$response" == "403" ] || [ "$response" == "429" ]; then
    echo "IP appears to be blocked"
else
    echo "IP not blocked - potential weakness"
fi

# Test with different user-agent
curl -s "https://target.com/" \
    -H "User-Agent: Different Browser"

# Test accessing from different path
curl -s "https://target.com/api/public"
```

### Step 5: Test Bot Detection

```bash
# Test with bot-like characteristics

# Missing or suspicious User-Agent
curl -s "https://target.com/api/products" \
    -H "User-Agent: " \
    -w "\nStatus: %{http_code}"

curl -s "https://target.com/api/products" \
    -H "User-Agent: python-requests/2.28.0" \
    -w "\nStatus: %{http_code}"

curl -s "https://target.com/api/products" \
    -H "User-Agent: curl/7.68.0" \
    -w "\nStatus: %{http_code}"

# Missing standard headers
curl -s "https://target.com/api/products" \
    -H "Accept: " \
    -H "Accept-Language: " \
    -w "\nStatus: %{http_code}"

# Headless browser detection
curl -s "https://target.com/api/products" \
    -H "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/91.0.4472.114" \
    -w "\nStatus: %{http_code}"
```

### Step 6: Test Behavioral Anomaly Detection

```bash
# Test unusual access patterns

# Rapid sequential page access
for i in {1..100}; do
    curl -s "https://target.com/product/$i" > /dev/null &
done
wait

# Non-human timing (no delays)
start=$(date +%s)
for i in {1..50}; do
    curl -s "https://target.com/api/data" > /dev/null
done
end=$(date +%s)
echo "50 requests in $((end - start)) seconds"

# Unusual access sequence (direct to deep pages)
curl -s "https://target.com/admin/settings" \
    -H "Authorization: Bearer $TOKEN"
```

### Step 7: Test Credential Stuffing Defense

```bash
#!/bin/bash
# Test defense against credential stuffing

# Simulate credential stuffing pattern
# Multiple usernames with same password

passwords=("Password123" "123456" "qwerty")

for password in "${passwords[@]}"; do
    for i in {1..20}; do
        response=$(curl -s -X POST "https://target.com/api/login" \
            -H "Content-Type: application/json" \
            -d "{\"username\": \"user$i@test.com\", \"password\": \"$password\"}")

        # Check for detection
        if echo "$response" | grep -qi "blocked\|suspicious\|captcha"; then
            echo "Credential stuffing detected after $(($i)) attempts"
            break 2
        fi
    done
done
```

---

## Tools

### Rate Limit Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **wfuzz** | Fuzzer | Rate limit testing |
| **ffuf** | Fast fuzzer | Parallel request testing |
| **Custom scripts** | Bash/Python | Automated testing |

### Bot Detection Testing

| Tool | Description |
|------|-------------|
| **Puppeteer** | Headless Chrome automation |
| **Selenium** | Browser automation |
| **Playwright** | Cross-browser automation |

---

## Example Commands/Payloads

### Abuse Defense Tester

```python
#!/usr/bin/env python3
import requests
import time
import statistics
from concurrent.futures import ThreadPoolExecutor

class AbuseTester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.results = {}

    def test_rate_limiting(self, endpoint, num_requests=100):
        """Test rate limiting on endpoint"""
        blocked_at = None

        for i in range(num_requests):
            response = requests.get(f"{self.base_url}{endpoint}")

            if response.status_code == 429:
                blocked_at = i + 1
                break

        self.results["rate_limiting"] = {
            "endpoint": endpoint,
            "blocked_at": blocked_at,
            "protected": blocked_at is not None and blocked_at < num_requests
        }

        return self.results["rate_limiting"]

    def test_lockout_policy(self, login_endpoint, username, max_attempts=20):
        """Test account lockout policy"""
        locked_at = None

        for i in range(max_attempts):
            response = requests.post(
                f"{self.base_url}{login_endpoint}",
                json={"username": username, "password": f"wrong_{i}"}
            )

            text = response.text.lower()
            if "locked" in text or "blocked" in text or "too many" in text:
                locked_at = i + 1
                break

        self.results["lockout_policy"] = {
            "locked_at": locked_at,
            "protected": locked_at is not None and locked_at <= 10
        }

        return self.results["lockout_policy"]

    def test_captcha_trigger(self, endpoint, trigger_threshold=10):
        """Test when CAPTCHA is triggered"""
        captcha_at = None

        for i in range(trigger_threshold * 2):
            response = requests.get(f"{self.base_url}{endpoint}")

            if "captcha" in response.text.lower():
                captcha_at = i + 1
                break

        self.results["captcha_trigger"] = {
            "triggered_at": captcha_at,
            "protected": captcha_at is not None
        }

        return self.results["captcha_trigger"]

    def test_bot_detection(self, endpoint):
        """Test bot detection mechanisms"""
        tests = [
            {"name": "No User-Agent", "headers": {"User-Agent": ""}},
            {"name": "Python UA", "headers": {"User-Agent": "python-requests/2.28"}},
            {"name": "Curl UA", "headers": {"User-Agent": "curl/7.68.0"}},
            {"name": "Headless Chrome", "headers": {"User-Agent": "HeadlessChrome/91"}},
            {"name": "No Accept", "headers": {"Accept": ""}},
        ]

        results = []
        for test in tests:
            response = requests.get(
                f"{self.base_url}{endpoint}",
                headers=test["headers"]
            )

            blocked = response.status_code in [403, 429]
            results.append({
                "test": test["name"],
                "blocked": blocked,
                "status": response.status_code
            })

        self.results["bot_detection"] = results
        return results

    def test_parallel_requests(self, endpoint, num_requests=50):
        """Test defense against parallel requests"""

        def make_request():
            return requests.get(f"{self.base_url}{endpoint}").status_code

        with ThreadPoolExecutor(max_workers=50) as executor:
            results = list(executor.map(lambda _: make_request(), range(num_requests)))

        blocked = sum(1 for r in results if r == 429)
        success = sum(1 for r in results if r == 200)

        self.results["parallel_requests"] = {
            "total": num_requests,
            "blocked": blocked,
            "success": success,
            "protected": blocked > 0
        }

        return self.results["parallel_requests"]

    def generate_report(self):
        """Generate comprehensive report"""
        print("\n=== APPLICATION ABUSE DEFENSE REPORT ===\n")

        for test_name, result in self.results.items():
            protected = result.get("protected", False)
            status = "[PROTECTED]" if protected else "[WEAK]"
            print(f"{status} {test_name}")

            if isinstance(result, dict):
                for key, value in result.items():
                    if key != "protected":
                        print(f"    {key}: {value}")
            elif isinstance(result, list):
                for item in result:
                    print(f"    {item}")

# Usage
tester = AbuseTester("https://target.com")
tester.test_rate_limiting("/api/search")
tester.test_lockout_policy("/api/login", "testuser")
tester.test_captcha_trigger("/api/search")
tester.test_bot_detection("/api/products")
tester.test_parallel_requests("/api/data")
tester.generate_report()
```

---

## Remediation Guide

### 1. Implement Comprehensive Rate Limiting

```python
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

limiter = Limiter(
    app,
    key_func=get_remote_address,
    default_limits=["100 per minute"]
)

# Different limits for different endpoints
@app.route('/api/login', methods=['POST'])
@limiter.limit("5 per minute")
def login():
    pass

@app.route('/api/password-reset', methods=['POST'])
@limiter.limit("3 per hour")
def password_reset():
    pass

@app.route('/api/search')
@limiter.limit("30 per minute")
def search():
    pass
```

### 2. Implement Account Lockout

```python
import redis
from datetime import datetime, timedelta

redis_client = redis.Redis()

class AccountLockout:
    def __init__(self, max_attempts=5, lockout_duration=900):  # 15 minutes
        self.max_attempts = max_attempts
        self.lockout_duration = lockout_duration

    def record_failed_attempt(self, username):
        key = f"login_attempts:{username}"
        attempts = redis_client.incr(key)

        if attempts == 1:
            redis_client.expire(key, 3600)  # 1 hour window

        if attempts >= self.max_attempts:
            lock_key = f"account_locked:{username}"
            redis_client.setex(lock_key, self.lockout_duration, "1")
            return True

        return False

    def is_locked(self, username):
        return redis_client.exists(f"account_locked:{username}")

    def clear_attempts(self, username):
        redis_client.delete(f"login_attempts:{username}")
        redis_client.delete(f"account_locked:{username}")

lockout = AccountLockout()

@app.route('/api/login', methods=['POST'])
def login():
    username = request.json.get('username')

    if lockout.is_locked(username):
        return jsonify({
            "error": "Account temporarily locked",
            "retry_after": 900
        }), 429

    if not verify_credentials(username, request.json.get('password')):
        if lockout.record_failed_attempt(username):
            log_security_event("account_locked", username)
            return jsonify({"error": "Account locked due to failed attempts"}), 429

        return jsonify({"error": "Invalid credentials"}), 401

    lockout.clear_attempts(username)
    return jsonify({"token": generate_token(username)})
```

### 3. Implement Bot Detection

```python
from user_agents import parse

def detect_bot(request):
    """Detect potential bot traffic"""
    indicators = []

    # Check User-Agent
    ua_string = request.headers.get('User-Agent', '')
    if not ua_string:
        indicators.append("missing_user_agent")

    ua = parse(ua_string)
    if ua.is_bot:
        indicators.append("known_bot_ua")

    # Check for common bot patterns
    bot_patterns = ['bot', 'crawler', 'spider', 'scraper', 'curl', 'python', 'headless']
    if any(pattern in ua_string.lower() for pattern in bot_patterns):
        indicators.append("bot_pattern_in_ua")

    # Check for missing standard headers
    if not request.headers.get('Accept-Language'):
        indicators.append("missing_accept_language")

    if not request.headers.get('Accept'):
        indicators.append("missing_accept")

    # Check for suspicious timing patterns
    # (Would require session-level tracking)

    return {
        "is_bot": len(indicators) >= 2,
        "indicators": indicators,
        "risk_score": len(indicators)
    }

@app.before_request
def check_bot():
    result = detect_bot(request)

    if result["is_bot"]:
        log_security_event("bot_detected", result)

        if result["risk_score"] >= 3:
            return jsonify({"error": "Request blocked"}), 403
        else:
            # Add CAPTCHA requirement
            g.require_captcha = True
```

### 4. Behavioral Analysis

```python
from collections import defaultdict
import time

class BehaviorAnalyzer:
    def __init__(self):
        self.user_actions = defaultdict(list)

    def record_action(self, user_id, action, endpoint):
        """Record user action for analysis"""
        now = time.time()
        self.user_actions[user_id].append({
            "action": action,
            "endpoint": endpoint,
            "timestamp": now
        })

        # Keep only last hour
        self.user_actions[user_id] = [
            a for a in self.user_actions[user_id]
            if now - a["timestamp"] < 3600
        ]

    def analyze_behavior(self, user_id):
        """Analyze user behavior for anomalies"""
        actions = self.user_actions[user_id]

        if len(actions) < 5:
            return {"risk": "low"}

        # Check request rate
        if len(actions) > 100:
            return {"risk": "high", "reason": "excessive_requests"}

        # Check timing patterns (too regular = bot)
        timestamps = [a["timestamp"] for a in actions]
        intervals = [timestamps[i+1] - timestamps[i] for i in range(len(timestamps)-1)]

        if intervals and max(intervals) - min(intervals) < 0.1:
            return {"risk": "high", "reason": "inhuman_timing"}

        # Check endpoint diversity
        unique_endpoints = len(set(a["endpoint"] for a in actions))
        if unique_endpoints < 3 and len(actions) > 50:
            return {"risk": "medium", "reason": "suspicious_pattern"}

        return {"risk": "low"}
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| No rate limiting on login | 8.8 | High |
| No account lockout | 7.5 | High |
| No bot detection | 5.3 | Medium |
| Weak CAPTCHA trigger threshold | 4.3 | Medium |
| No behavioral analysis | 4.3 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-307** | Improper Restriction of Excessive Authentication Attempts | Missing lockout |
| **CWE-770** | Allocation of Resources Without Limits | No rate limiting |
| **CWE-799** | Improper Control of Interaction Frequency | Abuse not detected |

---

## References

- [OWASP WSTG - Test Defenses Against Application Misuse](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/10-Business_Logic_Testing/07-Test_Defenses_Against_Application_Misuse)
- [OWASP Blocking Brute Force](https://owasp.org/www-community/controls/Blocking_Brute_Force_Attacks)
- [OWASP Credential Stuffing Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html)

---

## Checklist

```
[ ] Rate limiting tested on all endpoints
[ ] Account lockout policy verified
[ ] CAPTCHA trigger threshold tested
[ ] IP-based blocking tested
[ ] Bot detection tested
[ ] User-Agent filtering tested
[ ] Behavioral analysis tested
[ ] Parallel request defense tested
[ ] Credential stuffing defense tested
[ ] Recovery mechanisms tested
[ ] Findings documented
[ ] Remediation recommendations provided
```
