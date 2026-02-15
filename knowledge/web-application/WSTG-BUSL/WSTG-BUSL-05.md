# WSTG-BUSL-05: Test Number of Times a Function Can Be Used Limits

## Test ID
WSTG-BUSL-05

## Test Name
Test Number of Times a Function Can Be Used Limits

## High-Level Description

Function usage limit testing examines whether an application properly enforces restrictions on how many times a user can perform specific actions. These limits protect against abuse, fraud, and resource exhaustion. Attackers may attempt to bypass these controls to gain unfair advantages, such as unlimited free trials, multiple coupon redemptions, or exceeding transaction limits.

---

## What to Check

### Usage Limits to Test

- [ ] Daily/weekly/monthly transaction limits
- [ ] Free trial limitations
- [ ] Download quotas
- [ ] API rate limits
- [ ] Voting/rating limits
- [ ] Coupon/promotional code usage
- [ ] Password reset request limits
- [ ] Account creation limits

### Bypass Techniques

| Technique | Description |
|-----------|-------------|
| Session manipulation | New session resets counter |
| Account switching | Multiple accounts |
| Parameter tampering | Modify limit parameters |
| Time manipulation | Change timestamps |
| Race conditions | Parallel requests |

---

## How to Test

### Step 1: Identify Function Limits

```bash
# Document limits from application behavior/documentation
# Examples:
# - 3 password reset attempts per hour
# - 5 free downloads per day
# - 10 API calls per minute
# - 1 coupon per account
# - $1000 daily transfer limit

# Test to discover undocumented limits
for i in {1..50}; do
    response=$(curl -s -X POST "https://target.com/api/download/free" \
        -H "Authorization: Bearer $TOKEN" \
        -w "\n%{http_code}")
    echo "Attempt $i: $response"
done
```

### Step 2: Test Limit Enforcement

```bash
#!/bin/bash
# Test if limits are actually enforced

LIMIT=5
ENDPOINT="https://target.com/api/action"
TOKEN="your_token"

echo "Testing limit enforcement..."

for i in $(seq 1 $((LIMIT + 5))); do
    response=$(curl -s -X POST "$ENDPOINT" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"action": "test"}' \
        -w "\nSTATUS:%{http_code}")

    status=$(echo "$response" | grep "STATUS:" | cut -d: -f2)

    if [ "$i" -le "$LIMIT" ]; then
        if [ "$status" != "200" ]; then
            echo "Attempt $i: UNEXPECTED FAILURE (expected success)"
        else
            echo "Attempt $i: SUCCESS (as expected)"
        fi
    else
        if [ "$status" == "200" ]; then
            echo "Attempt $i: [VULNERABILITY] Success beyond limit!"
        else
            echo "Attempt $i: BLOCKED (as expected)"
        fi
    fi
done
```

### Step 3: Test Session-Based Limit Bypass

```bash
# Get new session and test if limit resets
# First, exhaust limit with current session
for i in {1..10}; do
    curl -s -X POST "https://target.com/api/action" \
        -H "Cookie: session=$SESSION1" > /dev/null
done

# Get new session
NEW_SESSION=$(curl -s -c - "https://target.com/login" \
    -d "user=$USER&pass=$PASS" | grep session | awk '{print $7}')

# Try with new session
response=$(curl -s -X POST "https://target.com/api/action" \
    -H "Cookie: session=$NEW_SESSION")

echo "After new session: $response"
# If success, limits are per-session not per-user
```

### Step 4: Test Account-Based Limit Bypass

```bash
#!/bin/bash
# Test if creating multiple accounts bypasses limits

# Limit: 3 free downloads per account
# Attack: Create multiple accounts

for account in {1..5}; do
    # Create new account
    curl -s -X POST "https://target.com/api/register" \
        -H "Content-Type: application/json" \
        -d "{
            \"username\": \"testuser$account\",
            \"email\": \"test$account@temp-mail.com\",
            \"password\": \"Password123!\"
        }"

    # Get token
    token=$(curl -s -X POST "https://target.com/api/login" \
        -H "Content-Type: application/json" \
        -d "{
            \"email\": \"test$account@temp-mail.com\",
            \"password\": \"Password123!\"
        }" | jq -r '.token')

    # Use free downloads
    for download in {1..3}; do
        curl -s -X GET "https://target.com/api/download/free" \
            -H "Authorization: Bearer $token" > /dev/null
        echo "Account $account, Download $download: Done"
    done
done
```

### Step 5: Test Time-Based Limit Reset

```bash
# Test if limits reset at specific times

# First, exhaust daily limit
for i in {1..10}; do
    curl -s -X POST "https://target.com/api/action" \
        -H "Authorization: Bearer $TOKEN" > /dev/null
done

# Check if sending future timestamp bypasses
curl -s -X POST "https://target.com/api/action" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"timestamp": "2025-12-31T00:00:00Z"}'

# Test with modified Date header
curl -s -X POST "https://target.com/api/action" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Date: Mon, 31 Dec 2025 00:00:00 GMT"
```

### Step 6: Test Parameter-Based Limit Bypass

```bash
# Try modifying limit-related parameters

# If limit info is in response/request
curl -s -X POST "https://target.com/api/action" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "action": "download",
        "remaining_limit": 999,
        "is_premium": true
    }'

# Hidden parameter injection
curl -s -X POST "https://target.com/api/action" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "action": "download",
        "bypass_limit": true,
        "unlimited": true
    }'
```

### Step 7: Test Limit Reset Mechanism

```bash
# Find if there's a way to reset limits

# Check for reset endpoint
curl -s -X POST "https://target.com/api/reset-limits" \
    -H "Authorization: Bearer $TOKEN"

# Check profile update
curl -s -X PUT "https://target.com/api/user/profile" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"usage_count": 0}'

# Check if deleting and recreating something resets limit
curl -s -X DELETE "https://target.com/api/subscription" \
    -H "Authorization: Bearer $TOKEN"

curl -s -X POST "https://target.com/api/subscription/trial" \
    -H "Authorization: Bearer $TOKEN"
```

---

## Tools

### Automated Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Intruder** | Automated limit testing | Iterate until blocked |
| **Custom scripts** | Limit bypass testing | Python/Bash automation |
| **Postman** | API testing | Collection runners |

### Analysis

| Tool | Description |
|------|-------------|
| **Burp Logger** | Track all requests |
| **Excel/Sheets** | Analyze patterns |

---

## Example Commands/Payloads

### Limit Bypass Test Payloads

```json
// Premium status bypass
{"is_premium": true}
{"account_type": "enterprise"}
{"subscription": "unlimited"}

// Limit manipulation
{"remaining_downloads": 999}
{"usage_count": 0}
{"limit_reset": true}

// Timestamp manipulation
{"timestamp": "2099-01-01T00:00:00Z"}
{"created_at": "2020-01-01T00:00:00Z"}
```

### Comprehensive Limit Tester

```python
#!/usr/bin/env python3
import requests
import time
import json

class LimitTester:
    def __init__(self, base_url, token):
        self.base_url = base_url
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        self.results = []

    def test_hard_limit(self, endpoint, expected_limit, payload=None):
        """Test if hard limit is enforced"""
        if payload is None:
            payload = {}

        successes = 0
        for i in range(expected_limit + 10):
            response = requests.post(
                f"{self.base_url}{endpoint}",
                headers=self.headers,
                json=payload
            )

            if response.status_code == 200:
                successes += 1
            else:
                break

        result = {
            "endpoint": endpoint,
            "expected_limit": expected_limit,
            "actual_successes": successes,
            "enforced": successes <= expected_limit,
            "vulnerable": successes > expected_limit
        }

        self.results.append(result)
        return result

    def test_session_reset_bypass(self, endpoint, login_endpoint, credentials):
        """Test if new session resets limits"""

        # Exhaust limit with session 1
        for _ in range(20):
            requests.post(
                f"{self.base_url}{endpoint}",
                headers=self.headers
            )

        # Get new session
        login_response = requests.post(
            f"{self.base_url}{login_endpoint}",
            json=credentials
        )
        new_token = login_response.json().get("token")

        # Try with new session
        new_headers = {**self.headers, "Authorization": f"Bearer {new_token}"}
        response = requests.post(
            f"{self.base_url}{endpoint}",
            headers=new_headers
        )

        result = {
            "test": "session_reset_bypass",
            "vulnerable": response.status_code == 200,
            "details": "New session resets limits" if response.status_code == 200 else "Limits persist"
        }

        self.results.append(result)
        return result

    def test_parameter_bypass(self, endpoint, bypass_params):
        """Test parameter-based limit bypass"""

        # First exhaust normal limit
        for _ in range(20):
            requests.post(
                f"{self.base_url}{endpoint}",
                headers=self.headers,
                json={}
            )

        # Try with bypass parameters
        vulnerabilities = []
        for param in bypass_params:
            response = requests.post(
                f"{self.base_url}{endpoint}",
                headers=self.headers,
                json=param
            )

            if response.status_code == 200:
                vulnerabilities.append({
                    "param": param,
                    "status": response.status_code
                })

        result = {
            "test": "parameter_bypass",
            "vulnerable": len(vulnerabilities) > 0,
            "bypasses": vulnerabilities
        }

        self.results.append(result)
        return result

    def generate_report(self):
        """Generate test report"""
        print("\n=== LIMIT TESTING REPORT ===\n")

        vulnerable_count = sum(1 for r in self.results if r.get("vulnerable"))

        print(f"Total tests: {len(self.results)}")
        print(f"Vulnerabilities found: {vulnerable_count}")
        print("")

        for result in self.results:
            status = "[VULN]" if result.get("vulnerable") else "[OK]"
            print(f"{status} {result.get('endpoint', result.get('test'))}")

            if result.get("vulnerable"):
                for key, value in result.items():
                    if key not in ["endpoint", "test", "vulnerable"]:
                        print(f"    {key}: {value}")

# Usage
tester = LimitTester("https://target.com", "auth_token")

# Test various limits
tester.test_hard_limit("/api/download/free", expected_limit=5)
tester.test_hard_limit("/api/password-reset", expected_limit=3)
tester.test_hard_limit("/api/transfer", expected_limit=10)

# Test bypass techniques
tester.test_parameter_bypass("/api/download", [
    {"is_premium": True},
    {"bypass_limit": True},
    {"remaining": 999}
])

tester.generate_report()
```

---

## Remediation Guide

### 1. Server-Side Limit Enforcement

```python
from datetime import datetime, timedelta
from functools import wraps

class UsageLimiter:
    def __init__(self, redis_client):
        self.redis = redis_client

    def check_limit(self, user_id, action, limit, period_seconds):
        """Check if user is within usage limit"""
        key = f"limit:{user_id}:{action}"

        current = self.redis.get(key)
        if current is None:
            self.redis.setex(key, period_seconds, 1)
            return True, limit - 1

        current = int(current)
        if current >= limit:
            ttl = self.redis.ttl(key)
            return False, 0  # Limit reached

        self.redis.incr(key)
        return True, limit - current - 1

def rate_limit(action, limit, period_seconds):
    """Decorator for rate limiting"""
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            user_id = get_current_user_id()

            allowed, remaining = limiter.check_limit(
                user_id, action, limit, period_seconds
            )

            if not allowed:
                return jsonify({
                    "error": "Rate limit exceeded",
                    "retry_after": period_seconds
                }), 429

            response = f(*args, **kwargs)

            # Add rate limit headers
            response.headers["X-RateLimit-Limit"] = str(limit)
            response.headers["X-RateLimit-Remaining"] = str(remaining)

            return response
        return wrapped
    return decorator

# Usage
@app.route('/api/download/free')
@rate_limit(action="free_download", limit=5, period_seconds=86400)
def free_download():
    return download_file()
```

### 2. Database-Level Limit Tracking

```python
from sqlalchemy import Column, Integer, DateTime, func
from datetime import datetime, timedelta

class UsageTracking(Base):
    __tablename__ = 'usage_tracking'

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'))
    action = Column(String(50))
    count = Column(Integer, default=0)
    period_start = Column(DateTime)

def check_and_increment(user_id, action, limit, period_hours=24):
    """Atomically check and increment usage"""

    period_start = datetime.utcnow() - timedelta(hours=period_hours)

    # Use database-level locking
    with Session(engine) as session:
        tracking = session.query(UsageTracking).filter(
            UsageTracking.user_id == user_id,
            UsageTracking.action == action,
            UsageTracking.period_start >= period_start
        ).with_for_update().first()

        if tracking is None:
            # First use in this period
            tracking = UsageTracking(
                user_id=user_id,
                action=action,
                count=1,
                period_start=datetime.utcnow()
            )
            session.add(tracking)
            session.commit()
            return True

        if tracking.count >= limit:
            return False

        tracking.count += 1
        session.commit()
        return True
```

### 3. Anti-Abuse Measures

```python
import hashlib

def get_device_fingerprint(request):
    """Generate device fingerprint for abuse detection"""
    components = [
        request.headers.get('User-Agent', ''),
        request.headers.get('Accept-Language', ''),
        request.remote_addr,
        # Add more fingerprinting components
    ]
    return hashlib.sha256(''.join(components).encode()).hexdigest()

def check_abuse_patterns(user_id, fingerprint):
    """Check for abuse patterns"""

    # Check if same fingerprint used by multiple accounts
    accounts_with_fingerprint = get_accounts_by_fingerprint(fingerprint)
    if len(accounts_with_fingerprint) > 3:
        flag_for_review(user_id, "Multiple accounts from same device")
        return True

    # Check for rapid account creation
    recent_accounts = get_accounts_created_recently(fingerprint, hours=24)
    if len(recent_accounts) > 2:
        flag_for_review(user_id, "Rapid account creation")
        return True

    return False
```

### 4. Tiered Limits with Proper Enforcement

```python
class TieredLimiter:
    TIERS = {
        'free': {
            'downloads': 5,
            'api_calls': 100,
            'transfers': 3
        },
        'basic': {
            'downloads': 50,
            'api_calls': 1000,
            'transfers': 20
        },
        'premium': {
            'downloads': 500,
            'api_calls': 10000,
            'transfers': 100
        }
    }

    def get_limit(self, user, action):
        """Get limit based on user tier - from database, not request"""
        # IMPORTANT: Get tier from database, not from request
        tier = self.get_user_tier_from_db(user.id)
        return self.TIERS.get(tier, self.TIERS['free']).get(action, 0)

    def get_user_tier_from_db(self, user_id):
        """Always fetch tier from database"""
        user = User.query.get(user_id)
        return user.subscription_tier if user else 'free'
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Financial transaction limit bypass | 9.8 | Critical |
| Unlimited free trial abuse | 6.5 | Medium |
| Download quota bypass | 5.3 | Medium |
| API rate limit bypass | 5.3 | Medium |
| Vote/rating manipulation | 4.3 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-770** | Allocation of Resources Without Limits | Missing usage limits |
| **CWE-799** | Improper Control of Interaction Frequency | Rate limit bypass |
| **CWE-841** | Improper Enforcement of Behavioral Workflow | Workflow bypass |

---

## References

- [OWASP WSTG - Test Number of Times a Function Can Be Used](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/10-Business_Logic_Testing/05-Test_Number_of_Times_a_Function_Can_Be_Used_Limits)
- [OWASP API Security - Rate Limiting](https://owasp.org/API-Security/)
- [Rate Limiting Best Practices](https://cloud.google.com/architecture/rate-limiting-strategies-techniques)

---

## Checklist

```
[ ] Function usage limits identified
[ ] Hard limit enforcement tested
[ ] Session-based reset bypass tested
[ ] Account-based bypass tested
[ ] Time manipulation tested
[ ] Parameter tampering tested
[ ] Race condition bypass tested
[ ] Limit reset mechanisms tested
[ ] Multi-account abuse tested
[ ] Client-side vs server-side enforcement verified
[ ] Findings documented
[ ] Remediation recommendations provided
```
